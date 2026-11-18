import { desc, eq } from "drizzle-orm";
import type Stripe from "stripe";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import type { db as DbHandle } from "@/lib/db";
import { organizations, subscriptions, users } from "@/lib/db/schema";
import {
  invoiceSubscriptionRef,
  isTimewrenStripeEnabled,
  normalizedQuantity,
  readMetadata,
  subscriptionFieldsFromStripe,
  TIMEWREN_STRIPE_BRAND,
  type TimewrenMetadata,
  tierFromPrice,
} from "./timewren-stripe";

type Db = typeof DbHandle;

/**
 * Stripe-webhooks for TimeWren Cloud (metadata brand=timewren). Kaldes fra
 * /api/webhooks/stripe før desktop-licensens handlere, som er uændrede.
 * Idempotens står route'en for (webhook_events). Abonnementet hentes altid
 * frisk fra Stripe, så events i forkert rækkefølge ikke kan skrive en ældre
 * tilstand.
 */

export interface TimewrenWebhookDeps {
  db: Db;
  /**
   * Kører `fn` serielt pr. Stripe-abonnement (route'en: transaktion med
   * pg_advisory_xact_lock). Uden lås kan en forsinket handler skrive en
   * ældre frisk læsning oven på en nyere. Udeladt: `fn(db)` (tests).
   */
  withSubscriptionLock?<T>(
    subscriptionId: string,
    fn: (db: Db) => Promise<T>,
  ): Promise<T>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /** Frisk faktura: mailen om fejlet betaling afgøres på dens egen status. */
  retrieveInvoice(id: string): Promise<Stripe.Invoice>;
  /** Retter antallet på et abonnementspunkt (kun nedad, se normalizedQuantity). */
  setItemQuantity(itemId: string, quantity: number): Promise<void>;
  sendPaymentFailed(args: {
    to: string;
    userName: string;
    amountDue: string;
    billingPortalUrl: string;
    userId: string;
  }): Promise<unknown>;
  sendCancellation(args: {
    to: string;
    userName: string;
    endDate: Date | null;
    reactivateUrl: string;
    userId: string;
  }): Promise<unknown>;
  /** Brandets app-URL (https://timewren.com) til links i mails. */
  appUrl: string;
  formatAmount(cents: number): string;
  now?: () => Date;
}

export type TimewrenWebhookResult =
  | { outcome: "applied"; subscriptionRowId: string }
  | { outcome: "ignored"; reason: string }
  | { outcome: "rejected"; reason: string };

export const TIMEWREN_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.paid",
  "invoice.payment_failed",
] as const;

function idOf(v: string | { id: string } | null | undefined): string | null {
  if (!v) return null;
  return typeof v === "string" ? v : v.id;
}

const LIVE = new Set(["active", "trialing", "past_due"]);

export async function handleTimewrenStripeEvent(
  event: Stripe.Event,
  deps: TimewrenWebhookDeps,
): Promise<TimewrenWebhookResult> {
  if (!isTimewrenStripeEnabled()) {
    return { outcome: "ignored", reason: "timewren-billing-disabled" };
  }
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const subId = idOf(session.subscription);
      if (session.mode !== "subscription" || !subId) {
        return { outcome: "ignored", reason: "not-a-subscription-checkout" };
      }
      return syncSubscription(subId, readMetadata(session.metadata), deps);
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      return syncSubscription(sub.id, readMetadata(sub.metadata), deps);
    }
    case "invoice.paid":
    case "invoice.payment_failed": {
      const invoice = event.data.object as Stripe.Invoice;
      const ref = invoiceSubscriptionRef(invoice);
      if (!ref.subscriptionId) {
        return { outcome: "ignored", reason: "invoice-without-subscription" };
      }
      const result = await syncSubscription(
        ref.subscriptionId,
        readMetadata(ref.metadata),
        deps,
      );
      if (
        result.outcome === "applied" &&
        event.type === "invoice.payment_failed" &&
        // Kun ved første forsøg; Stripes genforsøg giver ikke en ny mail.
        (invoice.attempt_count ?? 1) <= 1
      ) {
        // Afgøres på denne fakturas aktuelle status, ikke abonnementets: en
        // nyere faktura kan have gjort abonnementet past_due, og en åben
        // faktura kan findes, mens abonnementet stadig er active.
        const fresh = invoice.id
          ? await deps.retrieveInvoice(invoice.id)
          : invoice;
        if (fresh.status === "open") {
          await notifyPaymentFailed(
            deps,
            readMetadata(ref.metadata),
            result.subscriptionRowId,
            fresh.amount_due ?? 0,
          );
        }
      }
      return result;
    }
    default:
      return { outcome: "ignored", reason: `unhandled:${event.type}` };
  }
}

async function syncSubscription(
  subscriptionId: string,
  eventMetadata: TimewrenMetadata,
  deps: TimewrenWebhookDeps,
): Promise<TimewrenWebhookResult> {
  // Læsning fra Stripe og skrivning sker under samme lås, så den sidste
  // handler altid skriver den nyeste tilstand.
  if (deps.withSubscriptionLock) {
    return deps.withSubscriptionLock(subscriptionId, (db) =>
      syncSubscriptionLocked(subscriptionId, eventMetadata, deps, db),
    );
  }
  return syncSubscriptionLocked(subscriptionId, eventMetadata, deps, deps.db);
}

