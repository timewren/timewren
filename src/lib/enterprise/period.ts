import { syncT } from "@/i18n/sync-text";
import { copenhagenTodayAnchor } from "@/lib/time/copenhagen";
/**
 * Rapportperioder (lønrapport): presets og validering delt mellem klient og
 * server. Datoer er lokale "YYYY-MM-DD"-strenge.
 */

export const MAX_PERIOD_DAYS = 366;

export type PeriodPreset =
  | "this_month"
  | "last_month"
  | "this_quarter"
  | "this_year"
  | "last_year";

export const PERIOD_PRESET_LABELS: Record<PeriodPreset, string> = {
  this_month: "Denne måned",
  last_month: "Sidste måned",
  this_quarter: "Dette kvartal",
  this_year: "Dette år",
  last_year: "Sidste år",
};

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * Sand kun for en eksisterende kalenderdato på formen YYYY-MM-DD.
 * JS ruller "2026-02-31" over til 3. marts — derfor kræves round-trip.
 */
export function isValidDateString(date: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return toDateStr(parseLocalDate(date)) === date;
}

/** Fra/til for et preset, relativt til `now` (default: i dag). */
export function getPeriodPreset(
  preset: PeriodPreset,
  // Dansk dato som anker uanset processens TZ (#649)
  now: Date = copenhagenTodayAnchor(),
): { from: string; to: string } {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (preset) {
    case "this_month":
      return {
        from: toDateStr(new Date(y, m, 1)),
        to: toDateStr(new Date(y, m + 1, 0)),
      };
    case "last_month":
      return {
        from: toDateStr(new Date(y, m - 1, 1)),
        to: toDateStr(new Date(y, m, 0)),
      };
    case "this_quarter": {
      const qStart = Math.floor(m / 3) * 3;
      return {
        from: toDateStr(new Date(y, qStart, 1)),
        to: toDateStr(new Date(y, qStart + 3, 0)),
      };
    }
    case "this_year":
      return { from: `${y}-01-01`, to: `${y}-12-31` };
    case "last_year":
      return { from: `${y - 1}-01-01`, to: `${y - 1}-12-31` };
  }
}

/** Antal dage i perioden (begge ender inklusive). */
export function periodLengthDays(from: string, to: string): number {
  const ms = parseLocalDate(to).getTime() - parseLocalDate(from).getTime();
  return Math.round(ms / 86_400_000) + 1;
}

/**
 * Dansk fejlbesked hvis perioden er ugyldig, ellers null.
 * Bruges både i UI (før forespørgsel) og på serveren (BAD_REQUEST).
 */
export function validatePeriod(from: string, to: string): string | null {
  if (!isValidDateString(from) || !isValidDateString(to)) {
    return syncT("enterprise.period.pickBoth");
  }
  if (from > to) return syncT("enterprise.period.fromBeforeToOrSame");
  if (periodLengthDays(from, to) > MAX_PERIOD_DAYS) {
    return syncT("enterprise.period.maxDaysShorter", { days: MAX_PERIOD_DAYS });
  }
  return null;
}

/** "dd.mm" — kort dansk datovisning til tom-tilstande. */
export function formatShortDate(date: string): string {
  const d = parseLocalDate(date);
  return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
}
