// Subscriptions are org-scoped (with userId fallback for legacy/personal accounts)

import { TRPCError } from "@trpc/server";
import { and, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { toIntlLocale } from "@/i18n/format-locale";
import { st, tr } from "@/i18n/server-text";
import { type AluntaSubscription, alunta } from "@/lib/alunta";
import { authBrandForHost } from "@/lib/auth/host-auth";
import { assertCheckoutAvailable } from "@/lib/billing/assert-checkout";
import { isBillingEnabled } from "@/lib/billing/billing-enabled";
import { isCheckoutAvailableForBrand } from "@/lib/billing/brand-billing";
import {
  countActiveClients,
  displayedMaxActiveClients,
  isFreeSubscription,
  isFreeTierMemberLocked,
  planLimits,
} from "@/lib/billing/plan-limits";
import { countSeatUsage } from "@/lib/billing/seat-usage";
import {
  findObsoleteSeatsSubs,
  findObsoleteSubsOnUpgrade,
  isLiveAluntaStatus,
  tierRank,
  upgradeSeatCount,
  validateExtraSeatsPurchase,
} from "@/lib/billing/seats";
import {
  clampSeats,
  FREE_TRIAL_DAYS,
  getAluntaPlanId,
  getAluntaSeatsPlanIdForTier,
  getAppUrl,
  getFeedbackRecipient,
  includedSeatsForTier,
  isPrivatPlanConfigured,
  monthlyListPriceForSubscription,
  planNameForTier,
  priceBookForAluntaPlan,
  seatPriceForTier,
  totalPriceForTierSeats,
} from "@/lib/config";
import type { db as DbHandle } from "@/lib/db";
import { invoices, subscriptions, timeEntries, users } from "@/lib/db/schema";
import { sendCancellationConfirmedEmail } from "@/lib/email/billing";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import {
  storeManageUrl,
  storeProviderLabel,
} from "@/lib/store-billing/products";
import { isStoreManaged } from "@/lib/store-billing/state";
import {
  orgAdminProcedure,
  protectedProcedure,
  publicProcedure,
  router,
} from "../trpc";

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
) {
  // Deterministic order: an org can accumulate several rows (each member's
  // onboarding / checkout inserts one). Prefer a paid/trialing row linked to
  // Alunta or an app store, then the newest — never an arbitrary expired/solo row, which would
  // drive the wrong price and, worse, point billing mutations at the wrong sub.
  const preferenceOrder = [
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
    // Orgen har ingen egen række: fald tilbage til brugerens personlige/legacy
    // række, men ALDRIG en række der tilhører en ANDEN organisation — ellers
    // kunne et medlem uden egen org-subscription arve en tidligere (forladt)
    // organisations pris og faktureringsdata.
    return (
      (await db.query.subscriptions.findFirst({
        where: and(
          eq(subscriptions.userId, userId),
          or(
            isNull(subscriptions.organizationId),
            eq(subscriptions.organizationId, orgId),
          ),
        ),
        orderBy: preferenceOrder,
      })) ?? null
    );
  }
  // Org-løs kalder (fjernet medlem eller aldrig haft en org): kun
  // personlige/legacy rækker uden organizationId. Uden dette filter ville
  // `userId`-opslaget stadig finde den subscription-række, brugeren fik da
  // vedkommende oprettede sin (nu forladte) organisation, og lække dens
  // pris og faktureringsdata til et fjernet medlem.
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

/**
 * Alle Alunta-subscriptions for kunden, som UNION af flere mulige
 * external_customer_id'er (orgId for nye kunder, userId for legacy) og med
 * fuld pagination — bruges til at UDPEGE de subscriptions en erstatnings-
 * checkout skal annullere (#424). Dedupleret på uuid.
 */
async function listAllAluntaSubsForCustomer(
  externalIds: (string | null | undefined)[],
  customerUuid?: string | null,
): Promise<AluntaSubscription[]> {
  // Se alunta.subscriptions.listAllForCustomer: add-ons oprettet manuelt i
  // Alunta bærer ikke external_customer_id — kun kunden gør.
  return alunta.subscriptions.listAllForCustomer(externalIds, customerUuid);
}

/**
 * Et abonnement købt i appen ændres og opsiges i App Store/Google Play —
 * aldrig via Alunta (det ville give dobbeltbetaling eller ramme et gammelt
 * web-abonnement på samme række).
 */
function assertNotStoreManaged(
  subscription: {
    storeProvider: string | null;
    storeStatus: string | null;
  } | null,
) {
  if (subscription && isStoreManaged(subscription)) {
    const label = storeProviderLabel(subscription.storeProvider);
    throw new TRPCError({
      code: "CONFLICT",
      message: st("subscription.storeManaged", { provider: label }),
    });
  }
}

function getAluntaPlanIdForTier(
  tier: string,
  billingCycle: "monthly" | "yearly",
): string {
  if (tier === "team") {
    const id =
      billingCycle === "monthly"
        ? process.env.ALUNTA_PLAN_TEAM_MONTHLY
        : process.env.ALUNTA_PLAN_TEAM_YEARLY;
    // Fail loud rather than silently charging the solo plan — a silent
    // fallback would bill team customers for solo and give them 1 seat.
    if (!id) {
      throw new Error(st("subscription.teamPlanNotConfigured"));
    }
    return id;
  }
  if (tier === "business") {
    const id =
      billingCycle === "monthly"
        ? process.env.ALUNTA_PLAN_BUSINESS_MONTHLY
        : process.env.ALUNTA_PLAN_BUSINESS_YEARLY;
    if (!id) {
      throw new Error(st("subscription.businessPlanNotConfigured"));
    }
    return id;
  }
  if (tier === "privat") {
    const id =
      billingCycle === "monthly"
        ? process.env.ALUNTA_PLAN_PRIVAT_MONTHLY
        : process.env.ALUNTA_PLAN_PRIVAT_YEARLY;
    // Privat er kun købbar når planen er oprettet i Alunta og sat i env.
    if (!id) {
      throw new Error(st("subscription.privatePlanNotAvailable"));
    }
    return id;
  }
  if (tier === "free") {
    throw new Error(st("subscription.freeNotPurchasable"));
  }
  return getAluntaPlanId(billingCycle);
}

export const subscriptionRouter = router({
  // Get subscription details with computed fields
  // Om betaling overhovedet gælder (selvhost uden udbyder = nej). Klienten
  // læser kun dette flag, aldrig betalingsnøglerne selv.
  // checkoutAvailable: false på TimeWren-hosts, hvor betaling kommer senere
  // (lib/billing/brand-billing.ts). Hosten afgør det, fordi kun TimeWren-konti
  // kan logge ind dér; serveren tjekker kontoens brand ved selve checkout.
  billingEnabled: publicProcedure.query(({ ctx }) => ({
    enabled: isBillingEnabled(),
    checkoutAvailable: isCheckoutAvailableForBrand(
      authBrandForHost(ctx.headers?.get("host")),
    ),
  })),

  getDetails: protectedProcedure.query(async ({ ctx }) => {
    // Uden billing findes ingen plan: null = ingen plan-gate, ingen trial
    if (!isBillingEnabled()) return null;
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!subscription) return null;

    // Compute trial info
    const now = new Date();
    const trialEndsAt = subscription.trialEndsAt;
    const trialDaysRemaining =
      subscription.status === "trialing"
        ? Math.max(
            0,
            Math.ceil(
              (trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
            ),
          )
        : 0;
    const isTrialExpired =
      subscription.status === "trialing" && trialEndsAt < now;
    const isFree = isFreeSubscription(subscription);

    // Display price — tier- AND seat-aware, so team/business customers with
    // per-seat add-ons see their real total (base + extra seats), not the solo
    // or bare-base price. Discount applies to the full list total.
    const billingCycle =
      subscription.billingCycle === "yearly" ? "yearly" : "monthly";
    const tier = isFree ? "free" : (subscription.planTier ?? "solo");
    const includedSeats = includedSeatsForTier(tier);
    // Opsagte betalere beholder deres gamle (høje) seatCount på rækken, men
    // på Gratis vises og prissættes der aldrig over tierens loft.
    const seatCount = isFree
      ? Math.min(subscription.seatCount ?? includedSeats, includedSeats)
      : (subscription.seatCount ?? includedSeats);
    const extraSeats = Math.max(0, seatCount - includedSeats);
    const discountPct = subscription.discountPercent || 0;
    const applyDiscount = (price: number) =>
      discountPct > 0 ? Math.round(price * (1 - discountPct / 100)) : price;

    // Grandfathered kunder (legacy-/founding-plan i Alunta) ser den gamle
    // pris de faktisk opkræves — ikke den nye prisstige.
    const priceBook = isFree
      ? "current"
      : priceBookForAluntaPlan(subscription.aluntaPlanId);
    const listPrice = totalPriceForTierSeats(
      tier,
      billingCycle,
      seatCount,
      priceBook,
    );
    const actualPrice = applyDiscount(listPrice);
    const suffix =
      billingCycle === "yearly"
        ? await tr("serverErrors", "subscription.priceSuffixYear")
        : await tr("serverErrors", "subscription.priceSuffixMonth");
    const displayPrice = `${actualPrice} ${suffix}`;
    const originalPrice = discountPct > 0 ? `${listPrice} ${suffix}` : null;
    const planName = planNameForTier(tier);

    // Both cycles at the customer's actual tier + seats, for the plan-switch UI
    // (so a team customer isn't shown the hardcoded solo 99/990 figures).
    const monthlyList = totalPriceForTierSeats(
      tier,
      "monthly",
      seatCount,
      priceBook,
    );
    const yearlyList = totalPriceForTierSeats(
      tier,
      "yearly",
      seatCount,
      priceBook,
    );
    const priceByCycle = {
      monthly: { actual: applyDiscount(monthlyList), original: monthlyList },
      yearly: { actual: applyDiscount(yearlyList), original: yearlyList },
    };

    // Next billing date (Gratis faktureres aldrig)
    const nextBillingDate = isFree
      ? null
      : subscription.currentPeriodEnd || trialEndsAt;

    // Plan-grænser + forbrug til UI'et. null = ubegrænset (Infinity
    // serialiseres ikke pænt til alle klienter).
    const limits = planLimits(tier);
    const activeClients = await countActiveClients(ctx.db, ctx.orgId, userId);
    // Medlem nr. 4+ i en org på Gratis — dashboardet viser en lås i stedet
    // for at lade hvert kald fejle (spejler hasActiveSubscription).
    const memberLocked =
      isFree && ctx.orgId
        ? await isFreeTierMemberLocked(ctx.db, ctx.orgId, userId)
        : false;

    return {
      ...subscription,
      trialDaysRemaining,
      isTrialExpired,
      isFree,
      limits: {
        maxActiveClients: displayedMaxActiveClients(tier),
        maxSeats: limits.maxSeats,
      },
      usage: { activeClients },
      memberLocked,
      displayPrice,
      originalPrice,
      planName,
      includedSeats,
      extraSeats,
      discountPercent: discountPct,
      priceByCycle,
      priceBook,
      // Pris pr. ekstra plads på kundens egen prisliste (legacy vs. ny).
      seatUnitPrice: seatPriceForTier(tier, billingCycle, priceBook),
      nextBillingDate,
      // Feature-gate for self-service pladskøb: kun når tierens seats-plan er
      // konfigureret i env (fx mangler ALUNTA_PLAN_BUSINESS_SEATS endnu).
      seatsPlanConfigured: !!getAluntaSeatsPlanIdForTier(tier, priceBook),
      // Per-tier gates til opgraderings-UI'et: en org med ekstra pladser må
      // ikke opgradere til en tier hvor pladserne ikke kan gentegnes (#424).
      // Privat kan kun købes når begge Privat-planer er sat i env (samme gate
      // som getAluntaPlanIdForTier) — styrer om plan-vælgeren viser den.
      privatAvailable: isPrivatPlanConfigured(),
      // Købt i appen: web-UI'et viser butikken i stedet for Alunta-knapper.
      storeManaged: isStoreManaged(subscription),
      storeManageUrl: subscription.storeProvider
        ? storeManageUrl(
            subscription.storeProvider,
            subscription.storeProductId,
          )
        : null,
      seatsPlanConfiguredByTier: {
        team: !!getAluntaSeatsPlanIdForTier("team"),
        business: !!getAluntaSeatsPlanIdForTier("business"),
      },
    };
  }),

  // Create Alunta Checkout Session — billing is owner/admin-only
  createCheckoutSession: orgAdminProcedure
    .input(
      z.object({
        billingCycle: z.enum(["monthly", "yearly"]).optional(),
        planTier: z.enum(["privat", "solo", "team", "business"]).optional(),
        seatCount: z.number().int().positive().optional(),
        successUrl: z.string().optional(),
        cancelUrl: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertCheckoutAvailable(ctx.db, userId);

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, name: true },
      });

      if (!user)
        throw new Error(await tr("serverErrors", "common.userNotFound"));

      let subscription = await resolveActiveSubscription(
        ctx.db,
        ctx.orgId,
        userId,
      );
      assertNotStoreManaged(subscription);

      // Guard against creating a SECOND Alunta subscription for a customer who
      // already has a live one (trialing tæller også — det er et løbende abo).
      // Eneste undtagelse er en REN tier-OPGRADERING (solo→team, solo→business,
      // team→business): Alunta har intet API til at skifte plan på et
      // eksisterende abonnement, så opgradering sker som "erstat og annullér" —
      // ny checkout her, og webhooken annullerer de gamle subs når den nye
      // aktiveres. Samme tier / nedgradering blokeres fortsat.
      let upgradeFromTier: string | null = null;
      if (
        subscription &&
        isLiveAluntaStatus(subscription.status) &&
        subscription.aluntaSubscriptionId
      ) {
        const currentTier = subscription.planTier ?? "solo";
        const requestedTier = input.planTier ?? currentTier;
        const isUpgrade = tierRank(requestedTier) > tierRank(currentTier);
        if (!isUpgrade) {
          throw new Error(
            await tr("serverErrors", "subscription.alreadyActive"),
          );
        }
        upgradeFromTier = currentTier;
      }

      const billingCycle =
        input.billingCycle ||
        (subscription?.billingCycle as "monthly" | "yearly") ||
        "monthly";

      // If no subscription exists, create one (e.g. user reaching paywall without onboarding)
      if (!subscription) {
        const trialEndsAt = new Date();
        trialEndsAt.setDate(trialEndsAt.getDate() + FREE_TRIAL_DAYS);

        // Founding member offer is closed — new subscriptions pay full price.
        const [created] = await ctx.db
          .insert(subscriptions)
          .values({
            userId,
            organizationId: ctx.orgId,
            billingCycle,
            status: "trialing",
            isTrial: true,
            trialEndsAt,
          })
          .returning();

        subscription = created;
      }

      // Founding member offer is closed to new users; only existing
      // founding members keep their discount.
      const isFoundingMember = subscription.foundingTier === "founding_member";

      // Resolve tier: explicit input wins, else inherit the tier already on
      // the (trial) subscription, else solo. This lets the settings page
      // "add payment" button check out the customer's actual plan without
      // needing to re-pick a tier.
      // Gratis kan ikke købes — en Gratis-kunde uden valgt tier checker ud
      // på Solo (den plan de havde i trial).
      const planTier = (input.planTier ??
        (subscription.planTier === "free" ? null : subscription.planTier) ??
        "solo") as "privat" | "solo" | "team" | "business";

      // Resolve seat quantity: ved OPGRADERING skal kapaciteten FØLGE MED
      // (#424 fund 1) — nuværende effektive maxSeats, ALDRIG kun de
      // inkluderede pladser (det ville slette betalt plads-kapacitet).
      // Ellers: explicit input wins, else the seats already on the
      // subscription, clamped to the tier's range.
      const seatCount = upgradeFromTier
        ? upgradeSeatCount(
            planTier,
            subscription.seatCount,
            subscription.maxSeats,
          )
        : clampSeats(planTier, input.seatCount ?? subscription.seatCount ?? 1);

      // Opgradering: udpeg de konkrete subs checkouten erstatter og bær dem i
      // metadata (ankeret for webhookens annullering, #424). Union af org- og
      // user-nøglede kunder — legacy-kunder er nøglet på userId i Alunta.
      // Har org'en plads-kapacitet ud over den nye tiers inkluderede, kræver
      // opgradering at seats-planen findes på den nye tier (ellers ville
      // pladserne gå tabt / aldrig blive faktureret).
      let upgradeReplacesUuids: string[] | null = null;
      let upgradeExtraSeatsNeeded = 0;
      if (upgradeFromTier) {
        upgradeExtraSeatsNeeded = Math.max(
          0,
          seatCount - includedSeatsForTier(planTier),
        );
        if (
          upgradeExtraSeatsNeeded > 0 &&
          !getAluntaSeatsPlanIdForTier(planTier)
        ) {
          throw new Error(
            await tr("serverErrors", "subscription.seatsExceedIncluded", {
              seats: seatCount,
              extra: upgradeExtraSeatsNeeded,
              included: includedSeatsForTier(planTier),
              plan: planNameForTier(planTier),
            }),
          );
        }
        const existingSubs = await listAllAluntaSubsForCustomer([
          ctx.orgId,
          userId,
        ]);
        upgradeReplacesUuids = findObsoleteSubsOnUpgrade(
          "",
          planTier,
          existingSubs,
        ).map((s) => s.uuid);
      }

      const planId = getAluntaPlanIdForTier(planTier, billingCycle);

      const appUrl = getAppUrl();
      // Ved opgradering med ekstra pladser: send kunden retur til
      // pladskøbs-flowet, så add-on'en gentegnes på den nye tiers sats.
      const successUrl =
        input.successUrl ||
        `${appUrl}/dashboard/settings/subscription?success=true${
          upgradeFromTier && upgradeExtraSeatsNeeded > 0
            ? `&reseats=${upgradeExtraSeatsNeeded}`
            : ""
        }`;
      const cancelUrl =
        input.cancelUrl ||
        `${appUrl}/dashboard/settings/subscription?canceled=true`;

      // ── Build metadata for Alunta checkout ──────────────────────────
      const metadata: Record<string, unknown> = {
        // Pre-fill customer info so they don't have to type it again
        email: user.email,
        ...(user.name ? { name: user.name } : {}),
        country: "dk",
        // Pre-select the correct billing interval
        preferred_interval: billingCycle === "yearly" ? 12 : 1,
        // Pass plan tier + seat count so the webhook can write
        // planTier/seatCount/maxSeats after payment.
        plan_tier: planTier,
        seat_count: seatCount,
        // Markér tier-opgraderinger så webhooken (og fejlsøgning) kan se at
        // denne checkout erstatter et eksisterende abonnement — og bær de
        // KONKRETE sub-UUID'er der skal annulleres (#424: annullér aldrig ud
        // fra klassificering alene).
        ...(upgradeFromTier ? { upgrade_from: upgradeFromTier } : {}),
        ...(upgradeReplacesUuids !== null
          ? { replaces_subscription_uuids: upgradeReplacesUuids }
          : {}),
      };

      // Calculate remaining trial days and pass to Alunta so they don't
      // charge before our trial expires
      const now = new Date();
      const trialEndsAt = subscription.trialEndsAt;
      const remainingTrialDays = Math.max(
        0,
        Math.ceil(
          (trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );

      if (remainingTrialDays > 0) {
        metadata.trial_enabled = true;
        metadata.trial_type = "days";
        metadata.trial_value = remainingTrialDays;
      } else {
        // Trial already expired — no trial in Alunta
        metadata.trial_enabled = false;
      }

      console.warn("[Checkout] Creating Alunta session:", {
        plan_id: planId,
        external_customer_id: ctx.orgId || userId,
        success_url: successUrl,
        billingCycle,
        isFoundingMember,
        remainingTrialDays,
        metadata,
      });

      try {
        // NB: Alunta's Team/Business base-plans er FLAT_RATE (fast basispris
        // dækker de inkluderede pladser). Vi sender derfor IKKE en
        // `quantity`-multiplier — det ville fejlopkræve (fx 2×199). Den valgte
        // seatCount følger med i metadata.seat_count, så webhooken kan tildele
        // pladskapacitet; betaling for ekstra pladser sker via det separate
        // ekstra-seats-flow (ALUNTA_PLAN_TEAM_SEATS / portal).
        const session = await alunta.checkoutSessions.create({
          plan_id: planId,
          external_customer_id: ctx.orgId || userId,
          success_url: successUrl,
          back_url: cancelUrl,
          metadata,
        });

        console.warn(
          "[Checkout] Alunta session response:",
          JSON.stringify(session, null, 2),
        );

        const checkoutUrl = session.data?.checkout_url;

        if (!checkoutUrl) {
          console.error(
            "[Checkout] No checkout_url in response:",
            JSON.stringify(session, null, 2),
          );
          throw new Error(
            await tr("serverErrors", "subscription.noCheckoutUrl"),
          );
        }

        return { url: checkoutUrl };
      } catch (error) {
        console.error("[Checkout] Alunta API error:", error);
        throw error;
      }
    }),

  // Self-service tilkøb/ændring af ekstra pladser (#420). Alunta kan ikke
  // ændre quantity på en eksisterende subscription, så flowet er "erstat og
  // annullér": vi opretter en NY checkout på seats-add-on-planen med det
  // ØNSKEDE TOTALE antal ekstra pladser; når den aktiveres, annullerer
  // webhooken kundens gamle seats-subscriptions.
  purchaseExtraSeats: orgAdminProcedure
    .input(z.object({ totalExtraSeats: z.number().int().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertCheckoutAvailable(ctx.db, userId);

      const subscription = await resolveActiveSubscription(
        ctx.db,
        ctx.orgId,
        userId,
      );

      assertNotStoreManaged(subscription);
      // Kræver et live abonnement (trialing tæller) med kendt tier — ekstra
      // pladser er et add-on til en eksisterende Team/Business-base.
      if (
        !subscription ||
        !isLiveAluntaStatus(subscription.status) ||
        !subscription.aluntaSubscriptionId
      ) {
        throw new Error(
          await tr("serverErrors", "subscription.extraSeatsNeedSubscription"),
        );
      }

      const tier = subscription.planTier ?? "solo";

      // Pladser i brug (medlemmer + afventende invitationer) — man kan ikke
      // købe sig ned under det, samme tælling som invite-enforcementen.
      const seatsInUse = ctx.orgId
        ? (await countSeatUsage(ctx.db, ctx.orgId)).total
        : 1;

      // Grandfathered kunder køber pladser på den gamle seats-plan.
      const priceBook = priceBookForAluntaPlan(subscription.aluntaPlanId);
      const validationError = validateExtraSeatsPurchase({
        tier,
        totalExtraSeats: input.totalExtraSeats,
        seatsInUse,
        priceBook,
      });
      if (validationError) throw new Error(validationError);

      const seatsPlanId = getAluntaSeatsPlanIdForTier(tier, priceBook);

      // Udpeg de konkrete seats-subs dette køb ERSTATTER og bær dem i
      // checkout-metadata (#424): webhooken annullerer præcis disse UUID'er —
      // aldrig ud fra klassificering alene. Union af org- og user-nøglede
      // kunder, fuldt pagineret.
      const existingSubs = await listAllAluntaSubsForCustomer(
        [ctx.orgId, userId],
        subscription.aluntaCustomerId,
      );
      const replacesUuids = findObsoleteSeatsSubs("", existingSubs).map(
        (s) => s.uuid,
      );

      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, name: true },
      });
      if (!user)
        throw new Error(await tr("serverErrors", "common.userNotFound"));

      const billingCycle =
        subscription.billingCycle === "yearly" ? "yearly" : "monthly";
      const appUrl = getAppUrl();

      console.warn("[Seats Checkout] Creating Alunta seats session:", {
        plan_id: seatsPlanId,
        external_customer_id: ctx.orgId || userId,
        quantity: input.totalExtraSeats,
        tier,
      });

      // Seats-planen er license_based — her ER quantity antal EKSTRA pladser
      // (i modsætning til base-planerne, som er flat_rate og aldrig må få
      // quantity med).
      const session = await alunta.checkoutSessions.create({
        plan_id: seatsPlanId,
        external_customer_id: ctx.orgId || userId,
        quantity: input.totalExtraSeats,
        success_url: `${appUrl}/dashboard/settings/subscription?seats_success=true`,
        back_url: `${appUrl}/dashboard/settings/subscription?canceled=true`,
        metadata: {
          email: user.email,
          ...(user.name ? { name: user.name } : {}),
          country: "dk",
          preferred_interval: billingCycle === "yearly" ? 12 : 1,
          plan_tier: tier,
          // Markerer at denne checkout ERSTATTER kundens eksisterende
          // seats-subscription(s) — webhooken annullerer ved aktivering
          // præcis de UUID'er der er udpeget her.
          seats_replacement: true,
          replaces_subscription_uuids: replacesUuids,
        },
      });

      const checkoutUrl = session.data?.checkout_url;
      if (!checkoutUrl) {
        console.error(
          "[Seats Checkout] No checkout_url in response:",
          JSON.stringify(session, null, 2),
        );
        throw new Error(await tr("serverErrors", "subscription.noCheckoutUrl"));
      }

      return { url: checkoutUrl };
    }),

  // Create Alunta Portal session
  createPortalSession: orgAdminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    assertNotStoreManaged(subscription);
    if (!subscription?.aluntaCustomerId) {
      throw new Error(
        await tr("serverErrors", "subscription.noActiveAddPayment"),
      );
    }

    const portal = await alunta.portalLinks.create({
      customer_uuid: subscription.aluntaCustomerId,
    });

    return { url: portal.data.url };
  }),

  // Change plan interval via Alunta API
  changePlan: orgAdminProcedure
    .input(z.object({ billingCycle: z.enum(["monthly", "yearly"]) }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertCheckoutAvailable(ctx.db, userId);

      const subscription = await resolveActiveSubscription(
        ctx.db,
        ctx.orgId,
        userId,
      );

      assertNotStoreManaged(subscription);
      if (!subscription?.aluntaSubscriptionId) {
        throw new Error(await tr("serverErrors", "subscription.noActive"));
      }

      const interval = input.billingCycle === "yearly" ? 12 : 1;

      await alunta.subscriptions.changeInterval(
        subscription.aluntaSubscriptionId,
        interval,
      );

      // Optimistic local update
      await ctx.db
        .update(subscriptions)
        .set({
          billingCycle: input.billingCycle,
          updatedAt: new Date(),
        })
        .where(eq(subscriptions.id, subscription.id));

      return { success: true };
    }),

  // Cancel subscription (at period end)
  cancel: orgAdminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    assertNotStoreManaged(subscription);
    if (!subscription?.aluntaSubscriptionId) {
      throw new Error(await tr("serverErrors", "subscription.noActive"));
    }

    await alunta.subscriptions.cancel(subscription.aluntaSubscriptionId);

    await ctx.db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: true,
        canceledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id));

    // Send cancellation confirmation email
    try {
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, userId),
        columns: { email: true, name: true },
      });

      if (user?.email) {
        const mb = await resolveMailBrand({ userId });
        const mailLocale = await getRecipientLocale({
          userId,
          fallback: mb?.locale,
        });
        const endDate = subscription.currentPeriodEnd
          ? new Date(subscription.currentPeriodEnd).toLocaleDateString(
              toIntlLocale(mailLocale),
              {
                day: "numeric",
                month: "long",
                year: "numeric",
                timeZone: "Europe/Copenhagen",
              },
            )
          : await tr(
              "serverMisc",
              "mailFallbacks.endOfPeriod",
              undefined,
              mailLocale,
            );

        await sendCancellationConfirmedEmail({
          to: user.email,
          userName: user.name || "bruger",
          endDate,
          reactivateUrl: `${mb?.appUrl ?? getAppUrl()}/dashboard/settings/subscription`,
          userId,
        });
      }
    } catch (err) {
      console.error("Failed to send cancellation email:", err);
    }

    return { success: true };
  }),

  // Reactivate canceled subscription
  reactivate: orgAdminProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    assertNotStoreManaged(subscription);
    if (!subscription?.aluntaSubscriptionId) {
      throw new Error(await tr("serverErrors", "subscription.none"));
    }

    await alunta.subscriptions.resume(subscription.aluntaSubscriptionId);

    await ctx.db
      .update(subscriptions)
      .set({
        cancelAtPeriodEnd: false,
        canceledAt: null,
        updatedAt: new Date(),
      })
      .where(eq(subscriptions.id, subscription.id));

    return { success: true };
  }),

  // Get invoice history from Alunta
  // Financial detail reads are admin-only: a regular team member shouldn't see
  // the org's invoice amounts, discounts or billing metadata. (Solo users pass
  // orgAdminProcedure — they're their own owner.)
  getInvoiceHistory: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!subscription?.aluntaCustomerId) return [];

    try {
      const response = await alunta.invoices.list({
        customer_uuid: subscription.aluntaCustomerId,
      });

      return response.data.map((inv) => ({
        id: inv.uuid,
        number: inv.invoice_number,
        status: inv.status,
        total: inv.total,
        currency: inv.currency,
        createdAt: inv.created_at,
        periodStart: inv.date_from,
        periodEnd: inv.date_to,
        pdfUrl: inv.pdf_url,
      }));
    } catch {
      // Fallback to empty if API fails
      return [];
    }
  }),

  // Get upcoming and recent transactions from Alunta
  getTransactions: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!subscription?.aluntaSubscriptionId) return [];

    try {
      const response = await alunta.transactions.list({
        membership_uuid: subscription.aluntaSubscriptionId,
        per_page: "20",
      });

      return response.data.map((tx) => ({
        id: tx.uuid,
        price: tx.price,
        currency: tx.currency,
        periodStart: tx.period_start,
        periodEnd: tx.period_end,
        isInvoiced: tx.is_invoiced,
        planName: tx.plan.name,
      }));
    } catch {
      return [];
    }
  }),

  // Get usage/ROI stats (local DB — no external API needed)
  getUsageStats: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    // Calculate total cost paid for TimeTrack
    let totalCost = 0;
    if (subscription) {
      const createdAt = subscription.createdAt;
      const now = new Date();
      const monthsActive = Math.max(
        0,
        (now.getFullYear() - createdAt.getFullYear()) * 12 +
          (now.getMonth() - createdAt.getMonth()),
      );

      const trialMonths = subscription.isTrial ? 1 : 0;
      const promoMonths = subscription.promoMonthsFree || 0;
      const paidMonths = Math.max(0, monthsActive - trialMonths - promoMonths);

      // Real monthly cost: tier + seats, monthly-normalised, minus discount —
      // not the hardcoded solo price. So a team customer's ROI reflects what
      // they actually pay.
      const discountPct = subscription.discountPercent || 0;
      const monthlyPrice =
        monthlyListPriceForSubscription(subscription) * (1 - discountPct / 100);
      totalCost = Math.round(paidMonths * monthlyPrice);
    }

    // Calculate total tracked value
    const trackedResult = await ctx.db
      .select({
        totalValue: sql<string>`COALESCE(SUM(
          CAST(${timeEntries.hours} AS numeric) *
          CAST(COALESCE(${timeEntries.billableRate}, '0') AS numeric)
        ), 0)`,
      })
      .from(timeEntries)
      .where(
        and(
          ctx.orgId
            ? eq(timeEntries.organizationId, ctx.orgId)
            : eq(timeEntries.userId, userId),
          eq(timeEntries.isBillable, true),
        ),
      );

    const totalTrackedValue = Math.round(
      Number.parseFloat(trackedResult[0]?.totalValue || "0"),
    );

    // Calculate total invoiced
    const invoicedResult = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.amount} AS numeric)), 0)`,
      })
      .from(invoices)
      .where(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
      );

    const totalInvoiced = Math.round(
      Number.parseFloat(invoicedResult[0]?.total || "0"),
    );

    // Calculate total paid invoices
    const paidResult = await ctx.db
      .select({
        total: sql<string>`COALESCE(SUM(CAST(${invoices.amount} AS numeric)), 0)`,
      })
      .from(invoices)
      .where(
        and(
          ctx.orgId
            ? eq(invoices.organizationId, ctx.orgId)
            : eq(invoices.userId, userId),
          eq(invoices.status, "paid"),
        ),
      );

    const totalPaidInvoices = Math.round(
      Number.parseFloat(paidResult[0]?.total || "0"),
    );

    const roiMultiplier =
      totalCost > 0 ? Math.round((totalInvoiced / totalCost) * 10) / 10 : 0;

    return {
      totalCost,
      totalTrackedValue,
      totalInvoiced,
      totalPaidInvoices,
      roiMultiplier,
    };
  }),

  // Request trial extension (sends email to admin)
  requestTrialExtension: protectedProcedure.mutation(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { email: true, name: true },
    });

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!user?.email)
      throw new Error(await tr("serverErrors", "common.userNotFound"));

    try {
      const [
        { resend, DEFAULT_FROM_EMAIL },
        { renderEmail },
        { AdminNotificationEmail },
        react,
      ] = await Promise.all([
        import("@/lib/resend"),
        import("@/lib/email/render-email"),
        import("@/components/email/AdminNotificationEmail"),
        import("react"),
      ]);
      const recipient = getFeedbackRecipient();
      if (!recipient) {
        throw new Error(st("subscription.feedbackEmailMissing"));
      }
      // Mailen går til administratoren: hans sprog.
      const [{ mailT }, { getRecipientLocale }, { toIntlLocale }] =
        await Promise.all([
          import("@/lib/email/locale"),
          import("@/lib/email/recipient-locale"),
          import("@/i18n/format-locale"),
        ]);
      const adminLocale = await getRecipientLocale({ email: recipient });
      const mt = mailT("emailsReports", adminLocale);
      const dato = (d: Date | string | null | undefined) =>
        d
          ? new Date(d).toLocaleDateString(toIntlLocale(adminLocale), {
              timeZone: "Europe/Copenhagen",
            })
          : mt("admin.trialRequestUnknown");
      const { html, text } = await renderEmail(
        react.createElement(AdminNotificationEmail, {
          locale: adminLocale,
          eventTitle: mt("admin.trialRequestTitle"),
          rows: [
            {
              label: mt("admin.trialRequestUser"),
              value: `${user.name || mt("admin.trialRequestNoName")} (${user.email})`,
            },
            { label: mt("admin.trialRequestUserId"), value: userId },
            {
              label: mt("admin.trialRequestStatus"),
              value: subscription?.status || mt("admin.trialRequestUnknown"),
            },
            {
              label: mt("admin.trialRequestEnds"),
              value: dato(subscription?.trialEndsAt),
            },
            {
              label: mt("admin.trialRequestCreated"),
              value: dato(subscription?.createdAt),
            },
          ],
        }),
      );
      await resend.emails.send({
        from: DEFAULT_FROM_EMAIL,
        to: recipient,
        subject: mt("admin.trialRequestSubject", {
          user: user.name || user.email,
        }),
        html,
        text,
      });
    } catch (err) {
      console.error("Failed to send trial extension request:", err);
      throw new Error(await tr("serverErrors", "subscription.requestFailed"));
    }

    return { success: true };
  }),

  // Get active discounts from Alunta for the current subscription
  getDiscounts: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!subscription?.aluntaSubscriptionId) return [];

    try {
      const response = await alunta.subscriptions.listDiscounts(
        subscription.aluntaSubscriptionId,
      );

      return response.data;
    } catch {
      return [];
    }
  }),

  // Get subscription metadata from Alunta
  getSubscriptionMetadata: orgAdminProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const subscription = await resolveActiveSubscription(
      ctx.db,
      ctx.orgId,
      userId,
    );

    if (!subscription?.aluntaSubscriptionId) return null;

    try {
      const response = await alunta.subscriptions.get(
        subscription.aluntaSubscriptionId,
      );

      return response.data.metadata;
    } catch {
      return null;
    }
  }),
});
