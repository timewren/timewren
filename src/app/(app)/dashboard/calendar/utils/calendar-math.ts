// Calendar layout constants
export const HOUR_HEIGHT = 60;
export const START_HOUR = 6;
export const END_HOUR = 22;
export const TOTAL_HOURS = END_HOUR - START_HOUR;
export const SNAP_MINUTES = 15;

// Re-export from shared source to avoid duplicating the timezone-safe implementation
export { toLocalDateStr } from "@/lib/format";

export function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

export function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

export function formatTime(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

const DEFAULT_WEEKDAYS = ["Søn", "Man", "Tir", "Ons", "Tor", "Fre", "Lør"];

/** weekdays: korte ugedagsnavne fra søndag (index = Date.getDay()). */
export function dayLabel(
  d: Date,
  weekdays: readonly string[] = DEFAULT_WEEKDAYS,
): string {
  const days = weekdays;
  return `${days[d.getDay()]} ${d.getDate()}/${d.getMonth() + 1}`;
}

export function formatDuration(
  mins: number,
  units: { hour: string; minute: string } = { hour: "t", minute: "m" },
): string {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}${units.hour} ${m > 0 ? `${m}${units.minute}` : ""}`.trim();
}

export function getWeekNumber(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  );
}

/** Snap minutes to nearest SNAP_MINUTES interval */
export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

/** Convert a Y pixel offset (relative to grid top) to minutes since midnight, snapped */
export function pixelToMinutes(y: number, gridHeight: number): number {
  const ratio = Math.max(0, Math.min(1, y / gridHeight));
  const raw = START_HOUR * 60 + ratio * TOTAL_HOURS * 60;
  return snapMinutes(Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, raw)));
}

/** Convert minutes since midnight to a Y percentage (0-100) for CSS top. Clamps to grid bounds. */
export function minutesToPercent(minutes: number): number {
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, minutes));
  return ((clamped - START_HOUR * 60) / (TOTAL_HOURS * 60)) * 100;
}

/** Convert minutes since midnight to a Date on the given day */
export function minutesToDate(baseDate: Date, minutes: number): Date {
  const d = new Date(baseDate);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

/** Extract start/end minutes from a time block, clamping to grid bounds.
 *  Handles midnight-crossing events (endMinutes=0) by capping at END_HOUR. */
export function blockToMinutes(
  startTime: Date,
  endTime: Date,
): { startMin: number; endMin: number } {
  const startMin = startTime.getHours() * 60 + startTime.getMinutes();
  let endMin = endTime.getHours() * 60 + endTime.getMinutes();
  // Midnight-crossing: if end <= start (e.g. event 23:00-00:00), cap at END_HOUR
  if (endMin <= startMin) {
    endMin = END_HOUR * 60;
  }
  return { startMin, endMin };
}

/** Check if two time ranges overlap */
export function rangesOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
): boolean {
  return aStart < bEnd && aEnd > bStart;
}
