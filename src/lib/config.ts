/**
 * Centralized application configuration
 * All magic numbers and configurable values should be defined here
 */

import { appUrlEnv, marketingUrlEnv } from "@/lib/runtime-env";
import { FREE_MAX_SEATS } from "./billing/plan-gate";

// ============================================================================
// Prepaid Package Configuration
// ============================================================================

/**
 * Threshold for low balance alerts as a percentage (0.2 = 20%)
 * Alerts are sent when remaining hours fall below this percentage of total
 */
export const PREPAID_LOW_BALANCE_THRESHOLD = parseFloat(
  process.env.PREPAID_LOW_BALANCE_THRESHOLD || "0.2",
);

/**
 * Flat hour floor under which a package is "critical" regardless of its
 * percentage remaining (issue #881) — without it, a large card's last couple
 * of hours would still read as merely "low" since they're far above 20% of
 * the total. Used together with PREPAID_LOW_BALANCE_THRESHOLD by
 * prepaidBalanceLevel() in src/lib/prepaid/balance.ts.
 */
export const PREPAID_CRITICAL_BALANCE_HOURS = parseFloat(
  process.env.PREPAID_CRITICAL_BALANCE_HOURS || "1",
);

/**
 * Number of days before package expiry to show warning
 */
export const PREPAID_EXPIRY_WARNING_DAYS = parseInt(
  process.env.PREPAID_EXPIRY_WARNING_DAYS || "30",
  10,
);

// ============================================================================
// Time Tracking Configuration
// ============================================================================

/**
 * Default weekly hour goal for users (Danish work week)
 */
export const DEFAULT_WEEKLY_HOUR_GOAL = parseFloat(
  process.env.DEFAULT_WEEKLY_HOUR_GOAL || "37",
);

/**
 * Number of days to show in the productivity heatmap
 */
export const PRODUCTIVITY_HEATMAP_DAYS = parseInt(
  process.env.PRODUCTIVITY_HEATMAP_DAYS || "90",
  10,
);

// ============================================================================
// API Timeouts
// ============================================================================

/**
 * Timeout for CVR API requests in milliseconds
 */
export const CVR_API_TIMEOUT_MS = parseInt(
  process.env.CVR_API_TIMEOUT_MS || "10000",
  10,
);

/**
 * Cache TTL for AI responses in milliseconds
 */
export const AI_CACHE_TTL_MS = parseInt(
  process.env.AI_CACHE_TTL_MS || "60000",
  10,
);

// ============================================================================
// Validation Limits
// ============================================================================

/**
 * Maximum allowed monetary amount (100 million)
 */
export const MAX_MONETARY_AMOUNT = parseInt(
  process.env.MAX_MONETARY_AMOUNT || "100000000",
  10,
);

/**
 * Maximum invoice amount
 */
export const MAX_INVOICE_AMOUNT = MAX_MONETARY_AMOUNT;

// ============================================================================
// AI Categorization
// ============================================================================

/**
 * Confidence threshold for AI categorization (0.8 = 80%)
 * Above this threshold, the match is considered high confidence
 */
export const AI_HIGH_CONFIDENCE_THRESHOLD = parseFloat(
  process.env.AI_HIGH_CONFIDENCE_THRESHOLD || "0.8",
);

// ============================================================================
// Session Configuration
// ============================================================================

/**
 * Session expiry time in days
 */
export const SESSION_EXPIRY_DAYS = parseInt(
  process.env.SESSION_EXPIRY_DAYS || "7",
  10,
);

// ============================================================================
// Trial Configuration
// ============================================================================

/**
 * Free trial period in days
 */
export const FREE_TRIAL_DAYS = parseInt(
  process.env.FREE_TRIAL_DAYS || "30",
  10,
);

// ============================================================================
// Desktop (one-time lifetime license)
// ============================================================================

// NB: Desktop er inkluderet i alle planer fra prisstige v2 (med konto).
// Livstidslicensen (27/10-2026: 499 kr, tidligere 999 kr) er til brug uden
// konto, "kun på denne computer" — se /desktop#licens. Købere af den gamle
// 999 kr-licens beholder den; se LEGACY_DESKTOP_LIFETIME_PRICE.

