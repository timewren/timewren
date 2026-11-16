/**
 * Timer-parsing og varighed ↔ start/slut. Spejler web's `parseHours`
 * (src/lib/enterprise/timesheet.ts) så "1,5", "1:30", "90m", "1t30" giver det samme.
 */

export const MAX_HOURS = 24;

const COLON_RE = /^(\d{1,2}):(\d{1,2})$/;
const HOURS_MINUTES_RE = /^(\d{1,2})[th](\d{1,2})?m?$/;
const MINUTES_ONLY_RE = /^(\d{1,4})m$/;
const DECIMAL_RE = /^\d+([.,]\d+)?$/;
const WHITESPACE_RE = /\s+/g;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * "1,5" → 1.5 · "1:30" → 1.5 · "90m" → 1.5 · "1t30" → 1.5 · "" → 0 · ugyldigt → null.
 */
export function parseHoursInput(input: string): number | null {
  const trimmed = input.trim().toLowerCase().replace(WHITESPACE_RE, '');
  if (trimmed === '')
    return 0;

  let value: number;
  const colon = COLON_RE.exec(trimmed);
  const hoursMinutes = HOURS_MINUTES_RE.exec(trimmed);
  const minutesOnly = MINUTES_ONLY_RE.exec(trimmed);

  if (colon) {
    const minutes = Number(colon[2]);
    if (minutes >= 60)
      return null;
    value = Number(colon[1]) + minutes / 60;
  }
  else if (hoursMinutes) {
    const minutes = hoursMinutes[2] ? Number(hoursMinutes[2]) : 0;
    if (minutes >= 60)
      return null;
    value = Number(hoursMinutes[1]) + minutes / 60;
  }
  else if (minutesOnly) {
    value = Number(minutesOnly[1]) / 60;
  }
  else if (DECIMAL_RE.test(trimmed)) {
    value = Number(trimmed.replace(',', '.'));
  }
  else {
    return null;
  }

  if (Number.isNaN(value) || value < 0 || value > MAX_HOURS)
    return null;
  return round2(value);
}

/** 1.5 → "1,5" (til tal-feltet: decimalkomma, max 2 decimaler). */
export function formatHoursInput(hours: number): string {
  if (!Number.isFinite(hours))
    return '';
  return String(round2(hours)).replace('.', ',');
}

/** "09:00" → { h: 9, m: 0 } — null ved ugyldigt. */
export function parseClock(text: string): { h: number; m: number } | null {
  const m = COLON_RE.exec(text.trim());
  if (!m)
    return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59)
    return null;
  return { h, m: min };
}

export function formatClock(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Timer mellem to klokkeslæt samme dag; slut før/lig start = over midnat (+24 t). */
export function hoursBetween(start: string, end: string): number | null {
  const s = parseClock(start);
  const e = parseClock(end);
  if (!s || !e)
    return null;
  let minutes = (e.h * 60 + e.m) - (s.h * 60 + s.m);
  if (minutes <= 0)
    minutes += 24 * 60;
  return round2(minutes / 60);
}

/** Sluttid ud fra start + varighed, fx ("09:00", 1.5) → "10:30" (ruller over midnat). */
export function endFromStart(start: string, hours: number): string | null {
  const s = parseClock(start);
  if (!s || !Number.isFinite(hours))
    return null;
  const total = (s.h * 60 + s.m + Math.round(hours * 60)) % (24 * 60);
  return formatClock(Math.floor(total / 60), total % 60);
}

/**
 * Byg ISO-tidspunkter til backendens `startTime`/`endTime` ud fra dato
 * (yyyy-MM-dd) og klokkeslæt i lokal tid. Slut før start ruller til næste dag.
 */
export function rangeToISO(date: string, start: string, end: string): { startTime: string; endTime: string } | null {
  const s = parseClock(start);
  const e = parseClock(end);
  if (!s || !e)
    return null;
  const [y, mo, d] = date.split('-').map(Number);
  if (!y || !mo || !d)
    return null;
  const startDate = new Date(y, mo - 1, d, s.h, s.m, 0, 0);
  const endDate = new Date(y, mo - 1, d, e.h, e.m, 0, 0);
  if (endDate <= startDate)
    endDate.setDate(endDate.getDate() + 1);
  return { startTime: startDate.toISOString(), endTime: endDate.toISOString() };
}

/** Klokkeslæt "HH:mm" i lokal tid fra en Date/ISO-streng. */
export function clockFromDate(value: Date | string | null | undefined): string {
  if (!value)
    return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime()))
    return '';
  return formatClock(d.getHours(), d.getMinutes());
}
