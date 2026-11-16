import type { RouterOutputs } from '~/api/app-router';
import { addDays, format as dfFormat, parseISO, startOfWeek } from 'date-fns';
import { formatDateShort } from '~/lib/format';
import { dateFnsLocale } from '~/lib/locale';

export type WeekDay = RouterOutputs['time']['getWeekReview']['days'][number];

/** Serveren fordeler ugemålet på 5 arbejdsdage — dagsmålet er udledt, ikke gemt. */
const WORK_DAYS = 5;

/** Skaleringens bund uden ugemål, så grafen stadig læses på en tom uge. */
const SCALE_FLOOR = 4;

/** Sumér dagenes timer, som serveren gør: 2 decimaler. */
export function sumHours(days: WeekDay[]): number {
  const total = days.reduce((sum, d) => sum + (Number.isFinite(d.hours) ? d.hours : 0), 0);
  return Math.round(total * 100) / 100;
}

/** Dagsmålet udledt af ugemålet. `null` når intet er sat (eller værdien er 0). */
export function dailyGoal(weeklyGoal: number | null | undefined): number | null {
  if (typeof weeklyGoal !== 'number' || !Number.isFinite(weeklyGoal) || weeklyGoal <= 0)
    return null;
  return weeklyGoal / WORK_DAYS;
}

/** Hvad en dags bjælke måles mod: dagsmålet, ellers ugens bedste dag. */
export function dayReference(weeklyGoal: number | null, days: WeekDay[]): number {
  const goal = dailyGoal(weeklyGoal);
  if (goal !== null)
    return goal;
  const best = days.reduce((max, d) => Math.max(max, Number.isFinite(d.hours) ? d.hours : 0), 0);
  return Math.max(SCALE_FLOOR, best);
}

/** 0–1. Uden ugemål er der intet at måle imod, så der vises ingen fremdrift. */
export function weekFraction(total: number, weeklyGoal: number | null): number {
  if (typeof weeklyGoal !== 'number' || !Number.isFinite(weeklyGoal) || weeklyGoal <= 0)
    return 0;
  return Math.min(1, Math.max(0, total / weeklyGoal));
}

/** 0–1 mod en reference (se `dayReference`). */
export function barFraction(hours: number, reference: number): number {
  if (!Number.isFinite(hours) || !Number.isFinite(reference) || reference <= 0)
    return 0;
  return Math.min(1, Math.max(0, hours / reference));
}

/** Hullerne serveren har markeret (kun hverdage under halvdelen af dagsmålet). */
export function thinDays(days: WeekDay[]): WeekDay[] {
  return days.filter(d => d.isGap);
}

/** Mandagen i den uge `now` falder i, som `yyyy-MM-dd`. */
export function currentWeekStart(now: Date = new Date()): string {
  return dfFormat(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** "28. sep. – 4. okt." */
export function weekRangeLabel(weekStart: string): string {
  const start = parseISO(weekStart);
  return `${formatDateShort(start)} – ${formatDateShort(addDays(start, 6))}`;
}

/** Kort ugedagsnavn fra datoen, så etiketten følger kalenderen og ikke rækkefølgen. */
export function dayLabel(date: string): string {
  const text = dfFormat(parseISO(date), 'EEEE', { locale: dateFnsLocale() });
  return text.charAt(0).toUpperCase() + text.slice(1, 3);
}