/** Desktop lifetime license price in DKK (one-time purchase, incl. moms) */
export const DESKTOP_LIFETIME_PRICE = 499;
/**
 * Pris (DKK) for livstidslicenser købt før 27/10-2026, hvor prisen blev sat
 * ned til 499 kr. Bruges som fallback i omsætningsrapporten for de køb, der
 * blev foretaget før beløbet blev gemt pr. licens (se desktopLicenses.amountPaidDkk).
 */
export const LEGACY_DESKTOP_LIFETIME_PRICE = 999;
/** Devices allowed per desktop lifetime license */
export const DESKTOP_LIFETIME_MAX_DEVICES = 3;
/** Money-back window (days) for self-service desktop license refunds */
export const DESKTOP_REFUND_WINDOW_DAYS = 30;
/**
 * Enable Stripe Tax on desktop checkout (automatic VAT + EU reverse-charge for
 * valid VAT numbers). Only turn on once Stripe Tax is configured/registered in
 * the dashboard — otherwise checkout.sessions.create fails.
 */
export const STRIPE_TAX_ENABLED = process.env.STRIPE_TAX_ENABLED === "true";
/**
 * Stripe Price ID for the one-time desktop lifetime purchase.
 * Create a Product + one-time Price (499 DKK) in Stripe and set this env var.
 * Without it, the desktop checkout endpoint returns a friendly error.
 */
export const STRIPE_DESKTOP_LIFETIME_PRICE_ID =
  process.env.STRIPE_DESKTOP_LIFETIME_PRICE_ID || "";

// ============================================================================
// Subscription / Alunta
// ============================================================================

// Prisstige v2 (sep 2026, DKK ekskl. moms, årlig = 10 × månedlig). Alle
// platforme (web, app, extension, desktop) er inkluderet i alle planer.
// Eksisterende kunder bliver på deres gamle Alunta-planer (grandfathering) —
// se LEGACY_* nedenfor og priceBookForAluntaPlan().

/** Selvstændig (tier "solo") price in DKK (monthly) */
export const SUBSCRIPTION_PRICE_MONTHLY = 79;
/** Selvstændig (tier "solo") price in DKK (yearly) */
export const SUBSCRIPTION_PRICE_YEARLY = 790;

export const ALUNTA_PLAN_MONTHLY = process.env.ALUNTA_PLAN_MONTHLY || "";
export const ALUNTA_PLAN_YEARLY = process.env.ALUNTA_PLAN_YEARLY || "";

export function getAluntaPlanId(billingCycle: "monthly" | "yearly"): string {
  const id =
    billingCycle === "monthly" ? ALUNTA_PLAN_MONTHLY : ALUNTA_PLAN_YEARLY;
  if (!id) throw new Error(`Alunta plan ID not configured for ${billingCycle}`);
  return id;
}

/** Founding member Alunta plan IDs (25% rabat baked into plan price) */
export const ALUNTA_FOUNDING_PLAN_IDS: {
  monthly: string;
  yearly: string;
} = {
  monthly: process.env.ALUNTA_PLAN_FOUNDING_MONTHLY || "",
  yearly: process.env.ALUNTA_PLAN_FOUNDING_YEARLY || "",
};

// Team billing: 49 kr/bruger/md, min. 2 brugere → basis 98 inkl. 2 pladser.
export const TEAM_BASE_PRICE_MONTHLY = 98;
export const TEAM_BASE_PRICE_YEARLY = 980;
export const TEAM_SEAT_PRICE_MONTHLY = 49;
export const TEAM_INCLUDED_SEATS = 2;
// Hævet 10 → 25 (aug 2026): teams uden behov for Business' fraværs-/
// compliance-moduler skal ikke tvinges til at skifte plan for pladser alene.
export const TEAM_MAX_SEATS = 25;

// Virksomhed (tier "business"): 69 kr/bruger/md, min. 5 brugere → basis 345
// inkl. 5 pladser. Større kunder (volumenpris) = "kontakt os".
export const BUSINESS_BASE_PRICE_MONTHLY = 345;
export const BUSINESS_BASE_PRICE_YEARLY = 3450;
export const BUSINESS_SEAT_PRICE_MONTHLY = 69;
export const BUSINESS_INCLUDED_SEATS = 5;
export const BUSINESS_MAX_SEATS = 50;

