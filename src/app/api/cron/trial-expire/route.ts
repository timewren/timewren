import { and, eq, isNull, lt, or } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { subscriptions } from "@/lib/db/schema";
import { notStoreManaged } from "@/lib/store-billing/persist";

// Cron schedule: 0 2 * * * (every day at 02:00)
//
// Reverse trial: once a trial's trial_ends_at is in the past AND it never
// completed checkout (no alunta_subscription_id), the subscription drops to
// the permanent Gratis-tier (status + planTier "free", FREE_MAX_SEATS seats)
// instead of hitting a paywall. All data is kept; the user can upgrade any
// time via Alunta checkout, at which point the webhook flips status to
// `active` and sets the paid tier.
//
// Teams land on Gratis too (Mads 1/10-2026: Gratis = 3 brugere). If the org
// has more members than Gratis allows, the owner and the next members in line
// keep access and the rest are locked until the owner upgrades — see
// freeSeatHolderIds / hasActiveSubscription. Orgs that were parked on
// `trial_expired` by the earlier rule (2+ members → paywall) are moved to
// Gratis by the same run.

export const GET = withCronLogging("trial-expire", async (_request) => {
  // Uden betalingsudbyder (selvhost) findes ingen planer eller prøveperioder
  if (!isBillingEnabled()) {
    return {
      itemsProcessed: 0,
      itemsSucceeded: 0,
      metadata: { skipped: "billing-disabled" },
    };
  }

  const now = new Date();

  const unpaidExpiredFilter = and(
    isNull(subscriptions.aluntaSubscriptionId),
    // Betalt i appen: butikken styrer rækken, aldrig nedgradér den her.
    notStoreManaged(),
    or(
      and(
        eq(subscriptions.status, "trialing"),
        lt(subscriptions.trialEndsAt, now),
      ),
      eq(subscriptions.status, "trial_expired"),
    ),
  );

  // The filter is evaluated in the update itself, so a checkout that lands
  // mid-run (sets alunta_subscription_id / status) is never downgraded.
  const downgraded = await db
    .update(subscriptions)
    .set({ ...FREE_TIER_SUBSCRIPTION_FIELDS, updatedAt: now })
    .where(unpaidExpiredFilter)
    .returning({ id: subscriptions.id });

  return {
    itemsProcessed: downgraded.length,
    itemsSucceeded: downgraded.length,
    metadata: {
      downgradedToFree: downgraded.map((e) => e.id),
    },
  };
});
