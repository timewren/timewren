import { and, desc, eq, isNull, sql } from "drizzle-orm";
import type { db as DbHandle } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";

type Db = typeof DbHandle;

/**
 * Resolve the subscription governing the current context, preferring the
 * organization's subscription over the caller's personal one. Replaces a
 * non-deterministic `or(organizationId, userId)` lookup that could return a
 * team member's own (e.g. expired/solo) subscription instead of the org's —
 * which would gate them behind the paywall despite an active team plan.
 */
export async function resolveActiveSubscription(
  db: Db,
  orgId: string | null | undefined,
  userId: string,
  opts: { stripe?: boolean } = {},
) {
  // Deterministic order: an org can accumulate several rows (each member's
  // onboarding / checkout inserts one). Prefer a paid/trialing row linked to
  // Alunta or an app store, then the newest — never an arbitrary expired/solo row, which would
  // drive the wrong price and, worse, point billing mutations at the wrong sub.
  //
  // `stripe` (TimeWren Cloud only, set by timewrenBilling for Stripe-billed
  // accounts): a Stripe row counts as provider-linked and still governs while
  // past_due — it is the one the owner must fix in the portal, not a newer
  // Gratis row. Opt-in because TimeTrack rows may carry historic Stripe ids
  // from before the Alunta migration and must order exactly as before.
  const preferenceOrder = opts.stripe
    ? [
        desc(
          sql`case when ${subscriptions.status} in ('active','trialing') or (${subscriptions.status} = 'past_due' and ${subscriptions.stripeSubscriptionId} is not null) then 1 else 0 end`,
        ),
        desc(
          sql`case when ${subscriptions.stripeSubscriptionId} is not null or ${subscriptions.aluntaSubscriptionId} is not null or ${subscriptions.storeProvider} is not null then 1 else 0 end`,
        ),
        desc(subscriptions.createdAt),
      ]
    : [
        desc(
          sql`case when ${subscriptions.status} in ('active','trialing') then 1 else 0 end`,
        ),
        desc(
          sql`case when ${subscriptions.aluntaSubscriptionId} is not null or ${subscriptions.storeProvider} is not null then 1 else 0 end`,
        ),
        desc(subscriptions.createdAt),
      ];
  if (orgId) {
    const orgSub = await db.query.subscriptions.findFirst({
      where: eq(subscriptions.organizationId, orgId),
      orderBy: preferenceOrder,
    });
    if (orgSub) return orgSub;
  }
  // Kun personlige/legacy-rækker uden organisation kan bruges som fallback.
  return (
    (await db.query.subscriptions.findFirst({
      where: and(
        eq(subscriptions.userId, userId),
        isNull(subscriptions.organizationId),
      ),
      orderBy: preferenceOrder,
    })) ?? null
  );
}
