import {
  addDays,
  addMonths,
  addWeeks,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { dateFnsLocale, formatWords } from '~/lib/locale';

export type PeriodMode = 'day' | 'week' | 'month';

export type DateRange = { start: Date; end: Date };

const WEEK_OPTS = { weekStartsOn: 1 } as const;

/** Mandag-søndag for ugen omkring `date`. */
export function weekRange(date: Date): DateRange {
  return { start: startOfWeek(date, WEEK_OPTS), end: endOfWeek(date, WEEK_OPTS) };
}

export function monthRange(date: Date): DateRange {
  return { start: startOfMonth(date), end: endOfMonth(date) };
}

/**
 * Det datointerval der skal HENTES for en visning. Dag og uge deler ugen
 * (samme query-nøgle → ingen ekstra kald når man skifter mellem dem).
 */
export function fetchRange(mode: PeriodMode, date: Date): DateRange {
  return mode === 'month' ? monthRange(date) : weekRange(date);
}

/** Flyt `date` én periode frem (+1) eller tilbage (-1). */
export function shiftPeriod(mode: PeriodMode, date: Date, direction: 1 | -1): Date {
  switch (mode) {
    case 'day': return addDays(date, direction);
    case 'week': return addWeeks(date, direction);
    case 'month': return addMonths(date, direction);
  }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Overskrift for perioden: "I dag · lørdag 6. september" / "Uge 36 · 31. aug.–6. sep." / "September 2026" */
export function periodTitle(mode: PeriodMode, date: Date): string {
  if (mode === 'day') {
    const text = capitalize(format(date, 'EEEE d. MMMM', { locale: dateFnsLocale() }));
    return isToday(date) ? `${formatWords().today} · ${text}` : text;
  }
  if (mode === 'week') {
    const { start, end } = weekRange(date);
    const sameMonth = isSameMonth(start, end);
    const from = format(start, sameMonth ? 'd.' : 'd. MMM', { locale: dateFnsLocale() });
    const to = format(end, 'd. MMM', { locale: dateFnsLocale() });
    return `${formatWords().week} ${format(date, 'I', { locale: dateFnsLocale() })} · ${from}–${to}`;
  }
  return capitalize(format(date, 'MMMM yyyy', { locale: dateFnsLocale() }));
}

/** yyyy-MM-dd i lokal tid. */
export function dateKey(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

/** yyyy-MM-dd → lokal Date (midnat). */
export function parseDateKey(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/**
 * Dagsnøgle for en tidspost. Backenden gemmer `date` som UTC-midnat
 * (`new Date('yyyy-MM-dd')`), så UTC-datoen er den rigtige kalenderdag.
 * Poster med et klokkeslæt (timer/import) bruger lokal dato.
 */
export function entryDateKey(date: Date | string): string {
  const d = date instanceof Date ? date : new Date(date);
  const isUtcMidnight = d.getUTCHours() === 0 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0;
  if (isUtcMidnight)
    return d.toISOString().slice(0, 10);
  return dateKey(d);
}

type HasDateAndHours = { date: Date | string; hours: string | number };

/** Timer pr. dag (nøgle yyyy-MM-dd) — ufyldte dage mangler i map'et. */
export function hoursByDay<T extends HasDateAndHours>(entries: readonly T[]): Map<string, number> {
  const map = new Map<string, number>();
  for (const e of entries) {
    const key = entryDateKey(e.date);
    map.set(key, (map.get(key) ?? 0) + toNumber(e.hours));
  }
  return map;
}

export function sumHours(entries: readonly HasDateAndHours[]): number {
  return entries.reduce((acc, e) => acc + toNumber(e.hours), 0);
}

export function entriesOnDay<T extends HasDateAndHours>(entries: readonly T[], day: Date): T[] {
  const key = dateKey(day);
  return entries.filter(e => entryDateKey(e.date) === key);
}

/** De 7 dage i ugen omkring `date`, mandag først. */
export function weekDays(date: Date): Date[] {
  const { start } = weekRange(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export type CalendarCell = { date: Date; inMonth: boolean; isToday: boolean };

/** Kalendergrid for måneden: hele uger (mandag-søndag), 5-6 rækker. */
export function monthGrid(date: Date): CalendarCell[][] {
  const { start, end } = monthRange(date);
  const gridStart = startOfWeek(start, WEEK_OPTS);
  const gridEnd = endOfWeek(end, WEEK_OPTS);
  const rows: CalendarCell[][] = [];
  let cursor = gridStart;
  while (cursor <= gridEnd) {
    const row: CalendarCell[] = [];
    for (let i = 0; i < 7; i++) {
      row.push({ date: cursor, inMonth: isSameMonth(cursor, date), isToday: isToday(cursor) });
      cursor = addDays(cursor, 1);
    }
    rows.push(row);
  }
  return rows;
}

/** 0-4: intensitet til heatmap-prik (0 = ingen tid). */
export function intensity(hours: number): 0 | 1 | 2 | 3 | 4 {
  if (hours <= 0)
    return 0;
  if (hours < 2)
    return 1;
  if (hours < 4)
    return 2;
  if (hours < 7)
    return 3;
  return 4;
}

export function isSameDate(a: Date, b: Date): boolean {
  return isSameDay(a, b);
}

function toNumber(v: string | number): number {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : 0;
}
