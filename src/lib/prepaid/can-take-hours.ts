/**
 * Kan kortet tage et træk? Fælles regel for alle kortvælgere i web og
 * extension (spejlet i browser-extension/src/lib/prepaid.ts, paritetstest dér).
 *
 * Et kort med overtræks-politik "allow" eller "invoice" tager altid imod: ved
 * "allow" føres overtrækket som gæld; ved "invoice" trækkes intet, når saldoen
 * ikke dækker, og hele
 * posten faktureres (til overtræks-satsen, hvis den er sat). Saldoen
 * på sådan et kort står på 0, når det er brugt op (DB-invarianten holder
 * remainingHours >= 0), så et filter på saldo > 0 ville skjule kortet efter
 * første overtræk (#1319). Kun "block" kræver saldo.
 */
export interface PrepaidCapacity {
  /** decimal-kolonne (string) eller tal, afhængigt af endpointet. */
  remainingHours: string | number | null | undefined;
  overdraftPolicy?: string | null;
}

export function allowsPrepaidOverdraft(
  policy: string | null | undefined,
): boolean {
  return policy === "allow" || policy === "invoice";
}

/**
 * Uden `hours`: har kortet plads til noget som helst? Med `hours`: kan det
 * tage netop det træk?
 */
export function canTakePrepaidHours(
  pkg: PrepaidCapacity,
  hours?: number,
): boolean {
  if (allowsPrepaidOverdraft(pkg.overdraftPolicy)) return true;
  const remaining =
    typeof pkg.remainingHours === "number"
      ? pkg.remainingHours
      : Number.parseFloat(pkg.remainingHours || "0");
  if (!Number.isFinite(remaining)) return false;
  return hours !== undefined && hours > 0 ? remaining >= hours : remaining > 0;
}
