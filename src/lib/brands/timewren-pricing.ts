import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-gate";
import {
  BUSINESS_SEAT_PRICE_MONTHLY,
  includedSeatsForTier,
  maxSeatsForTier,
  type PlanTier,
  PRIVAT_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_MONTHLY,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";
import { CURRENCIES, type Currency, type Locale } from "./registry";
import { LOCALE_TAGS } from "./timewren-site-copy";

/**
 * TimeWren Clouds prisliste (Mads 8/11-2026): samme planer og priser som
 * TimeTrack, ekskl. moms. Ret EUR/USD her. DKK og grænserne (brugere, aktive
 * kunder) læses fra billing-koden, så prissiden altid viser det, kunden
 * faktisk bliver faktureret for og kan. Planerne er kun tekst på
 * marketingsiden: ingen funktion afhænger af dem.
 */
const PRICES: Record<
  Exclude<PlanTier, "free">,
  { EUR: number; USD: number }
> = {
  privat: { EUR: 4, USD: 4 },
  solo: { EUR: 11, USD: 12 },
  team: { EUR: 7, USD: 8 },
  business: { EUR: 9, USD: 10 },
};

const DKK: Record<Exclude<PlanTier, "free">, number> = {
  privat: PRIVAT_PRICE_MONTHLY,
  solo: SUBSCRIPTION_PRICE_MONTHLY,
  team: TEAM_SEAT_PRICE_MONTHLY,
  business: BUSINESS_SEAT_PRICE_MONTHLY,
};

export interface TimewrenPlan {
  tier: PlanTier;
  /** Månedspris pr. valuta (hele enheder), pr. bruger når perUser. */
  monthly: Record<Currency, number>;
  perUser: boolean;
  /** Mindste antal brugere, der betales for (kun planer pr. bruger). */
  minUsers: number;
  maxUsers: number;
  /** null = ubegrænset. */
  maxActiveClients: number | null;
}

/** Planerne i den rækkefølge, prissiden viser dem. */
export const TIMEWREN_PLAN_TIERS: readonly PlanTier[] = [
  "free",
  "privat",
  "solo",
  "team",
  "business",
];

export function timewrenPlans(): TimewrenPlan[] {
  return TIMEWREN_PLAN_TIERS.map((tier) => {
    const perUser = tier === "team" || tier === "business";
    return {
      tier,
      monthly:
        tier === "free"
          ? { EUR: 0, USD: 0, DKK: 0 }
          : { ...PRICES[tier], DKK: DKK[tier] },
      perUser,
      minUsers: perUser ? includedSeatsForTier(tier) : 1,
      maxUsers: tier === "free" ? FREE_MAX_SEATS : maxSeatsForTier(tier),
      maxActiveClients:
        tier === "free"
          ? FREE_MAX_ACTIVE_CLIENTS
          : tier === "privat"
            ? PRIVAT_MAX_ACTIVE_CLIENTS
            : null,
    };
  });
}

/**
 * Valuta, der er valgt fra start. Cloud faktureres i EUR med Stripe (Mads
 * 17/11-2026), så alle sprog viser EUR.
 */
export const DEFAULT_CURRENCY: Record<Locale, Currency> = {
  en: "EUR",
  da: "EUR",
  de: "EUR",
  es: "EUR",
};

/**
 * Valutaerne på prissiden. Kun EUR, indtil der findes Stripe-priser i USD og
 * DKK; med én valuta vises ingen valutavælger. Alle: CURRENCIES.
 */
export const PRICE_CURRENCIES: readonly Currency[] = CURRENCIES.filter(
  (c) => c === "EUR",
);

export function formatPrice(
  locale: Locale,
  currency: Currency,
  amount: number,
) {
  return new Intl.NumberFormat(LOCALE_TAGS[locale], {
    style: "currency",
    currency,
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}
