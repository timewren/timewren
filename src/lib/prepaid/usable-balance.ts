import { isPrepaidExpired } from "./expiry";

export interface PrepaidBalanceCandidate {
  remainingHours: string | number | null;
  isActive?: boolean | null;
  isArchived?: boolean | null;
  expiryDate?: Date | string | null;
}

/**
 * Timer kunden faktisk kan trække på: kun aktive, ikke-arkiverede og
 * ikke-udløbne kort (A1 P2-5). Restsaldoen på et deaktiveret eller udløbet
 * kort kan ikke bruges og må ikke stå i kundens saldo.
 */
export function sumUsablePrepaidHours(
  packages: readonly PrepaidBalanceCandidate[] | undefined,
  now: Date = new Date(),
): number {
  if (!packages) return 0;
  return packages.reduce((sum, pkg) => {
    if (pkg.isActive === false || pkg.isArchived) return sum;
    if (isPrepaidExpired(pkg.expiryDate, now)) return sum;
    const remaining =
      typeof pkg.remainingHours === "number"
        ? pkg.remainingHours
        : parseFloat(pkg.remainingHours || "0");
    return Number.isFinite(remaining) ? sum + remaining : sum;
  }, 0);
}