export const ALUNTA_PLAN_TEAM_MONTHLY =
  process.env.ALUNTA_PLAN_TEAM_MONTHLY || "";
export const ALUNTA_PLAN_TEAM_YEARLY =
  process.env.ALUNTA_PLAN_TEAM_YEARLY || "";
export const ALUNTA_PLAN_BUSINESS_MONTHLY =
  process.env.ALUNTA_PLAN_BUSINESS_MONTHLY || "";
export const ALUNTA_PLAN_BUSINESS_YEARLY =
  process.env.ALUNTA_PLAN_BUSINESS_YEARLY || "";

// Privat: billig 1-bruger-plan. Kun købbar når ALUNTA_PLAN_PRIVAT_MONTHLY/
// YEARLY er sat (læses ved kald i subscription-routerens getAluntaPlanIdForTier).
export const PRIVAT_PRICE_MONTHLY = 29;
export const PRIVAT_PRICE_YEARLY = 290;

// Gamle listepriser (før prisstige v2). Gælder kunder hvis Alunta-plan er en
// legacy-plan (ALUNTA_PLAN_LEGACY_*) eller en founding-plan — så den viste
// pris matcher det Alunta faktisk opkræver.
export const LEGACY_SUBSCRIPTION_PRICE_MONTHLY = 99;
export const LEGACY_SUBSCRIPTION_PRICE_YEARLY = 990;
export const LEGACY_TEAM_BASE_PRICE_MONTHLY = 199;
export const LEGACY_TEAM_BASE_PRICE_YEARLY = 1990;
export const LEGACY_TEAM_SEAT_PRICE_MONTHLY = 49;
export const LEGACY_BUSINESS_BASE_PRICE_MONTHLY = 495;
export const LEGACY_BUSINESS_BASE_PRICE_YEARLY = 4950;
export const LEGACY_BUSINESS_SEAT_PRICE_MONTHLY = 39;

/** Hvilken prisliste et abonnement faktureres efter. */
export type PriceBook = "current" | "legacy";

/**
 * Plan-ID'er fra en eller flere env vars. Hver var kan indeholde flere
 * komma-separerede UUID'er (legacy-vars samler alle gamle planer); tomme
 * værdier og whitespace ignoreres. Læses ved kald, så tests kan stubbe env.
 */
export function envPlanIds(...names: string[]): string[] {
  const out: string[] = [];
  for (const name of names) {
    for (const part of (process.env[name] ?? "").split(",")) {
      const id = part.trim();
      if (id && !out.includes(id)) out.push(id);
    }
  }
  return out;
}

/**
 * Alle kendte Alunta-plan-ID'er grupperet efter tier — nuværende OG legacy.
 * Single source of truth for plan-UUID → tier (webhook, seat-reconciliation,
 * erstat-og-annullér), så en grandfathered kunde aldrig mappes forkert.
 */
export function aluntaPlanIdGroups(): {
  soloBase: string[];
  privatBase: string[];
  teamBase: string[];
  businessBase: string[];
  teamSeats: string[];
  businessSeats: string[];
} {
  return {
    soloBase: envPlanIds(
      "ALUNTA_PLAN_MONTHLY",
      "ALUNTA_PLAN_YEARLY",
      "ALUNTA_PLAN_FOUNDING_MONTHLY",
      "ALUNTA_PLAN_FOUNDING_YEARLY",
      "ALUNTA_PLAN_LEGACY_SOLO",
    ),
    privatBase: envPlanIds(
      "ALUNTA_PLAN_PRIVAT_MONTHLY",
      "ALUNTA_PLAN_PRIVAT_YEARLY",
    ),
    teamBase: envPlanIds(
      "ALUNTA_PLAN_TEAM_MONTHLY",
      "ALUNTA_PLAN_TEAM_YEARLY",
      "ALUNTA_PLAN_LEGACY_TEAM",
    ),
    businessBase: envPlanIds(
      "ALUNTA_PLAN_BUSINESS_MONTHLY",
      "ALUNTA_PLAN_BUSINESS_YEARLY",
      "ALUNTA_PLAN_LEGACY_BUSINESS",
    ),
    teamSeats: envPlanIds(
      "ALUNTA_PLAN_TEAM_SEATS",
      "ALUNTA_PLAN_LEGACY_TEAM_SEATS",
    ),
    businessSeats: envPlanIds(
      "ALUNTA_PLAN_BUSINESS_SEATS",
      "ALUNTA_PLAN_LEGACY_BUSINESS_SEATS",
    ),
  };
}

