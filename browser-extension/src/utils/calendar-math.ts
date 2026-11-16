/**
 * Shared calendar math utilities.
 * Used by both popup and newtab calendar components.
 * Copied from popup/utils/calendar-math.ts to avoid cross-boundary imports.
 */

export const HOUR_HEIGHT = 44;
// Hele døgnet: poster før 06 og efter 22 (nattearbejde) skal kunne ses og
// åbnes. Kalenderen scroller selv til det aktuelle klokkeslæt.
export const START_HOUR = 0;
export const END_HOUR = 24;
export const TOTAL_HOURS = END_HOUR - START_HOUR;
export const SNAP_MINUTES = 15;

export function toLocalDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

export function snapMinutes(minutes: number): number {
  return Math.round(minutes / SNAP_MINUTES) * SNAP_MINUTES;
}

export function pixelToMinutes(y: number, gridHeight: number): number {
  const ratio = Math.max(0, Math.min(1, y / gridHeight));
  const raw = START_HOUR * 60 + ratio * TOTAL_HOURS * 60;
  return snapMinutes(Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, raw)));
}

export function minutesToPercent(minutes: number): number {
  const clamped = Math.max(START_HOUR * 60, Math.min(END_HOUR * 60, minutes));
  return ((clamped - START_HOUR * 60) / (TOTAL_HOURS * 60)) * 100;
}

export function minutesToDate(baseDate: Date, minutes: number): Date {
  const d = new Date(baseDate);
  d.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return d;
}

export function blockToMinutes(
  startTime: Date,
  endTime: Date,
): { startMin: number; endMin: number } {
  const startMin = startTime.getHours() * 60 + startTime.getMinutes();
  let endMin = endTime.getHours() * 60 + endTime.getMinutes();
  if (endMin <= startMin) endMin = END_HOUR * 60;
  return { startMin, endMin };
}

/** ISO 8601 week number */
export function getWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

/** Minutter efter midnat som "09:05"; 1440 bliver "24:00" (døgnets slutning). */
export function formatMinutesOfDay(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Forslag til tidsrum, når en registrering oprettes med knappen "Ny
 * registrering" (tastaturvejen i stedet for at trække i kalenderen):
 * i dag den seneste time op til nu, ellers 09-10 på den viste dag.
 */
export function newEntrySlot(
  day: Date,
  now = new Date(),
): { date: Date; startMinutes: number; endMinutes: number } {
  const date = new Date(day);
  date.setHours(0, 0, 0, 0);
  if (toLocalDateStr(day) !== toLocalDateStr(now)) {
    return { date, startMinutes: 9 * 60, endMinutes: 10 * 60 };
  }
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const end = Math.max(60, Math.floor(nowMin / SNAP_MINUTES) * SNAP_MINUTES);
  return { date, startMinutes: end - 60, endMinutes: end };
}
