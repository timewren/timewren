import type { RouterOutputs } from '~/api/app-router';
import { addDays, format as dfFormat, endOfMonth, startOfMonth, startOfWeek, subMonths } from 'date-fns';
import { dateFnsLocale, formatWords, intlLocale } from '~/lib/locale';

export type WasteLog = RouterOutputs['logbook']['wasteLog'];
export type WasteUser = WasteLog['byUser'][number];
export type WasteDay = WasteUser['days'][number];

/** Huller under tærsklen er støj (skift mellem to opgaver) — samme valg som web. */
export const GAP_THRESHOLDS = [5, 15, 30] as const;
export type GapThreshold = (typeof GAP_THRESHOLDS)[number];

export type Period = 'this_week' | 'last_week' | 'this_month' | 'last_month';

export const PERIODS: readonly Period[] = ['this_week', 'last_week', 'this_month', 'last_month'] as const;

/**
 * Perioden som interval, hele dage inklusive. Kalenderuge og kalendermåned
 * i dansk tid — `startOfWeek` med `weekStartsOn: 1` er mandag, som serverens
 * `weekOverview` også bruger.
 */
export function periodRange(period: Period, now: Date = new Date()): { from: string; to: string } {
  const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
  if (period === 'this_week')
    return range(thisWeek, addDays(thisWeek, 6));
  if (period === 'last_week')
    return range(addDays(thisWeek, -7), addDays(thisWeek, -1));
  if (period === 'this_month')
    return range(startOfMonth(now), endOfMonth(now));
  const last = subMonths(now, 1);
  return range(startOfMonth(last), endOfMonth(last));
}

function range(from: Date, to: Date): { from: string; to: string } {
  return { from: dfFormat(from, 'yyyy-MM-dd'), to: dfFormat(to, 'yyyy-MM-dd') };
}

/** Kan brugeren gå længere frem end denne uge / denne måned? */
export function canGoForward(period: Period): boolean {
  return period === 'this_week' || period === 'this_month';
}

/** "22. – 28. sep." */
export function rangeLabel(period: { from: string; to: string }): string {
  const from = new Date(`${period.from}T00:00:00`);
  const to = new Date(`${period.to}T00:00:00`);
  const sameMonth = from.getMonth() === to.getMonth();
  const start = dfFormat(from, sameMonth ? 'd.' : 'd. MMM', { locale: dateFnsLocale() });
  return `${start} – ${dfFormat(to, 'd. MMM', { locale: dateFnsLocale() })}`;
}

/** Minutter → timer, 2 decimaler. Pauser summeres, de vises ikke enkeltvis. */
export function toHours(minutes: number): number {
  const safe = Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  return Math.round((safe / 60) * 100) / 100;
}

/** "1,6 t" — én decimal, så en leder kan se den store orden uden at regne om. */
export function formatGapHours(minutes: number): string {
  return `${toHours(minutes).toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 1 })} ${formatWords().hourUnit}`;
}

/** i18n-nøglen for antal pauser — i18next vælger varianten på `_one`/`_other`. */
export function pauseCountKey(count: number): 'waste.pause_count_one' | 'waste.pause_count_other' {
  return count === 1 ? 'waste.pause_count_one' : 'waste.pause_count_other';
}

/**
 * Samlet pause for holdet, sorteret som serveren gør det. Vi genberejner
 * ikke — serverens totaler bruges, så skærmen ikke kan afvige fra dem.
 */
export function rankedUsers(log: WasteLog): WasteUser[] {
  return [...log.byUser].sort((a, b) => b.gapMinutes - a.gapMinutes || a.userName.localeCompare(b.userName, intlLocale()));
}

/**
 * Sand når spildtiden ikke kan læses: ingen huller OG ingen uregistrerede
 * varigheder. Registreringer uden start/slut kan ikke give pauser, så en
 * bruger der kun logger varigheder ville stå som 0 uden denne advarsel.
 */
export function isUnreadable(log: WasteLog): boolean {
  return log.totals.gapCount === 0 && log.totals.untimedEntries > 0;
}