/**
 * Prisliste for et abonnements Alunta-plan. Siden 1/10-2026 er alle
 * eksisterende kunder flyttet til prisstige v2 (prisen er ændret på selve
 * Alunta-subscriptionen via PUT /subscriptions/{uuid}/price), så alle planer
 * — også ALUNTA_PLAN_LEGACY_* og founding — prissættes efter den nuværende
 * prisliste. Legacy-ID'erne bruges stadig til tier-mapping
 * (aluntaPlanIdGroups) og må ikke fjernes fra env.
 */
export function priceBookForAluntaPlan(
  _planUuid: string | null | undefined,
): PriceBook {
  return "current";
}

/**
 * "free" = den permanente Gratis-tier (max 3 brugere og max 3 aktive kunder,
 * se billing/plan-gate.ts). Trials der udløber uden betaling lander her i
 * stedet for bag en mur.
 */
export type PlanTier = "free" | "privat" | "solo" | "team" | "business";

/**
 * Privat kan kun købes (og dermed prøves) når begge Privat-planer er oprettet
 * i Alunta og sat i env. Server-only — env er ikke tilgængelig i browseren.
 */
export function isPrivatPlanConfigured(): boolean {
  return (
    !!process.env.ALUNTA_PLAN_PRIVAT_MONTHLY &&
    !!process.env.ALUNTA_PLAN_PRIVAT_YEARLY
  );
}

/**
 * Max seats included with a plan tier. Single source of truth shared by the
 * onboarding trial-seat grant and the Alunta webhook's plan resolution, so a
 * team customer gets the same seat allowance whether they're in trial or paid.
 */
export function maxSeatsForTier(tier: PlanTier | string): number {
  switch (tier) {
    case "team":
      return TEAM_MAX_SEATS;
    case "business":
      return BUSINESS_MAX_SEATS;
    case "free":
      return FREE_MAX_SEATS;
    default:
      return 1;
  }
}

/** Human-readable plan name per tier (used in subscription UI). */
export function planNameForTier(tier: PlanTier | string): string {
  switch (tier) {
    case "team":
      return "Team";
    case "business":
      return "Virksomhed";
    case "free":
      return "Gratis";
    case "privat":
      return "Privat";
    default:
      return "Selvstændig";
  }
}

/**
 * Base list price (DKK) for a tier + billing cycle. Single source of truth for
 * subscription price display so team/business customers don't see the solo
 * price. Per-seat add-ons are billed separately by Alunta and not included.
 */
export function basePriceForTier(
  tier: PlanTier | string,
  billingCycle: "monthly" | "yearly",
  priceBook: PriceBook = "current",
): number {
  const yearly = billingCycle === "yearly";
  const legacy = priceBook === "legacy";
  switch (tier) {
    case "team":
      if (legacy) {
        return yearly
          ? LEGACY_TEAM_BASE_PRICE_YEARLY
          : LEGACY_TEAM_BASE_PRICE_MONTHLY;
      }
      return yearly ? TEAM_BASE_PRICE_YEARLY : TEAM_BASE_PRICE_MONTHLY;
    case "business":
      if (legacy) {
        return yearly
          ? LEGACY_BUSINESS_BASE_PRICE_YEARLY
          : LEGACY_BUSINESS_BASE_PRICE_MONTHLY;
      }
      return yearly ? BUSINESS_BASE_PRICE_YEARLY : BUSINESS_BASE_PRICE_MONTHLY;
    case "free":
      return 0;
    case "privat":
      return yearly ? PRIVAT_PRICE_YEARLY : PRIVAT_PRICE_MONTHLY;
    default:
      if (legacy) {
        return yearly
          ? LEGACY_SUBSCRIPTION_PRICE_YEARLY
          : LEGACY_SUBSCRIPTION_PRICE_MONTHLY;
      }
      return yearly ? SUBSCRIPTION_PRICE_YEARLY : SUBSCRIPTION_PRICE_MONTHLY;
  }
}

