import { isBillingEnabled } from "./billing-enabled";

/**
 * Gælder kapacitetsgrænser (brugere/pladser, aktive kunder) overhovedet?
 *
 * Den ene gate for kapacitet (#1010). Uden betalingsudbyder (selvhost) er
 * der ingen grænser. Med billing (TimeTrack Cloud) afgør planen, hvor meget
 * der er plads til. Gaten må kun bruges til tal, aldrig til at afgøre, om et
 * modul, en procedure, en rapport eller en integration er tilgængelig.
 */
export function capacityLimitsApply(
  env?: Readonly<Record<string, string | undefined>>,
): boolean {
  return isBillingEnabled(env);
}
