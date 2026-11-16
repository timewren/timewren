import { st } from "@/i18n/sync-text";
// Datofelter fra klienter → lagringsværdien i `time_entries.date`.
//
// Lagringskonventionen (se copenhagen.ts) er UTC-midnat på den danske dato.
// Klienter sender dagen på tre former, og `new Date(input.date)` gemte kun den
// første rigtigt:
//
// - "2026-07-16" — den dag klienten skrev. Tages bogstaveligt.
// - "2026-07-16T22:30:00Z" (eller med offset) — et øjeblik. Gemmes på den
//   danske dag det falder på (her 17/7), ikke på UTC-datoen.
// - "2026-07-16T22:30:00" — dansk vægur uden zone. Dagen er datodelen.
//
// Alt andet (inkl. en dag der ikke findes, fx "2026-02-31") giver `null`, så
// kalderen kan svare en ærlig 400 i stedet for at gemme `Invalid Date`.
// Lagring sker altid via `entryDateFromStr` på den normaliserede dato.

import { z } from "zod";
import {
  entryDateFromStr,
  isDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";

const WALL_CLOCK_RE =
  /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,9})?)?$/;
const HAS_ZONE_RE = /(?:Z|[+-]\d{2}:?\d{2})$/i;

/** Den danske dato ("yyyy-MM-dd") et klientdatofelt beskriver, eller `null`. */
export function entryDateStrFromInput(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return toCopenhagenDateStr(value);
  }
  if (typeof value !== "string") return null;

  const trimmed = value.trim();
  if (trimmed === "") return null;

  if (isDateStr(trimmed)) return trimmed;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return null; // ikke en rigtig dag

  if (HAS_ZONE_RE.test(trimmed)) {
    // Kun ISO-tidspunkter: `new Date` accepterer ellers meget løst input.
    if (!/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return null;
    const instant = new Date(trimmed);
    if (Number.isNaN(instant.getTime())) return null;
    return toCopenhagenDateStr(instant);
  }

  const wall = WALL_CLOCK_RE.exec(trimmed);
  if (!wall) return null;
  const [, datePart, hour, minute, second] = wall;
  if (
    !isDateStr(datePart) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second ?? 0) > 59
  ) {
    return null;
  }
  return datePart;
}

/** Lagringsværdien (UTC-midnat på den danske dato), eller `null`. */
export function entryDateFromInput(value: unknown): Date | null {
  const dateStr = entryDateStrFromInput(value);
  return dateStr ? entryDateFromStr(dateStr) : null;
}

/**
 * zod-felt for en postdato fra klienter. Normaliserer til den danske dato som
 * "yyyy-MM-dd", så alle led efter valideringen (periodelås, compliance,
 * satsopslag, insert via `entryDateFromStr`) ser samme dag — og et ugyldigt
 * format bliver en BAD_REQUEST med en dansk besked frem for en 500 fra
 * drizzle.
 */
export const entryDateStrInput = z.string().transform((value, ctx): string => {
  const parsed = entryDateStrFromInput(value);
  if (!parsed) {
    ctx.addIssue({
      code: "custom",
      message: st("time.invalidEntryDate"),
    });
    return z.NEVER;
  }
  return parsed;
});

/**
 * Nøgleform for et timetal i dedupe-sammenligninger.
 *
 * `time_entries.hours` er `numeric(5, 2)`, og Postgres returnerer teksten i
 * kolonnens scale (`2` → `"2.00"`), mens input fra zod er et tal (`2`). Uden
 * fælles form matchede nøglerne aldrig, og en genimport af samme CSV med
 * "spring dubletter" oprettede hver post igen.
 */
export function hoursKey(hours: number | string): string {
  const value = typeof hours === "string" ? Number(hours) : hours;
  if (!Number.isFinite(value)) return String(hours);
  return value.toFixed(2);
}
