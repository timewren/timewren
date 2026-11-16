import { addDays, parseISO, startOfWeek } from 'date-fns';
import { formatDateShort, toISODate } from '~/lib/format';

export type HeatDay = { date: string; hours: number };

export type HeatCell = {
  date: string;
  hours: number;
  /** 0 = ingen tid, 1..4 = stigende intensitet */
  level: HeatLevel;
  isFuture: boolean;
};

export type HeatLevel = 0 | 1 | 2 | 3 | 4;

/** Farvetrin ud fra timer relativt til dagens maksimum i perioden. */
export function heatLevel(hours: number, maxHours: number): HeatLevel {
  if (hours <= 0 || maxHours <= 0)
    return 0;
  const ratio = hours / maxHours;
  if (ratio <= 0.25)
    return 1;
  if (ratio <= 0.5)
    return 2;
  if (ratio <= 0.75)
    return 3;
  return 4;
}

/** Tailwind-baggrund pr. trin (lys + mørk). */
export const HEAT_CLASS: Record<HeatLevel, string> = {
  0: 'bg-muted',
  1: 'bg-primary-200 dark:bg-primary-900',
  2: 'bg-primary-400 dark:bg-primary-700',
  3: 'bg-primary-500 dark:bg-primary-500',
  4: 'bg-primary-700 dark:bg-primary-300',
};

/**
 * Bygger et `weeks` × 7-gitter (man–søn) der slutter i indeværende uge.
 * Dage uden data får 0 timer; dage efter `now` markeres som fremtid.
 */
export function buildHeatmapWeeks(data: readonly HeatDay[], now: Date = new Date(), weeks = 5): HeatCell[][] {
  const byDate = new Map(data.map(d => [d.date, d.hours]));
  const thisWeekStart = startOfWeek(now, { weekStartsOn: 1 });
  const firstDay = addDays(thisWeekStart, -7 * (weeks - 1));
  const today = toISODate(now);

  const cells: { date: string; hours: number }[] = [];
  for (let i = 0; i < weeks * 7; i++) {
    const date = toISODate(addDays(firstDay, i));
    cells.push({ date, hours: byDate.get(date) ?? 0 });
  }
  const maxHours = cells.reduce((max, c) => Math.max(max, c.hours), 0);

  const grid: HeatCell[][] = [];
  for (let w = 0; w < weeks; w++) {
    grid.push(cells.slice(w * 7, w * 7 + 7).map(c => ({
      ...c,
      level: heatLevel(c.hours, maxHours),
      isFuture: c.date > today,
    })));
  }
  return grid;
}

export type HeatWeekSummary = {
  /** Dage i ugen med registreret tid. En dag, der endnu ikke er nået, tæller ikke. */
  days: number;
  hours: number;
  /** "7. sep. – 13. sep." — tom, hvis datoerne ikke er læsbare */
  range: string;
};

function hasHours(hours: number): boolean {
  return Number.isFinite(hours) && hours > 0;
}

/** Datoer fra et gitter læses som **lokal** tid. */
function isoDay(value: string | undefined): Date | null {
  if (!value)
    return null;
  const date = parseISO(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function weekRange(week: readonly HeatCell[]): string {
  const start = isoDay(week[0]?.date);
  const end = isoDay(week.at(-1)?.date);
  if (!start || !end)
    return '';
  const from = formatDateShort(start);
  const to = formatDateShort(end);
  return from === to ? from : `${from} – ${to}`;
}

/**
 * Hvad en uge indeholder, til skærmlæseren.
 *
 * Gitteret har altid 35 celler med ét `accessibilityLabel` pr. celle, så
 * VoiceOver/TalkBack gjorde hele ugeoversigten til 35 fokusstop uden at sige,
 * hvilken uge de hørte til. Én samlet sum pr. uge erstatter dem.
 */
export function heatWeekSummary(week: readonly HeatCell[]): HeatWeekSummary {
  const passed = week.filter(cell => !cell.isFuture);
  const hours = passed.reduce((sum, cell) => (hasHours(cell.hours) ? sum + cell.hours : sum), 0);
  return {
    days: passed.filter(cell => hasHours(cell.hours)).length,
    hours: Math.round(hours * 100) / 100,
    range: weekRange(week),
  };
}

export type HeatWeekDaysKey = 'overview.heatmap_days_one' | 'overview.heatmap_days_other';

/** Samme mønster som `expectedWeeksKey`: "1 dag" må ikke stå som "1 dage". */
export function heatWeekDaysKey(days: number): HeatWeekDaysKey {
  return days === 1 ? 'overview.heatmap_days_one' : 'overview.heatmap_days_other';
}