/** Seats included in the tier's base price before per-seat add-ons kick in. */
export function includedSeatsForTier(tier: PlanTier | string): number {
  switch (tier) {
    case "team":
      return TEAM_INCLUDED_SEATS;
    case "business":
      return BUSINESS_INCLUDED_SEATS;
    case "free":
      return FREE_MAX_SEATS;
    default:
      return 1;
  }
}

/**
 * Price (DKK) of one extra seat beyond the included ones. Yearly mirrors the
 * base-price convention of 10 months billed (2 months free), so a yearly extra
 * seat costs the monthly rate × 10.
 */
export function seatPriceForTier(
  tier: PlanTier | string,
  billingCycle: "monthly" | "yearly",
  priceBook: PriceBook = "current",
): number {
  const legacy = priceBook === "legacy";
  const monthly =
    tier === "team"
      ? legacy
        ? LEGACY_TEAM_SEAT_PRICE_MONTHLY
        : TEAM_SEAT_PRICE_MONTHLY
      : tier === "business"
        ? legacy
          ? LEGACY_BUSINESS_SEAT_PRICE_MONTHLY
          : BUSINESS_SEAT_PRICE_MONTHLY
        : 0;
  return billingCycle === "yearly" ? monthly * 10 : monthly;
}

/**
 * Total list price (DKK) for a tier + billing cycle at a given seat count:
 * base + (seats − included) × per-seat. Single source of truth shared by the
 * onboarding price preview and any server-side computation, so the figure the
 * customer sees matches the per-seat quantity sent to Alunta.
 */
export function totalPriceForTierSeats(
  tier: PlanTier | string,
  billingCycle: "monthly" | "yearly",
  seats: number,
  priceBook: PriceBook = "current",
): number {
  const included = includedSeatsForTier(tier);
  const extra = Math.max(0, seats - included);
  return (
    basePriceForTier(tier, billingCycle, priceBook) +
    extra * seatPriceForTier(tier, billingCycle, priceBook)
  );
}

/**
 * Monthly-normalised LIST price (DKK, before discount) for a subscription's
 * tier + seat count. Yearly subscriptions are divided by 12 so the figure is a
 * true MRR contribution. Single source of truth for MRR/ARR and price display
 * so team/business tiers AND per-seat add-ons are counted — not just the solo
 * base price. A `null` tier/seats falls back to solo / the tier's included
 * seats.
 */
export function monthlyListPriceForSubscription(sub: {
  planTier?: string | null;
  billingCycle?: string | null;
  seatCount?: number | null;
  aluntaPlanId?: string | null;
}): number {
  const tier = sub.planTier ?? "solo";
  const cycle = sub.billingCycle === "yearly" ? "yearly" : "monthly";
  const seats = sub.seatCount ?? includedSeatsForTier(tier);
  const total = totalPriceForTierSeats(
    tier,
    cycle,
    seats,
    priceBookForAluntaPlan(sub.aluntaPlanId),
  );
  return cycle === "yearly" ? total / 12 : total;
}

/**
 * Full per-cycle LIST price (DKK, before discount) actually billed for a
 * subscription: the yearly total for yearly subs, the monthly total for
 * monthly subs — tier + seats included. Use for cash-in / accrual figures
 * where the billed amount matters (not the monthly-normalised MRR).
 */
export function cycleListPriceForSubscription(sub: {
  planTier?: string | null;
  billingCycle?: string | null;
  seatCount?: number | null;
  aluntaPlanId?: string | null;
}): number {
  const tier = sub.planTier ?? "solo";
  const cycle = sub.billingCycle === "yearly" ? "yearly" : "monthly";
  const seats = sub.seatCount ?? includedSeatsForTier(tier);
  return totalPriceForTierSeats(
    tier,
    cycle,
    seats,
    priceBookForAluntaPlan(sub.aluntaPlanId),
  );
}

