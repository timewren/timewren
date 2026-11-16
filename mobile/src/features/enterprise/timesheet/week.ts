import type { StatTone } from '~/components/ui/stat-tile';
import { addDays, format, startOfWeek } from 'date-fns';
import { formatDateLong, formatHours, toISODate } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { dateFnsLocale, formatWords, intlLocale } from '~/lib/locale';

/** Timeseddel-ugestatus (timesheet_weeks.status). null = kladde. */
export type WeekStatus = 'submitted' | 'approved' | 'rejected' | 'reopened' | null;

/** Mandag i ugen for en dato, som YYYY-MM-DD. */
export function getWeekStart(d: Date | string = new Date()): string {
  const date = typeof d === 'string' ? parseISODate(d) : d;
  return toISODate(startOfWeek(date, { weekStartsOn: 1 }));
}

/** Flyt en uge-start n uger frem/tilbage. */
export function shiftWeek(weekStart: string, weeks: number): string {
  return toISODate(addDays(parseISODate(weekStart), weeks * 7));
}

/** De 7 datoer i ugen (mandag først). */
export function weekDays(weekStart: string): string[] {
  const start = parseISODate(weekStart);
  return Array.from({ length: 7 }, (_, i) => toISODate(addDays(start, i)));
}

/** "yyyy-MM-dd" → lokal Date (undgår UTC-forskydning fra `new Date(str)`). */
export function parseISODate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

/** "1.–7. sep." — uge-interval til headeren. */
export function formatWeekRange(weekStart: string): string {
  const start = parseISODate(weekStart);
  const end = addDays(start, 6);
  const sameMonth = start.getMonth() === end.getMonth();
  const left = sameMonth ? format(start, 'd.') : format(start, 'd. MMM', { locale: dateFnsLocale() });
  return `${left}–${format(end, 'd. MMM', { locale: dateFnsLocale() })}`;
}

/** ISO-ugenummer, fx 36. */
export function isoWeekNumber(weekStart: string): number {
  return Number(format(parseISODate(weekStart), 'I'));
}

/**
 * Timer fra tekstinput med dansk decimalkomma: "7,4" → 7.4, "1:30" → 1.5,
 * "" → null, ugyldig → null. Klemmes til 0–24.
 */
const CLOCK_RE = /^(\d{1,2}):(\d{1,2})$/;
const DECIMAL_RE = /^\d*(?:\.\d*)?$/;

export function parseHoursInput(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '')
    return null;
  const clock = CLOCK_RE.exec(trimmed);
  let value: number;
  if (clock) {
    value = Number(clock[1]) + Number(clock[2]) / 60;
  }
  else {
    const normalized = trimmed.replace(',', '.');
    if (!DECIMAL_RE.test(normalized) || normalized === '.')
      return null;
    value = Number.parseFloat(normalized);
  }
  if (!Number.isFinite(value) || value < 0)
    return null;
  return Math.min(24, Math.round(value * 100) / 100);
}

/** Status → tone til Badge/StatTile. */
export function weekStatusTone(status: WeekStatus | 'draft' | undefined): StatTone {
  switch (status) {
    case 'submitted': return 'warning';
    case 'approved': return 'success';
    case 'rejected': return 'danger';
    default: return 'default';
  }
}

/** i18n-nøgle (under enterprise.timesheet.status) for en ugestatus. */
export function weekStatusKey(status: WeekStatus | 'draft' | undefined): 'draft' | 'submitted' | 'approved' | 'rejected' | 'reopened' {
  return status ?? 'draft';
}

/** Må medarbejderen redigere ugen? Kun indsendt/godkendt er låst (som web). */
export function isWeekEditable(status: WeekStatus | 'draft' | undefined, rollingLocked = false): boolean {
  if (rollingLocked)
    return false;
  return status !== 'submitted' && status !== 'approved';
}

type RowLike = { days: Record<string, { total: number }> };
type AbsenceRowLike = { days: Record<string, { hours: number }> };

export type DayTotal = { work: number; absence: number; total: number };

/** Alt DayStrip skal fortælle skærmlæseren om én dag. */
export type DayLabelInput = {
  /** yyyy-MM-dd */
  day: string;
  /** Dagens total, undefined når dagen ikke er registreret */
  total: DayTotal | undefined;
  /** Dagsnorm; 0 = ikke arbejdsdag */
  norm: number;
  today: string;
  holiday: boolean;
};

/**
 * Label for én dag i DayStrip. Prikken under dagen fortæller om normen er nået
 * (grøn) eller mangler (gul) — det må ikke være farven alene, der siger det.
 * Samme regler som prikken: grønt når `work` når normen.
 */
export function dayLabel(input: DayLabelInput): string {
  const { day, total, norm } = input;
  const parts = [formatDateLong(parseISODate(day))];
  if (day === input.today)
    parts.push(translate('common.today'));
  parts.push((total?.total ?? 0) > 0 ? formatHours(total?.total ?? 0) : translate('enterprise.timesheet.day_no_hours'));
  if (input.holiday) {
    parts.push(translate('enterprise.timesheet.holiday'));
  }
  else if (norm > 0) {
    parts.push(translate('enterprise.common.of_expected', { expected: formatHours(norm) }));
    const met = (total?.work ?? 0) >= norm - 0.01;
    parts.push(translate(met ? 'enterprise.timesheet.day_norm_met' : 'enterprise.timesheet.day_norm_missed'));
  }
  else {
    parts.push(translate('enterprise.timesheet.day_off'));
  }
  return parts.join(', ');
}

/** Dagstotaler: arbejde (alle rækker) + fravær pr. dato. */
export function dayTotals(
  days: readonly string[],
  rows: readonly RowLike[],
  absenceRows: readonly AbsenceRowLike[] = [],
): Record<string, DayTotal> {
  const out: Record<string, DayTotal> = {};
  for (const day of days) {
    let work = 0;
    for (const row of rows)
      work += row.days[day]?.total ?? 0;
    let absence = 0;
    for (const row of absenceRows)
      absence += row.days[day]?.hours ?? 0;
    work = round2(work);
    absence = round2(absence);
    out[day] = { work, absence, total: round2(work + absence) };
  }
  return out;
}

/** Ugetotal (arbejde) fra dagstotaler. */
export function weekTotal(totals: Record<string, DayTotal>): number {
  return round2(Object.values(totals).reduce((sum, d) => sum + d.work, 0));
}

/** Registreret − forventet, afrundet. Positiv = over norm. */
export function expectedDelta(registered: number, expected: number): number {
  return round2(registered - expected);
}

/** Tone for delta mod norm: over = warning, præcis/under = default, komplet = success. */
export function deltaTone(registered: number, expected: number): StatTone {
  if (expected <= 0)
    return 'default';
  const delta = expectedDelta(registered, expected);
  if (delta > 0.01)
    return 'warning';
  if (delta >= -0.01)
    return 'success';
  return 'default';
}

/** "+1,5 t" / "−2 t" / "0 t" */
export function formatDelta(delta: number): string {
  const abs = Math.abs(delta);
  const text = abs.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  if (delta > 0.001)
    return `+${text} ${formatWords().hourUnit}`;
  if (delta < -0.001)
    return `−${text} ${formatWords().hourUnit}`;
  return `0 ${formatWords().hourUnit}`;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
