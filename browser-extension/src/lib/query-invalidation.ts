import type { QueryClient } from "@tanstack/react-query";

/**
 * Én nøgle til klippekort-listen (getActivePackages). PrepaidStatus brugte
 * før "prepaidPackages", mens invalideringen ramte "activePackages", så
 * saldoen stod forkert i op til 5 minutter efter et træk.
 */
export const PREPAID_PACKAGES_KEY = "activePackages";

/**
 * Efter en gemt, rettet eller slettet registrering: alt der viser tid eller
 * klippekort-saldo hentes igen, i popup'en og i ny fane.
 */
export function invalidateEntryQueries(
  queryClient: QueryClient,
  { prepaid = true }: { prepaid?: boolean } = {},
): void {
  for (const key of [
    "timeEntries",
    "recentEntries",
    "todayStats",
    "weeklyEntries",
  ]) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
  if (prepaid) {
    void queryClient.invalidateQueries({ queryKey: [PREPAID_PACKAGES_KEY] });
  }
}
