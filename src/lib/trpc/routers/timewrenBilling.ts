// Betaling på TimeWren Cloud med Stripe i EUR (docs/specs/timewren-cloud.md →
// "Betaling på TimeWren"). TimeTrack-konti afvises her og betaler via Alunta
// (subscription.ts), som er uændret.

import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { accountBrand } from "@/lib/auth/account-brand";
import {
  assertStripeCheckoutAvailable,
  assertStripeCheckoutOrganization,
} from "@/lib/billing/assert-checkout";
import { isFreeSubscription } from "@/lib/billing/plan-limits";
import { countSeatUsage } from "@/lib/billing/seat-usage";
import {
  createTimewrenCheckout,
  createTimewrenPortal,
  hasLiveStripeSubscription,
} from "@/lib/billing/timewren-checkout";
import {
  isStripeBillingBrand,
  TIMEWREN_TRIAL_DAYS,
} from "@/lib/billing/timewren-stripe";
import { appUrlForHost } from "@/lib/brands/app-url";
import { timewrenPlans } from "@/lib/brands/timewren-pricing";
import { getStripe } from "@/lib/stripe";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";
import { resolveActiveSubscription } from "./subscription";

/** Brandets app-URL ud fra requestens host (aldrig timetrack.dk). */
function brandAppUrl(headers: Headers | null | undefined): string {
  return appUrlForHost(headers?.get("host"));
}

export const timewrenBillingRouter = router({
  /** Planer i EUR og kontoens abonnement til abonnementssiden. */
  overview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const enabled = isStripeBillingBrand(await accountBrand(ctx.db, userId));
    if (!enabled) return { enabled: false as const };

    const sub = await resolveActiveSubscription(ctx.db, ctx.orgId, userId, {
      stripe: true,
    });
    const seatsInUse = ctx.orgId
      ? (await countSeatUsage(ctx.db, ctx.orgId)).total
      : 1;
    const isFree = !sub || isFreeSubscription(sub);
    return {
      enabled: true as const,
      trialDays: TIMEWREN_TRIAL_DAYS,
      // Prøveperioden gives kun ved første abonnement.
      trialEligible: !sub?.stripeSubscriptionId,
      seatsInUse,
      plans: timewrenPlans().map((p) => ({
        tier: p.tier,
        priceEur: p.monthly.EUR,
        perUser: p.perUser,
        minUsers: p.minUsers,
        maxUsers: p.maxUsers,
        maxActiveClients: p.maxActiveClients,
      })),
      current: {
        tier: isFree ? "free" : (sub?.planTier ?? "free"),
        status: sub?.status ?? "free",
        isFree,
        seatCount: sub?.seatCount ?? 1,
        cancelAtPeriodEnd: !!sub?.cancelAtPeriodEnd,
        currentPeriodEnd: sub?.currentPeriodEnd ?? null,
        trialEndsAt: sub?.status === "trialing" ? sub.trialEndsAt : null,
        hasLiveSubscription: hasLiveStripeSubscription(sub),
        canOpenPortal: !!sub?.stripeCustomerId,
      },
    };
  }),

  /** Stripe Checkout for en betalt plan. Kun ejer/admin. */
  checkout: orgAdminProcedure
    .input(
      z.object({
        tier: z.enum(["privat", "solo", "team", "business"]),
        seats: z.number().int().min(1).max(500).optional(),
        returnPath: z.string().max(200).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertStripeCheckoutAvailable(ctx.db, userId);
      const orgId = ctx.orgId;
      if (!orgId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "subscription.noOrganization"),
        });
      }
      await assertStripeCheckoutOrganization(ctx.db, orgId);
      return createTimewrenCheckout({
        db: ctx.db,
        stripe: getStripe(),
        userId,
        orgId,
        appUrl: brandAppUrl(ctx.headers),
        withOrgLock: (fn) =>
          ctx.db.transaction(async (tx) => {
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtext(${`timewren-checkout:${orgId}`}))`,
            );
            return fn(tx as unknown as typeof ctx.db);
          }),
        loadSub: (db) =>
          resolveActiveSubscription(db, orgId, userId, { stripe: true }),
        tier: input.tier,
        seats: input.seats,
        returnPath: input.returnPath,
      });
    }),

  /** Stripe-kundeportal: skift plan og sæder, kort, opsig, fakturaer. */
  portal: orgAdminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    await assertStripeCheckoutAvailable(ctx.db, userId);
    return createTimewrenPortal({
      stripe: getStripe(),
      appUrl: brandAppUrl(ctx.headers),
      sub: await resolveActiveSubscription(ctx.db, ctx.orgId, userId, {
        stripe: true,
      }),
    });
  }),
});
