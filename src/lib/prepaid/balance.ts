/**
 * Klippekort-saldo (#881): ÉN regel for "lav"/"kritisk" saldo, brugt af alle
 * visninger (listesiden, detaljesiden, dashboard-widgets, kundeportalen).
 * Før denne fil havde hvert sted sin egen tærskel (20 % af total, fast 5
 * timer, fast 1-2 timer), så samme kort kunne se "ok" ud ét sted og
 * "kritisk" et andet.
 *
 * "low" matcher PREPAID_LOW_BALANCE_THRESHOLD — den procent
 * checkAndSendLowBalanceAlert (src/lib/trpc/routers/prepaid.ts) bruger til at
 * sende lav-saldo-mailen — så UI'et aldrig viser "ok" på et kort hvor kunden
 * allerede har fået en mail om lav saldo. "critical" lægger en flad
 * timer-gulv (PREPAID_CRITICAL_BALANCE_HOURS) ovenpå: uden den ville et stort
 * korts sidste par timer stadig kun hedde "low", fordi de er langt over 20 %
 * af totalen.
 */
import {
  PREPAID_CRITICAL_BALANCE_HOURS,
  PREPAID_LOW_BALANCE_THRESHOLD,
} from "@/lib/config";

export type PrepaidBalanceLevel = "ok" | "low" | "critical";

/**
 * Niveau for en klippekort-saldo givet timer tilbage og kortets totale timer.
 * `totalHours <= 0` (ugyldig/ukendt total) springer procent-tjekket over og
 * falder tilbage til den flade timer-gulv alene.
 */
export function prepaidBalanceLevel(
  remainingHours: number,
  totalHours: number,
): PrepaidBalanceLevel {
  if (remainingHours <= 0 || remainingHours <= PREPAID_CRITICAL_BALANCE_HOURS) {
    return "critical";
  }
  if (
    totalHours > 0 &&
    remainingHours <= totalHours * PREPAID_LOW_BALANCE_THRESHOLD
  ) {
    return "low";
  }
  return "ok";
}

/** True for "low" og "critical" — til simple "kræver opmærksomhed"-filtre. */
export function isPrepaidBalanceLow(
  remainingHours: number,
  totalHours: number,
): boolean {
  return prepaidBalanceLevel(remainingHours, totalHours) !== "ok";
}
