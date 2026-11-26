import { desc, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import type { db as DbHandle } from "@/lib/db";
import { organizations, subscriptions, users } from "@/lib/db/schema";
import {
  invoiceSubscriptionRef,
  isTimewrenStripeEnabled,
  readMetadata,
  subscriptionFieldsFromStripe,
  TIMEWREN_STRIPE_BRAND,
  type TimewrenMetadata,
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
  /** Database clock before reading Stripe, at full PostgreSQL precision. */
  readSyncStartedAt(): Promise<string>;
  /** Only database work runs inside this transaction. */
  withSubscriptionLock<T>(
    subscriptionId: string,
    organizationId: string,
    fn: (db: Db) => Promise<T>,
  ): Promise<T>;
  retrieveSubscription(id: string): Promise<Stripe.Subscription>;
  /** Frisk faktura: mailen om fejlet betaling afgøres på dens egen status. */
  retrieveInvoice(id: string): Promise<Stripe.Invoice>;
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
    idempotencyKey: string;
    userId: string;
  }): Promise<unknown>;
  /** Brandets app-URL (https://timewren.com) til links i mails. */
  appUrl: string;
  formatAmount(cents: number): string;
  now?: () => Date;
}

export function timewrenWebhookDatabase(db: Db) {
  return {
    db,
    readSyncStartedAt: async () => {
      const [row] = await db.execute<{ startedAt: string }>(
        sql`select (clock_timestamp() at time zone 'UTC')::text as "startedAt"`,
      );
      return row.startedAt;
    },
    withSubscriptionLock: <T>(
      subscriptionId: string,
      organizationId: string,
      fn: (db: Db) => Promise<T>,
    ) =>
      db.transaction(async (tx) => {
        // Different Stripe subscriptions can target the same organization's row.
        // Keep the older per-subscription key during overlapping deployments.
        for (const key of [
          `stripe-subscription:${subscriptionId}`,
          `timewren-subscription-org:${organizationId}`,
        ]) {
          const [row] = await tx.execute<{ locked: boolean }>(
            sql`select pg_try_advisory_xact_lock(hashtext(${key})) as locked`,
          );
          if (!row?.locked) {
            throw new Error("Concurrent TimeWren subscription sync");
          }
        }
        return fn(tx as unknown as Db);
      }),
  } satisfies Pick<
    TimewrenWebhookDeps,
    "db" | "readSyncStartedAt" | "withSubscriptionLock"
  >;
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
    case "customer.subscription.updated": {
      const sub = event.data.object;
      const previous = { ...sub, ...event.data.previous_attributes };
      // The event still records the transition if Stripe retries after the
      // local subscription commit. The fresh subscription must still agree.
      const scheduled =
        (sub.cancel_at_period_end || sub.cancel_at) &&
        !previous.cancel_at_period_end &&
        !previous.cancel_at;
      return syncSubscription(
        sub.id,
        readMetadata(sub.metadata),
        deps,
        scheduled ? event.id : undefined,
      );
    }
    case "customer.subscription.created":
    case "customer.subscription.deleted": {
      const sub = event.data.object;
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
  cancellationEventId?: string,
): Promise<TimewrenWebhookResult> {
  const syncStartedAt = await deps.readSyncStartedAt();
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
  const organizationId = md.organizationId;
  const { result, cancellation } = await deps.withSubscriptionLock(
    subscriptionId,
    organizationId,
    (db) =>
      applySubscription(
        db,
        organizationId,
        md.userId,
        sub,
        deps,
        syncStartedAt,
        cancellationEventId !== undefined,
      ),
  );
  if (cancellation && cancellationEventId) {
    const { user, endDate } = cancellation;
    await deps.sendCancellation({
      to: user.email,
      userName: user.name || "",
      endDate,
      reactivateUrl: `${deps.appUrl}/dashboard/settings/subscription`,
      userId: user.id,
      idempotencyKey: `timewren-cancellation/${cancellationEventId}`,
    });
  }

  return result;
}

async function applySubscription(
  db: Db,
  organizationId: string,
  userId: string | null,
  sub: Stripe.Subscription,
  deps: TimewrenWebhookDeps,
  syncStartedAt: string,
  notifyCancellation: boolean,
): Promise<{
  result: TimewrenWebhookResult;
  cancellation?: {
    user: NonNullable<Awaited<ReturnType<typeof findUser>>>;
    endDate: Date | null;
  };
}> {
  const now = deps.now?.() ?? new Date();
  const org = await db.query.organizations.findFirst({
    where: eq(organizations.id, organizationId),
    columns: { id: true, brand: true },
  });
  if (!org || org.brand !== TIMEWREN_STRIPE_BRAND) {
    return {
      result: { outcome: "rejected", reason: "organization-brand-mismatch" },
    };
  }

  const columns = {
    id: true,
    userId: true,
    organizationId: true,
    status: true,
    pastDueSince: true,
    trialEndsAt: true,
    stripeSubscriptionId: true,
  } as const;
  const extras = {
    changedDuringSync:
      sql<boolean>`${subscriptions.updatedAt} >= ${syncStartedAt}::timestamp`.as(
        "changed_during_sync",
      ),
  };
  const row =
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.stripeSubscriptionId, sub.id),
      columns,
      extras,
    })) ??
    (await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, org.id),
      orderBy: desc(subscriptions.createdAt),
      columns,
      extras,
    })) ??
    (userId
      ? await db.query.subscriptions.findFirst({
          where: eq(subscriptions.userId, userId),
          columns,
          extras,
        })
      : undefined);

  if (row?.organizationId && row.organizationId !== org.id) {
    return {
      result: { outcome: "rejected", reason: "row-organization-mismatch" },
    };
  }

  // Et gammelt abonnement, der slutter, efter at organisationen har fået et
  // nyt, må ikke sætte den nye række på Gratis.
  if (
    row?.stripeSubscriptionId &&
    row.stripeSubscriptionId !== sub.id &&
    LIVE.has(row.status) &&
    !LIVE.has(sub.status)
  ) {
    return {
      result: { outcome: "ignored", reason: "superseded-subscription" },
    };
  }

  // Another handler committed after this read started. Retry from Stripe
  // instead of letting an older response overwrite the newer local state.
  if (row?.changedDuringSync) {
    throw new Error("TimeWren subscription changed during Stripe read");
  }
  const fields = subscriptionFieldsFromStripe(sub, row ?? null, now);
  fields.updatedAt = sql`clock_timestamp() at time zone 'UTC'`;
  let rowId: string;
  if (row) {
    await db
      .update(subscriptions)
      .set({ ...fields, organizationId: org.id })
      .where(eq(subscriptions.id, row.id));
    rowId = row.id;
  } else {
    if (!userId) {
      return { result: { outcome: "rejected", reason: "missing-user" } };
    }
    const [inserted] = await db
      .insert(subscriptions)
      .values({
        userId,
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

  const user =
    notifyCancellation && fields.cancelAtPeriodEnd === true
      ? await findUser(db, userId ?? row?.userId)
      : null;
  return {
    result: { outcome: "applied", subscriptionRowId: rowId },
    cancellation: user
      ? { user, endDate: (fields.currentPeriodEnd as Date | null) ?? null }
      : undefined,
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
    .catch(() =>
      console.error(
        "[Stripe Webhook] TimeWren payment-failed mail failed",
        rowId,
      ),
    );
}
