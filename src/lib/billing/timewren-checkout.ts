import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import type Stripe from "stripe";
import { tr } from "@/i18n/server-text";
import type { db as DbHandle } from "@/lib/db";
import { members, subscriptions, users } from "@/lib/db/schema";
import { countSeatUsage } from "./seat-usage";
import {
  checkoutQuantity,
  TIMEWREN_STRIPE_BRAND,
  type TimewrenPaidTier,
  timewrenCheckoutParams,
} from "./timewren-stripe";
import {
  timewrenPortalConfiguration,
  timewrenPrices,
} from "./timewren-stripe-server";

type Db = typeof DbHandle;

/**
 * Checkout og kundeportal for TimeWren Cloud. Kaldes af
 * lib/trpc/routers/timewrenBilling.ts efter assertStripeCheckoutAvailable;
 * Stripe-klienten gives udefra, så tests aldrig rammer rigtig Stripe.
 */

const LIVE = new Set(["active", "trialing", "past_due"]);

export interface GoverningSubscription {
  id: string;
  status: string;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
}

export function hasLiveStripeSubscription(
  sub: Pick<GoverningSubscription, "status" | "stripeSubscriptionId"> | null,
): boolean {
  return !!sub?.stripeSubscriptionId && LIVE.has(sub.status);
}

async function stripeFailed(id: string): Promise<TRPCError> {
  console.error("[TimeWren billing] Stripe call failed", id);
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: await tr("serverErrors", "subscription.stripeUnavailable"),
  });
}

const STRIPE_LIVE = new Set(["active", "trialing", "past_due", "unpaid"]);

async function hasLiveSubscriptionInStripe(
  stripe: Stripe,
  customer: string,
): Promise<boolean> {
  const list = await stripe.subscriptions.list({
    customer,
    status: "all",
    limit: 20,
  });
  return list.data.some(
    (s) =>
      STRIPE_LIVE.has(s.status) && s.metadata?.brand === TIMEWREN_STRIPE_BRAND,
  );
}

/**
 * Udløber organisationens åbne TimeWren-checkouts. Returnerer true, hvis et
 * af dem blev gennemført, før det nåede at udløbe: så findes der allerede et
 * abonnement, og der må ikke oprettes et checkout nummer to.
 */
async function expireOpenCheckouts(
  stripe: Stripe,
  customer: string,
): Promise<boolean> {
  const open = await stripe.checkout.sessions.list({
    customer,
    status: "open",
    limit: 20,
  });
  for (const s of open.data) {
    if (s.metadata?.brand !== TIMEWREN_STRIPE_BRAND) continue;
    try {
      await stripe.checkout.sessions.expire(s.id);
    } catch (err) {
      // Stripe afviser at udløbe et checkout, der ikke længere er åbent.
      const now = await stripe.checkout.sessions.retrieve(s.id);
      if (now.status === "complete") return true;
      if (now.status !== "expired") throw err;
    }
  }
  return false;
}

/**
 * Mailen, som organisationens Stripe-kunde oprettes med: ejerens, så to
 * administratorer, der starter samtidig, sender samme parametre under samme
 * idempotensnøgle og dermed får samme kunde.
 */
async function customerEmail(
  db: Db,
  orgId: string,
  fallback: string,
): Promise<string> {
  const owner = await db.query.members.findFirst({
    where: and(eq(members.organizationId, orgId), eq(members.role, "owner")),
    columns: { userId: true },
  });
  if (!owner) return fallback;
  const row = await db.query.users.findFirst({
    where: eq(users.id, owner.userId),
    columns: { email: true },
  });
  return row?.email ?? fallback;
}

export interface TimewrenCheckoutOptions {
  stripe: Stripe;
  userId: string;
  orgId: string;
  /** Brandets app-URL (appUrlForHost), aldrig timetrack.dk. */
  appUrl: string;
  /** With a non-blocking database lock for this organization. */
  withOrgLock: <T>(fn: (db: Db) => Promise<T>) => Promise<T>;
  /** Organisationens styrende abonnement, læst under låsen. */
  loadSub: (db: Db) => Promise<GoverningSubscription | null>;
  tier: TimewrenPaidTier;
  seats?: number;
  returnPath?: string;
}

export async function withTimewrenCheckoutLock<T>(
  db: Db,
  orgId: string,
  fn: (db: Db) => Promise<T>,
): Promise<T> {
  const result = await db.transaction(async (tx) => {
    const [row] = await tx.execute<{ locked: boolean }>(
      sql`select pg_try_advisory_xact_lock(hashtext(${`timewren-checkout:${orgId}`})) as locked`,
    );
    if (!row?.locked) return { outcome: "busy" } as const;
    // Commit the Stripe customer ID even if a later Stripe call failed.
    // Holding the lock and writing through the same connection avoids
    // borrowing a second connection from the pool while the lock is held.
    try {
      return {
        outcome: "success",
        value: await fn(tx as unknown as Db),
      } as const;
    } catch (error) {
      return { outcome: "error", error } as const;
    }
  });
  if (result.outcome === "busy") {
    throw new TRPCError({
      code: "CONFLICT",
      message: await tr("serverErrors", "subscription.stripeCheckoutBusy"),
    });
  }
  if (result.outcome === "error") throw result.error;
  return result.value;
}