/** Clamp a requested seat count into the tier's valid [included, max] range. */
export function clampSeats(tier: PlanTier | string, seats: number): number {
  const min = includedSeatsForTier(tier);
  const max = maxSeatsForTier(tier);
  if (!Number.isFinite(seats)) return min;
  return Math.min(max, Math.max(min, Math.round(seats)));
}

/** True if the plan UUID is a per-seat add-on plan ("Ekstra pladser"). */
export function isAluntaSeatsPlan(planUuid?: string | null): boolean {
  if (!planUuid) return false;
  const { teamSeats, businessSeats } = aluntaPlanIdGroups();
  return teamSeats.includes(planUuid) || businessSeats.includes(planUuid);
}

/**
 * Alunta plan ID for the tier's per-seat add-on plan, or "" when not
 * configured. Read at call time (not module load) so the value can be
 * introduced without a rebuild and so tests can stub the env. An empty string
 * feature-gates the seats-purchase flow for that tier — the UI hides the
 * option and the mutation rejects.
 */
export function getAluntaSeatsPlanIdForTier(
  tier: PlanTier | string,
  priceBook: PriceBook = "current",
): string {
  // Grandfathered kunder køber ekstra pladser på den gamle seats-plan (første
  // ID i ALUNTA_PLAN_LEGACY_*_SEATS), så prisen matcher den viste legacy-pris.
  // Er legacy-varen tom, bruges den nuværende seats-plan.
  const legacyFirst = (name: string) =>
    priceBook === "legacy" ? envPlanIds(name)[0] : undefined;
  switch (tier) {
    case "team":
      return (
        legacyFirst("ALUNTA_PLAN_LEGACY_TEAM_SEATS") ||
        process.env.ALUNTA_PLAN_TEAM_SEATS ||
        ""
      );
    case "business":
      return (
        legacyFirst("ALUNTA_PLAN_LEGACY_BUSINESS_SEATS") ||
        process.env.ALUNTA_PLAN_BUSINESS_SEATS ||
        ""
      );
    default:
      return "";
  }
}

/**
 * Resolve the total seat count to store from an Alunta subscription's raw
 * fields. Single source of truth shared by the webhook and the
 * seat-reconciliation cron so both compute seats identically.
 *
 * - Seats add-on plan: `quantity` = EXTRA seats beyond the included → total =
 *   included + quantity.
 * - Base/flat-rate plan: `quantity` is the base-unit count (always 1) and MUST
 *   NOT be read as seats — that clobbers the total down to the tier min. Seats
 *   for a base customer come from checkout `metadata.seat_count`; otherwise the
 *   existing count is kept (non-destructive, so a base renewal event doesn't
 *   overwrite seats set by the separate add-on subscription).
 *
 * Clamped to the tier's [min,max].
 */
export function resolveAluntaSeatCount(opts: {
  planUuid?: string | null;
  tier: string;
  quantity?: number | null;
  metadataSeatCount?: number | null;
  existingSeats?: number | null;
}): number {
  const { planUuid, tier, quantity, metadataSeatCount, existingSeats } = opts;
  const posQty = typeof quantity === "number" && quantity > 0 ? quantity : null;
  const posMeta =
    typeof metadataSeatCount === "number" && metadataSeatCount > 0
      ? metadataSeatCount
      : null;
  if (isAluntaSeatsPlan(planUuid)) {
    const qty = posQty ?? posMeta;
    return clampSeats(
      tier,
      qty != null
        ? includedSeatsForTier(tier) + qty
        : (existingSeats ?? maxSeatsForTier(tier)),
    );
  }
  return clampSeats(tier, posMeta ?? existingSeats ?? maxSeatsForTier(tier));
}

// ============================================================================
// Founding Member
// ============================================================================

/** Max number of founding member slots */
export const FOUNDING_MEMBER_MAX_SLOTS = 20;

