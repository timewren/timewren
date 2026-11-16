// Ressourceplan (#508): ren beregning af uger, kapacitet, booking og
// afvigelser. Ingen DB og ingen React, så routeren, eksporten og UI'et deler
// samme regler, og det hele kan testes uden database.
//
// Datoer er danske kalenderdatoer ("yyyy-MM-dd") og regnes uden proces-TZ
// (se @/lib/time/copenhagen).

import {
  addDaysToDateStr,
  isDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";

/** Flest uger grid'et viser ad gangen. */
export const MAX_PLAN_WEEKS = 12;

/** Under denne andel af kapaciteten er en medarbejder underbooket. */
export const UNDERBOOKED_BELOW_PCT = 80;

/** Afvigelse tæller først ved mindst så mange timer … */
export const DEVIATION_MIN_HOURS = 1;
/** … og mindst så stor en andel af det planlagte. */
export const DEVIATION_MIN_PCT = 20;

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Mandagen i ugen for datoen; kaster ved ugyldigt format. */
export function toWeekStart(dateStr: string): string {
  if (!isDateStr(dateStr)) throw new Error(`Ugyldig dato: "${dateStr}"`);
  return weekStartDateStr(dateStr);
}

/** `count` på hinanden følgende uger fra ugen der indeholder `start`. */
export function planWeeks(start: string, count: number): string[] {
  const first = toWeekStart(start);
  const n = Math.max(1, Math.min(MAX_PLAN_WEEKS, Math.floor(count)));
  return Array.from({ length: n }, (_, i) => addDaysToDateStr(first, i * 7));
}

/** Søndagen i ugen der starter `weekStart`. */
export function weekEnd(weekStart: string): string {
  return addDaysToDateStr(weekStart, 6);
}

/** ISO-ugenummer (1–53) for en dato. */
export function isoWeekNumber(dateStr: string): number {
  // Torsdagen i samme uge afgør ISO-året
  const thursday = addDaysToDateStr(toWeekStart(dateStr), 3);
  const [y, m, d] = thursday.split("-").map(Number);
  const dayOfYear =
    (Date.UTC(y, m - 1, d) - Date.UTC(y, 0, 1)) / 86_400_000 + 1;
  return Math.floor((dayOfYear - 1) / 7) + 1;
}

// --- Kapacitet ---------------------------------------------------------------

export interface PlanAbsence {
  startDate: string;
  /** null = åben periode (sygdom/orlov uden slutdato) */
  endDate: string | null;
  halfDayStart: boolean;
  halfDayEnd: boolean;
  /** Delvis fravær i timer pr. dag; null = hele dage */
  hoursPerDay: number | null;
}

/**
 * Fraværstimer på en dato ud fra dagens normtid. Åbne perioder tæller kun
 * til og med i dag (som i flex/dækningsgrad) — en igangværende sygemelding
 * forudsiges ikke ind i planen. Flere fravær samme dag giver den største.
 */
export function absenceHoursOn(
  date: string,
  dayHours: number,
  absences: readonly PlanAbsence[],
  today: string,
): number {
  if (!(dayHours > 0)) return 0;
  let max = 0;
  for (const a of absences) {
    const end = a.endDate ?? (today < a.startDate ? a.startDate : today);
    if (date < a.startDate || date > end) continue;
    let hours = dayHours;
    if (a.hoursPerDay != null && a.hoursPerDay > 0) {
      hours = Math.min(dayHours, a.hoursPerDay);
    } else if (
      (a.halfDayStart && date === a.startDate) ||
      (a.halfDayEnd && a.endDate !== null && date === a.endDate)
    ) {
      hours = dayHours / 2;
    }
    if (hours > max) max = hours;
  }
  return max;
}

export interface WeekCapacity {
  /** Normtid efter fridage/helligdage (fra fridagskalenderen) */
  normHours: number;
  /** Godkendt fravær (ferie, sygdom …) i ugen */
  absenceHours: number;
  /** Til rådighed for planlægning = normtid − fravær */
  capacity: number;
}

/**
 * Kapacitet for en uge: normtid (allerede minus fridage, se
 * loadWorkTimeContext) minus godkendt fravær.
 */
export function weekCapacity(
  weekStart: string,
  hoursFor: (date: string) => number,
  absences: readonly PlanAbsence[],
  today: string,
): WeekCapacity {
  let norm = 0;
  let absence = 0;
  for (let i = 0; i < 7; i++) {
    const date = addDaysToDateStr(weekStart, i);
    const dayHours = Math.max(0, hoursFor(date) || 0);
    norm += dayHours;
    absence += absenceHoursOn(date, dayHours, absences, today);
  }
  return {
    normHours: round2(norm),
    absenceHours: round2(absence),
    capacity: round2(Math.max(0, norm - absence)),
  };
}

export type BookingStatus = "over" | "under" | "ok" | "none";

/**
 * Over-/underbooking: over når planen overstiger kapaciteten, under når
 * mindre end {@link UNDERBOOKED_BELOW_PCT} % er planlagt. "none" = hverken
 * kapacitet eller plan (fx ferieuge uden planlagt arbejde).
 */
export function bookingStatus(
  planned: number,
  capacity: number,
): BookingStatus {
  if (!(capacity > 0)) return planned > 0 ? "over" : "none";
  if (planned > capacity + 0.005) return "over";
  if ((planned / capacity) * 100 < UNDERBOOKED_BELOW_PCT) return "under";
  return "ok";
}

// --- Plan mod registreret ----------------------------------------------------

export type DeviationStatus = "over" | "under" | "ok" | "future";

/**
 * Afvigelse mellem plan og registreret for en uge. Kommende uger vurderes
 * ikke ("future"). Den igangværende uge vurderes kun for overskridelser —
 * en halv uge er naturligt under planen.
 */
export function deviationStatus(input: {
  planned: number;
  registered: number;
  weekStart: string;
  today: string;
}): DeviationStatus {
  const { planned, registered, weekStart, today } = input;
  if (weekStart > today) return "future";
  const diff = registered - planned;
  const threshold = Math.max(
    DEVIATION_MIN_HOURS,
    (planned * DEVIATION_MIN_PCT) / 100,
  );
  if (diff >= threshold) return "over";
  const weekIsOver = weekEnd(weekStart) < today;
  if (weekIsOver && -diff >= threshold) return "under";
  return "ok";
}

/** Nøgle for en planrække: medarbejder × projekt × (aktivitet | hele projektet). */
export function rowKey(
  userId: string,
  projectId: string,
  activityTypeId: string | null,
): string {
  return `${userId}|${projectId}|${activityTypeId ?? ""}`;
}

export interface PlanCell {
  userId: string;
  projectId: string;
  activityTypeId: string | null;
  weekStart: string;
  hours: number;
}

export interface PlanRow {
  key: string;
  userId: string;
  projectId: string;
  activityTypeId: string | null;
  /** Ingen plan — kun registreret tid (ikke-planlagt arbejde) */
  unplanned: boolean;
  planned: Record<string, number>;
  registered: Record<string, number>;
}

function bump(map: Record<string, number>, week: string, hours: number) {
  map[week] = round2((map[week] ?? 0) + hours);
}

/**
 * Saml plan og registreret tid i rækker. Registreret tid med en aktivitet,
 * der har sin egen planrække, lander dér; ellers på projektets række uden
 * aktivitet. Tid på et projekt uden nogen planrække bliver en "ikke-planlagt"
 * række, så lederen også ser arbejde der ikke var planlagt.
 */
export function buildPlanRows(
  planned: readonly PlanCell[],
  registered: readonly PlanCell[],
): PlanRow[] {
  const rows = new Map<string, PlanRow>();
  const ensure = (
    userId: string,
    projectId: string,
    activityTypeId: string | null,
    unplanned: boolean,
  ) => {
    const key = rowKey(userId, projectId, activityTypeId);
    let row = rows.get(key);
    if (!row) {
      row = {
        key,
        userId,
        projectId,
        activityTypeId,
        unplanned,
        planned: {},
        registered: {},
      };
      rows.set(key, row);
    }
    return row;
  };

  for (const c of planned) {
    if (!(c.hours > 0)) continue;
    bump(
      ensure(c.userId, c.projectId, c.activityTypeId, false).planned,
      c.weekStart,
      c.hours,
    );
  }
  for (const c of registered) {
    if (!(c.hours > 0)) continue;
    const exact =
      c.activityTypeId !== null
        ? rows.get(rowKey(c.userId, c.projectId, c.activityTypeId))
        : undefined;
    const target =
      exact ??
      rows.get(rowKey(c.userId, c.projectId, null)) ??
      ensure(c.userId, c.projectId, null, true);
    bump(target.registered, c.weekStart, c.hours);
  }
  return [...rows.values()];
}

/**
 * Planlagte timer der endnu ikke er brugt, fra og med den igangværende uge:
 * pr. uge max(0, planlagt − registreret). Bruges i projektets budget-bar,
 * så "brugt + planlagt fremover" kan holdes op mod budgettet.
 */
export function remainingPlannedHours(
  weeks: ReadonlyArray<{
    weekStart: string;
    planned: number;
    registered: number;
  }>,
  currentWeekStart: string,
): number {
  let sum = 0;
  for (const w of weeks) {
    if (w.weekStart < currentWeekStart) continue;
    sum += Math.max(0, w.planned - w.registered);
  }
  return round2(sum);
}

export function sumValues(map: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(map)) s += v;
  return round2(s);
}

/**
 * Indtastede timer ("7,5", "8", "") → tal. Tom = 0 (fjern cellen).
 * null ved ugyldig tekst eller mere end en uges timer.
 */
export function parseHoursInput(raw: string): number | null {
  const t = raw.trim().replace(",", ".");
  if (t === "") return 0;
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  if (!(n <= 168)) return null;
  return round2(n);
}
