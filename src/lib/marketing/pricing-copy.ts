import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  PRIVAT_MAX_ACTIVE_CLIENTS,
} from "@/lib/billing/plan-gate";
import {
  BUSINESS_INCLUDED_SEATS,
  BUSINESS_SEAT_PRICE_MONTHLY,
  PRIVAT_PRICE_MONTHLY,
  PRIVAT_PRICE_YEARLY,
  SUBSCRIPTION_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_YEARLY,
  TEAM_INCLUDED_SEATS,
  TEAM_SEAT_PRICE_MONTHLY,
} from "@/lib/config";

/**
 * Prisbeskeden på marketing-sitet, ét sted (docs/BRAND.md → Tal, priser og
 * tid; issue #825 fase 2.2). Forside, /pricing, segmentsider og /lp/* læser
 * herfra, så teksten er ens overalt.
 *
 * Tallene kommer fra billing-konstanterne. Fakta bag sætningerne:
 * - Prøven kræver intet betalingskort: betalingstrinnet er fjernet fra
 *   onboarding (components/onboarding/OnboardingModal.tsx, REMOVED_STEPS).
 * - Efter prøven lander kontoen på Gratis, også teams (api/cron/trial-expire).
 *   Har en organisation flere end FREE_MAX_SEATS medlemmer, beholder ejeren
 *   og de næste i rækken adgang, og resten låses (billing/plan-limits.ts,
 *   freeSeatHolderIds i billing/plan-gate.ts). Ingen data slettes.
 * - Ingen funktion er låst bag en plan (#1012): fakturering og klippekort er
 *   med på Gratis og Privat. Planerne afgør kun kapacitet (kunder, brugere):
 *   Privat har op til PRIVAT_MAX_ACTIVE_CLIENTS aktive kunder, Selvstændig
 *   har ubegrænset antal.
 * - Årspris = 10 × månedspris (lib/config.ts).
 */

const nf = new Intl.NumberFormat("da-DK");

/** "79 kr." / "3.450 kr." */
export function kr(amount: number): string {
  return `${nf.format(amount)} kr.`;
}

export type PlanKey =
  | "gratis"
  | "privat"
  | "selvstaendig"
  | "team"
  | "virksomhed";

export interface PlanPrice {
  key: PlanKey;
  name: string;
  /** Pris med enhed, fx "79 kr./md." eller "49 kr. pr. bruger/md.". */
  price: string;
  /** Kort pris uden enhed til tætte flader, fx "79 kr.". */
  amount: string;
  /** Enheden alene, fx "/md." eller "pr. bruger/md.". */
  unit: string;
  /** Årspris eller minimum, fx "eller 790 kr./år". */
  extra: string | null;
  /** Hvad planen er til, én linje. */
  includes: string;
}

export const PLAN_PRICES: Record<PlanKey, PlanPrice> = {
  gratis: {
    key: "gratis",
    name: "Gratis",
    price: "0 kr.",
    amount: "0 kr.",
    unit: "",
    extra: null,
    includes: `${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder, med fakturering og klippekort`,
  },
  privat: {
    key: "privat",
    name: "Privat",
    price: `${kr(PRIVAT_PRICE_MONTHLY)}/md.`,
    amount: kr(PRIVAT_PRICE_MONTHLY),
    unit: "/md.",
    extra: `eller ${kr(PRIVAT_PRICE_YEARLY)}/år`,
    includes: `Én bruger og op til ${PRIVAT_MAX_ACTIVE_CLIENTS} aktive kunder, med fakturering og klippekort`,
  },
  selvstaendig: {
    key: "selvstaendig",
    name: "Selvstændig",
    price: `${kr(SUBSCRIPTION_PRICE_MONTHLY)}/md.`,
    amount: kr(SUBSCRIPTION_PRICE_MONTHLY),
    unit: "/md.",
    extra: `eller ${kr(SUBSCRIPTION_PRICE_YEARLY)}/år`,
    includes:
      "Én bruger og ubegrænset antal kunder, med klippekort, fakturagrundlag og Billy eller Dinero",
  },
  team: {
    key: "team",
    name: "Team",
    price: `${kr(TEAM_SEAT_PRICE_MONTHLY)} pr. bruger/md.`,
    amount: kr(TEAM_SEAT_PRICE_MONTHLY),
    unit: "pr. bruger/md.",
    extra: `mindst ${TEAM_INCLUDED_SEATS} brugere`,
    includes: "Fælles kunder, teamoverblik og klippekort",
  },
  virksomhed: {
    key: "virksomhed",
    name: "Virksomhed",
    price: `${kr(BUSINESS_SEAT_PRICE_MONTHLY)} pr. bruger/md.`,
    amount: kr(BUSINESS_SEAT_PRICE_MONTHLY),
    unit: "pr. bruger/md.",
    extra: `mindst ${BUSINESS_INCLUDED_SEATS} brugere`,
    includes: "Registrering af arbejdstid, ferie, fravær, flex og løneksport",
  },
};

/**
 * Prøveperioden er 30 dage: onboarding opretter prøven med
 * `campaign?.trialDays ?? 30` (trpc/routers/onboarding.ts). FREE_TRIAL_DAYS
 * i config er en server-env og bruges ikke her, fordi teksten også renderes i
 * klientkomponenter (ellers hydration-forskel, hvis env'en er sat).
 */
export const TRIAL_DAYS = 30;

/** Står altid i nærheden af en pris. */
export const VAT_NOTE = "Alle priser er ekskl. moms.";

/** Én sætning i stedet for tre punkter (reviewens P3). */
export const NO_STRINGS =
  "Intet betalingskort for at prøve, ingen binding på månedsabonnementet og intet oprettelsesgebyr.";

/** Hvad der sker efter prøven, for én person. */
export const AFTER_TRIAL_SOLO = `Efter ${TRIAL_DAYS} dage fortsætter kontoen på Gratis, hvis du ikke vælger en plan. Intet betalingskort.`;

/** Samme uden "Intet betalingskort", når det allerede står i nærheden. */
export const AFTER_TRIAL_SOLO_SHORT = `Efter ${TRIAL_DAYS} dage fortsætter kontoen på Gratis, hvis du ikke vælger en plan.`;

/** Hvad der sker efter prøven, for et team. Præcist efter trial-expire-cronen. */
export const AFTER_TRIAL_TEAM = `Vælger I ikke en plan efter ${TRIAL_DAYS} dage, fortsætter organisationen på Gratis med plads til ${FREE_MAX_SEATS} brugere. Er I flere, beholder ejeren og de næste i rækken adgang, og resten er sat på pause, til I vælger en plan. Ingen data slettes.`;

/** Hvad Gratis rummer, så "fortsætter på Gratis" ikke lover for meget. */
export const FREE_LIMITS = `Gratis har plads til ${FREE_MAX_SEATS} brugere og ${FREE_MAX_ACTIVE_CLIENTS} aktive kunder. Fakturering og klippekort er med.`;

/** Prislinjen under forsidens CTA. */
export const HOME_PRICE_LINE = `Selvstændig ${PLAN_PRICES.selvstaendig.price} ekskl. moms. ${AFTER_TRIAL_SOLO}`;

/** Beskrivelsen på "Priser"-kortet i de interne linkblokke på sidefladerne. */
export const PAID_FROM_LINE = `Gratis at starte, betalt fra ${PLAN_PRICES.privat.amount}/md. ekskl. moms.`;
