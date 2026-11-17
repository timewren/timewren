import { isDemoMode } from "@/lib/demo/demo-mode";

/**
 * Én central kontakt for om betaling og planer overhovedet gælder (#962).
 *
 * Billing er slået til, når mindst én betalingsudbyder er konfigureret via
 * env: Alunta (`ALUNTA_API_KEY`), Stripe (`STRIPE_SECRET_KEY`) eller køb i
 * appen (`STORE_BILLING_ENABLED=1`). TimeTrack Cloud har dem sat og kører
 * derfor uændret. En selvhostet instans uden nogen af dem har alle funktioner
 * åbne: ingen bruger-/kundegrænser, ingen prøveperiode der udløber, ingen
 * opgraderingsknapper, prisvægge eller trial-bannere.
 *
 * Hvad gaten må styre (#1010): fakturering, prøveperiode, dunning,
 * opgraderingsknapper og kapacitet (brugere, aktive kunder, lagerplads,
 * backup-opbevaring). Kapacitet går gennem `capacityLimitsApply` i
 * capacity-gate.ts.
 *
 * Hvad den aldrig må styre: om et modul, en procedure, en rapport eller en
 * integration er tilgængelig. Funktioner virker med og uden billing-env og
 * afhænger ikke af plan, brand eller licensnøgle. Tests i
 * __tests__/gate-usage.test.ts klassificerer hver bruger af gaten.
 *
 * Kun serveren læser env. Klienten spørger `subscription.billingEnabled`
 * (se useBillingEnabled), så ingen betalingsnøgler når browseren.
 */
export function isBillingEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  // Offentlig demo: ingen betaling, checkout eller prøveperiode, heller ikke
  // hvis en nøgle ved en fejl er sat (docs/demo.md).
  if (isDemoMode(env)) return false;
  return (
    !!env.ALUNTA_API_KEY?.trim() ||
    !!env.STRIPE_SECRET_KEY?.trim() ||
    env.STORE_BILLING_ENABLED === "1"
  );
}

/** Alunta er konfigureret (nøgle sat). Stripe og butikker tæller ikke med. */
export function isAluntaEnabled(
  env: Readonly<Record<string, string | undefined>> = process.env,
): boolean {
  return !!env.ALUNTA_API_KEY?.trim();
}