async function syncSubscriptionLocked(
  subscriptionId: string,
  eventMetadata: TimewrenMetadata,
  deps: TimewrenWebhookDeps,
  db: Db,
): Promise<TimewrenWebhookResult> {
  const now = deps.now?.() ?? new Date();
  const sub = await deps.retrieveSubscription(subscriptionId);
  const fromSub = readMetadata(sub.metadata);
  const md: TimewrenMetadata = {
    brand: fromSub.brand ?? eventMetadata.brand,
    organizationId: fromSub.organizationId ?? eventMetadata.organizationId,
    userId: fromSub.userId ?? eventMetadata.userId,
  };

  if (md.brand !== TIMEWREN_STRIPE_BRAND) {
    return { outcome: "rejected", reason: "subscription-brand-mismatch" };
  }
  if (!md.organizationId) {
    return { outcome: "rejected", reason: "missing-organization" };
  }
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, md.organizationId),
    columns: { id: true, brand: true },
  });
  if (!org || org.brand !== TIMEWREN_STRIPE_BRAND) {
    return { outcome: "rejected", reason: "organization-brand-mismatch" };
  }

  const columns = {
    id: true,
    userId: true,
    organizationId: true,
    status: true,
    pastDueSince: true,
    trialEndsAt: true,
    cancelAtPeriodEnd: true,
    stripeSubscriptionId: true,
  } as const;
  const row =
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, sub.id),
      columns,
    })) ??
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, org.id),
      orderBy: desc(subscriptions.createdAt),
      columns,
    })) ??
    (md.userId
      ? await db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, md.userId),
          columns,
        })
      : undefined);

  if (row?.organizationId && row.organizationId !== org.id) {
    return { outcome: "rejected", reason: "row-organization-mismatch" };
  }

  // Et gammelt abonnement, der slutter, efter at organisationen har fået et
  // nyt, må ikke sætte den nye række på Gratis.
  if (
    row?.stripeSubscriptionId &&
    row.stripeSubscriptionId !== sub.id &&
    LIVE.has(row.status) &&
    !LIVE.has(sub.status)
  ) {
    return { outcome: "ignored", reason: "superseded-subscription" };
  }

  const fields = subscriptionFieldsFromStripe(sub, row ?? null, now);
  let rowId: string;
  if (row) {
    await db
      .update(subscriptions)
      .set({ ...fields, organizationId: org.id })
      .where(eq(subscriptions.id, row.id));
    rowId = row.id;
  } else {
    if (!md.userId) {
      return { outcome: "rejected", reason: "missing-user" };
    }
    const [inserted] = await db
      .insert(subscriptions)
      .values({
        userId: md.userId,
        organizationId: org.id,
        billingCycle: "monthly",
        ...FREE_TIER_SUBSCRIPTION_FIELDS,
        trialEndsAt: now,
        promoMonthsFree: 0,
        ...fields,
      })
      .returning({ id: subscriptions.id });
    rowId = inserted.id;
  }

  // Betaler kunden for flere sæder, end planen giver (fx Team → Selvstændig i
  // portalen med 3 sæder), rettes antallet ned i Stripe.
  const item = sub.items?.data?.[0];
  const tier = tierFromPrice(item?.price);
  if (item && tier && LIVE.has(sub.status)) {
    const fixed = normalizedQuantity(tier, item.quantity ?? 1);
    if (fixed !== null) await deps.setItemQuantity(item.id, fixed);
  }

  if (fields.cancelAtPeriodEnd === true && row && !row.cancelAtPeriodEnd) {
    const user = await findUser(db, md.userId ?? row.userId);
    if (user) {
      await deps
        .sendCancellation({
          to: user.email,
          userName: user.name || "",
          endDate: (fields.currentPeriodEnd as Date | null) ?? null,
          reactivateUrl: `${deps.appUrl}/dashboard/settings/subscription`,
          userId: user.id,
        })
        .catch((err) =>
          console.error("[Stripe Webhook] TimeWren cancellation mail:", err),
        );
    }
  }

  return {
    outcome: "applied",
    subscriptionRowId: rowId,
  };
}

async function findUser(db: Db, userId: string | null | undefined) {
  if (!userId) return null;
  return (
    (await db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { id: true, email: true, name: true },
    })) ?? null
  );
}

async function notifyPaymentFailed(
  deps: TimewrenWebhookDeps,
  md: TimewrenMetadata,
  rowId: string,
  amountDue: number,
) {
  let userId = md.userId;
  if (!userId) {
    const row = await deps.db.query.subscriptions.findFirst({
      where: eq(subscriptions.id, rowId),
      columns: { userId: true },
    });
    userId = row?.userId ?? null;
  }
  const user = await findUser(deps.db, userId);
  if (!user) return;
  await deps
    .sendPaymentFailed({
      to: user.email,
      userName: user.name || "",
      amountDue: deps.formatAmount(amountDue),
      billingPortalUrl: `${deps.appUrl}/dashboard/settings/subscription`,
      userId: user.id,
    })
    .catch((err) =>
      console.error("[Stripe Webhook] TimeWren payment-failed mail:", err),
    );
}
