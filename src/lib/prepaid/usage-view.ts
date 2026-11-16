/**
 * Visningslogik for klippekort-forbrug (kundeønsker, sep. 2026).
 *
 * - Forbrugshistorik skal vises og sorteres efter tidspostens EGEN dato.
 *   prepaid_usage.createdAt er hvornår trækket blev registreret, og ved en
 *   bulk-overførsel af flere måneders tid ender alle rækker ellers på
 *   importdagen. Manuelle træk har ingen tidspost og bruger createdAt.
 * - Kroner (værdi, timepris, beløb pr. træk) kan skjules: kundens valg
 *   (clients.hidePrepaidValue) vinder, ellers brugerens globale standard.
 */

export type UsageLike = {
  createdAt: Date | string;
  timeEntry?: { date: Date | string } | null;
};

export function usageDisplayDate(usage: UsageLike): Date {
  return usage.timeEntry?.date
    ? new Date(usage.timeEntry.date)
    : new Date(usage.createdAt);
}

/** Nyeste først, efter tidspostens dato (fallback createdAt). Muterer ikke. */
export function sortUsageByDisplayDate<T extends UsageLike>(usage: T[]): T[] {
  return [...usage].sort(
    (a, b) => usageDisplayDate(b).getTime() - usageDisplayDate(a).getTime(),
  );
}

export function resolveHidePrepaidValue(
  clientOverride: boolean | null | undefined,
  userDefault: boolean | null | undefined,
): boolean {
  return clientOverride ?? userDefault ?? false;
}