export function createTimewrenCheckout(
  opts: TimewrenCheckoutOptions,
): Promise<{ url: string }> {
  return opts.withOrgLock(async (db) =>
    createCheckoutLocked(opts, db, await opts.loadSub(db)),
  );
}

async function createCheckoutLocked(
  opts: TimewrenCheckoutOptions,
  db: Db,
  sub: GoverningSubscription | null,
): Promise<{ url: string }> {
  const { stripe, userId, orgId } = opts;
  // Planskift og sæder på et løbende abonnement sker i portalen, så der
  // aldrig oprettes et abonnement nummer to.
  if (hasLiveStripeSubscription(sub)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: await tr("serverErrors", "subscription.stripeAlreadyActive"),
    });
  }

  const user = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { email: true, locale: true },
  });
  if (!user) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "common.userNotFound"),
    });
  }
  const seatsInUse = (await countSeatUsage(db, orgId)).total;

  let newCustomerId: string | null = null;
  try {
    const prices = await timewrenPrices(stripe);
    // Genbrug organisationens Stripe-kunde, eller opret en under org-låsen.
    let customerId = sub?.stripeCustomerId ?? null;
    if (!customerId) {
      // Nøglen og parametrene afhænger kun af organisationen: et kald, der
      // ikke kan gemme kunden (ingen abonnementsrække endnu), får samme kunde
      // igen ved næste forsøg i stedet for en kunde nummer to.
      const customer = await stripe.customers.create(
        {
          email: await customerEmail(db, orgId, user.email),
          metadata: {
            brand: TIMEWREN_STRIPE_BRAND,
            organizationId: orgId,
          },
        },
        { idempotencyKey: `timewren-customer:${orgId}` },
      );
      customerId = customer.id;
      newCustomerId = customerId;
    }

    // Kun det nyeste checkout kan betales; et ældre åbent checkout ville
    // ellers kunne gennemføres som abonnement nummer to. Det sker før
    // abonnementstjekket: et checkout, der gennemføres undervejs, er enten
    // udløbet (og kan ikke betales) eller et abonnement, som tjekket ser.
    const completedMeanwhile = await expireOpenCheckouts(stripe, customerId);
    // Den lokale række kan halte efter Stripe: et checkout fra en anden fane
    // kan være gennemført, før webhooken har skrevet abonnementet.
    if (
      completedMeanwhile ||
      (await hasLiveSubscriptionInStripe(stripe, customerId))
    ) {
      throw new TRPCError({
        code: "CONFLICT",
        message: await tr("serverErrors", "subscription.stripeAlreadyActive"),
      });
    }

    const session = await stripe.checkout.sessions.create(
      timewrenCheckoutParams({
        tier: opts.tier,
        priceId: prices[opts.tier].id,
        quantity: checkoutQuantity(opts.tier, opts.seats, seatsInUse),
        customerId,
        organizationId: orgId,
        userId,
        appUrl: opts.appUrl,
        // Prøveperioden gives kun ved første abonnement.
        withTrial: !sub?.stripeSubscriptionId,
        returnPath: opts.returnPath,
        locale: user.locale ?? undefined,
      }),
    );
    if (!session.url) throw new Error("Checkout session without url");
    return { url: session.url };
  } catch (err) {
    if (err instanceof TRPCError) throw err;
    throw await stripeFailed(orgId);
  } finally {
    if (sub && newCustomerId) {
      await db
        .update(subscriptions)
        .set({ stripeCustomerId: newCustomerId, updatedAt: new Date() })
        .where(eq(subscriptions.id, sub.id));
    }
  }
}

export async function createTimewrenPortal(opts: {
  stripe: Stripe;
  appUrl: string;
  sub: GoverningSubscription | null;
}): Promise<{ url: string }> {
  const customer = opts.sub?.stripeCustomerId;
  if (!customer) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "subscription.stripeNoCustomer"),
    });
  }
  try {
    const portal = await opts.stripe.billingPortal.sessions.create({
      customer,
      configuration: await timewrenPortalConfiguration(
        opts.stripe,
        opts.appUrl,
      ),
      return_url: `${opts.appUrl}/dashboard/settings/subscription`,
    });
    return { url: portal.url };
  } catch {
    throw await stripeFailed(customer);
  }
}