/** Founding member benefits */
export const FOUNDING_MEMBER = {
  label: "Grundlægger",
  maxSlots: FOUNDING_MEMBER_MAX_SLOTS,
  freeMonths: 3,
  discountPercent: 25,
  discountForever: true,
};

// ============================================================================
// Application URLs
// ============================================================================

/**
 * Get the application (authenticated app) base URL.
 * After the subdomain split this points at https://app.timetrack.dk.
 * Used for auth, dashboard links, email links and OAuth callbacks.
 */
export function getAppUrl(): string {
  return appUrlEnv() || "http://localhost:3000";
}

/**
 * Get the marketing/public base URL (canonical home for SEO).
 * Defaults to the app URL so that — until the subdomain split is configured —
 * everything resolves to a single host exactly like before. Set
 * NEXT_PUBLIC_MARKETING_URL=https://timetrack.dk at cutover.
 */
export function getMarketingUrl(): string {
  return marketingUrlEnv() || getAppUrl();
}

/** Host (incl. port) of the app URL, e.g. "app.timetrack.dk". */
export function getAppHost(): string {
  try {
    return new URL(getAppUrl()).host;
  } catch {
    return "";
  }
}

/** Host (incl. port) of the marketing URL, e.g. "timetrack.dk". */
export function getMarketingHost(): string {
  try {
    return new URL(getMarketingUrl()).host;
  } catch {
    return "";
  }
}

/** Absolute URL on the app host, e.g. appUrl("/login"). */
export function appUrl(path = ""): string {
  return `${getAppUrl().replace(/\/$/, "")}${path}`;
}

/** Absolute URL on the marketing host, e.g. marketingUrl("/pricing"). */
export function marketingUrl(path = ""): string {
  return `${getMarketingUrl().replace(/\/$/, "")}${path}`;
}

/** True once the app and marketing hosts differ (subdomain split is live). */
export function isSubdomainSplitActive(): boolean {
  const appHost = getAppHost();
  const marketingHost = getMarketingHost();
  return Boolean(appHost && marketingHost && appHost !== marketingHost);
}

/**
 * Href for a link from the marketing site into the authenticated app.
 * Stays relative while the split is inactive (so it keeps working in dev and
 * pre-cutover), and becomes an absolute app-host URL once the split is live —
 * avoiding an extra middleware redirect hop on the primary funnel.
 */
export function appLinkHref(path: string): string {
  return isSubdomainSplitActive() ? appUrl(path) : path;
}

/**
 * Domain for generated mail addresses (noreply@, inbound task+id@, synthetic
 * phone-user addresses). EMAIL_DOMAIN overrides; default is the marketing host
 * without port.
 */
export function getEmailDomain(): string {
  return process.env.EMAIL_DOMAIN || getMarketingHost().replace(/:\d+$/, "");
}

/** Reply-To on personal lifecycle mails. Unset = no Reply-To header. */
export function getPersonalReplyTo(): string | undefined {
  return process.env.PERSONAL_REPLY_TO_EMAIL || undefined;
}

/** Recipient of in-app feedback mails. Unset = feedback is stored and sent to Discord only. */
export function getFeedbackRecipient(): string | undefined {
  return process.env.FEEDBACK_TO_EMAIL || undefined;
}

/**
 * Dashboard URL
 */
export function getDashboardUrl(): string {
  return `${getAppUrl()}/dashboard`;
}

// ============================================================================
// Shared production database
// ============================================================================

/**
 * True when this environment shares its database and Valkey with an older
 * prod version that doesn't know about this branch's newer request types
 * (ZIP export) or DPA version. Set SHARED_PROD_DB=1 on beta.timetrack.dk
 * while it runs against app.timetrack.dk's data.
 */
export function isSharedProdDb(): boolean {
  return process.env.SHARED_PROD_DB === "1";
}

/**
 * Base URL for links stored in the database or registered with an external
 * service (webhooks, push channels) — as opposed to links in emails or
 * OAuth redirect_uris, which must keep pointing at the environment the user
 * is actually in. Falls back to the app URL, so behaviour is unchanged until
 * CALLBACK_BASE_URL is set.
 */
export function getCallbackBaseUrl(): string {
  return process.env.CALLBACK_BASE_URL || getAppUrl();
}
