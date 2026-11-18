import { and, eq, isNull, lt, not, or } from "drizzle-orm";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { FREE_TIER_SUBSCRIPTION_FIELDS } from "@/lib/billing/plan-limits";
import { isTimewrenStripeEnabled } from "@/lib/billing/timewren-stripe";
import { timewrenStripeRow } from "@/lib/billing/timewren-trial-rows";
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

const STRIPE_TRIAL_GRACE_MS = 3 * 24 * 60 * 60 * 1000;

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

  // TimeWren Cloud (Stripe): Stripe afslutter selv prøven og opkræver, og
  // webhooken skriver den nye status. Rør kun en TimeWren-Stripe-række, hvis
  // den stadig står som prøve STRIPE_TRIAL_GRACE_MS efter prøvens slutning.
  // Kun når TimeWren-betalingen er slået til, og kun TimeWren-organisationers
  // rækker: TimeTrack-rækker med et historisk Stripe-id er som før.
  const stripeCutoff = new Date(now.getTime() - STRIPE_TRIAL_GRACE_MS);

  const unpaidExpiredFilter = and(
    isNull(subscriptions.aluntaSubscriptionId),
    // Betalt i appen: butikken styrer rækken, aldrig nedgradér den her.
    notStoreManaged(),
    isTimewrenStripeEnabled()
      ? or(
          not(timewrenStripeRow()),
          lt(subscriptions.trialEndsAt, stripeCutoff),
        )
      : undefined,
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
