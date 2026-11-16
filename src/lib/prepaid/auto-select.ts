/**
 * Fælles regel for hvilket klippekort der forvælges ved auto-træk (#422).
 *
 * Reglen SKAL være identisk med extensionens `pickAutoPrepaid`
 * (browser-extension/src/lib/prepaid.ts), så samme timer trækker fra samme
 * kort uanset om der trykkes stop i web eller i extensionen. Pariteten
 * låses af auto-select.test.ts.
 *
 * Regel: kun aktive kort med auto-træk og saldo kommer i betragtning. Er
 * der flere, vælges det der udløber først, så et kort med udløbsdato bruges
 * op inden det forfalder; kort uden udløb kommer sidst. Ved samme udløb
 * (eller to uden udløb) bruges det ÆLDSTE købte kort først — FIFO, som
 * kunden forventer (A1 P2-6). Kort uden købsdato kommer sidst.
 *
 * Dette er et FORSLAG i UI'et — serveren trækker aldrig uden et eksplicit
 * prepaidPackageId fra klienten.
 */
import { isPrepaidExpired } from "./expiry";

export interface AutoDeductCandidate {
  autoDeduct?: boolean | null;
  /** decimal-kolonne (string) fra `prepaid.list`, tal fra `getActiveForClient`. */
  remainingHours: string | number | null;
  expiryDate?: Date | string | null;
  isActive?: boolean | null;
  /** Købsdato — tie-break ved samme udløb (ældste først). */
  purchaseDate?: Date | string | null;
}

function expiryMs(value: Date | string | null | undefined): number | null {
  if (!value) return null;
  const ms =
    value instanceof Date ? value.getTime() : new Date(value).getTime();
  return Number.isNaN(ms) ? null : ms;
}

export function pickAutoDeductPackage<T extends AutoDeductCandidate>(
  packages: readonly T[] | undefined,
  now: Date = new Date(),
): T | null {
  if (!packages || packages.length === 0) return null;

  const candidates = packages.filter((p) => {
    if (!p.autoDeduct) return false;
    if (p.isActive === false) return false;
    const remaining =
      typeof p.remainingHours === "number"
        ? p.remainingHours
        : parseFloat(p.remainingHours || "0");
    if (!(remaining > 0)) return false;
    // Kortet gælder hele udløbsdagen i dansk tid (#736)
    if (isPrepaidExpired(p.expiryDate, now)) return false;
    return true;
  });
  if (candidates.length === 0) return null;

  // Array.prototype.sort er stabil — kort med samme udløb beholder rækkefølgen
  return [...candidates].sort((a, b) => {
    const ea = expiryMs(a.expiryDate);
    const eb = expiryMs(b.expiryDate);
    if (ea !== eb) {
      if (ea === null) return 1;
      if (eb === null) return -1;
      return ea - eb;
    }
    // Samme udløb: ældste købte først (FIFO). Manglende købsdato sorterer
    // sidst, så ordenen er total (ellers afhænger valget af listens orden).
    const pa = expiryMs(a.purchaseDate);
    const pb = expiryMs(b.purchaseDate);
    if (pa === pb) return 0;
    if (pa === null) return 1;
    if (pb === null) return -1;
    return pa - pb;
  })[0];
}

/**
 * Timerens klippekort-valg som serveren leverer det (`timerSync.getState`,
 * #422): null = automatisk. `clientId` er kunden valget blev truffet for.
 */
export type TimerPrepaidChoiceView =
  | { mode: "none"; clientId: string }
  | { mode: "package"; packageId: string; clientId: string }
  | null
  | undefined;

/**
 * Kortet en stop-dialog skal forvælge for timeren — samme regel som
 * extensionens `resolvePrepaidPackage`:
 *
 * - "Intet klippekort" → intet kort
 * - et valgt kort → det kort, hvis det stadig er blandt kundens kort;
 *   ellers intet (et eksplicit valg erstattes aldrig stiltiende af et andet
 *   kort)
 * - automatisk, eller valg truffet for en anden kunde → udløber-først
 */
export function resolveTimerPrepaidSelection<
  T extends AutoDeductCandidate & { id: string },
>(
  choice: TimerPrepaidChoiceView,
  clientId: string | null | undefined,
  packages: readonly T[] | undefined,
  now: Date = new Date(),
): T | null {
  if (choice && clientId && choice.clientId === clientId) {
    if (choice.mode === "none") return null;
    return packages?.find((p) => p.id === choice.packageId) ?? null;
  }
  return pickAutoDeductPackage(packages, now);
}
