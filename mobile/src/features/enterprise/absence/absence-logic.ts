import type { StatTone } from '~/components/ui/stat-tile';
import type { TxKeyPath } from '~/lib/i18n';
import { addDays, format, parseISO, startOfWeek } from 'date-fns';
import { formatDateLong, formatDateShort } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { formatWords, intlLocale } from '~/lib/locale';

export type AbsenceStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

/** Samme regler som web-backendens countWorkingDays (src/lib/enterprise/vacation.ts). */
export type CountDaysInput = {
  startDate: string;
  endDate: string;
  /** ISO-ugedage som strenge, "1" = mandag … "7" = søndag */
  workingDays?: readonly string[];
  /** yyyy-MM-dd for hele helligdage (halve helligdage tæller som hel dag) */
  holidayDates?: readonly string[];
  halfDayStart?: boolean;
  halfDayEnd?: boolean;
};

const DEFAULT_WORKING_DAYS: readonly string[] = ['1', '2', '3', '4', '5'];

/** Antal fraværsdage — springer weekender og helligdage over; halve dage tæller 0,5. */
export function countAbsenceDays(input: CountDaysInput): number {
  const { startDate, endDate, halfDayStart = false, halfDayEnd = false } = input;
  if (!startDate || !endDate || endDate < startDate)
    return 0;
  const workingDays = input.workingDays ?? DEFAULT_WORKING_DAYS;
  const holidays = new Set(input.holidayDates ?? []);
  const start = parseISO(startDate);
  const end = parseISO(endDate);
  let count = 0;
  for (let current = start; current <= end; current = addDays(current, 1)) {
    const iso = format(current, 'yyyy-MM-dd');
    const isoDay = current.getDay() === 0 ? '7' : String(current.getDay());
    if (!workingDays.includes(isoDay) || holidays.has(iso))
      continue;
    const isFirst = iso === startDate;
    const isLast = iso === endDate;
    let value = 1;
    if (isFirst && isLast) {
      if (halfDayStart || halfDayEnd)
        value = 0.5;
    }
    else if ((isFirst && halfDayStart) || (isLast && halfDayEnd)) {
      value = 0.5;
    }
    count += value;
  }
  return count;
}

export function absenceStatusTone(status: string): StatTone {
  switch (status) {
    case 'approved': return 'success';
    case 'pending': return 'warning';
    case 'rejected': return 'danger';
    default: return 'default';
  }
}

export function absenceStatusKey(status: string): TxKeyPath {
  switch (status) {
    case 'approved': return 'enterprise.absence.status.approved';
    case 'pending': return 'enterprise.absence.status.pending';
    case 'rejected': return 'enterprise.absence.status.rejected';
    case 'cancelled': return 'enterprise.absence.status.cancelled';
    default: return 'enterprise.absence.status.unknown';
  }
}

/** Sygdom og orlov må registreres uden slutdato (åben periode, raskmelding lukker den). */
export function allowsOpenPeriod(category: string | null | undefined): boolean {
  return category === 'sickness' || category === 'leave';
}

/** "1,5 dage" / "1 dag" */
export function formatDays(days: number | string | null | undefined): string {
  const n = typeof days === 'string' ? Number.parseFloat(days) : (days ?? 0);
  const safe = Number.isFinite(n) ? n : 0;
  const text = safe.toLocaleString(intlLocale(), { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  return `${text} ${safe === 1 ? formatWords().day : formatWords().days}`;
}

export type RangeLike = { startDate: string; endDate: string | null };

function effectiveEnd(range: RangeLike, today: string): string {
  return range.endDate ?? (range.startDate > today ? range.startDate : today);
}

/** Ligger dagen (yyyy-MM-dd) i perioden? Åben periode (endDate=null) løber til og med i dag. */
export function dayInRange(day: string, range: RangeLike, today: string): boolean {
  return day >= range.startDate && day <= effectiveEnd(range, today);
}

/** Overlapper perioden vinduet [from, to]? */
export function rangeOverlaps(range: RangeLike, window: { from: string; to: string }, today: string): boolean {
  return range.startDate <= window.to && effectiveEnd(range, today) >= window.from;
}

/** N uger à 7 dage (yyyy-MM-dd) fra mandag i indeværende uge. */
export function calendarWeeks(today: Date, weeks = 4): string[][] {
  const monday = startOfWeek(today, { weekStartsOn: 1 });
  return Array.from({ length: weeks }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => format(addDays(monday, w * 7 + d), 'yyyy-MM-dd')));
}

/** Farven på en dag siger intet for en skærmlæser — typen og statussen skal med. */
export type DayMark = { name: string; pending: boolean } | null;

export type DayMarkLabelInput = {
  /** yyyy-MM-dd */
  day: string;
  mark: DayMark;
  holiday: boolean;
  today: string;
};

/** Label for én dag i kalenderstriben: dato, fraværstype med status, helligdag. */
export function dayMarkLabel(input: DayMarkLabelInput): string {
  const { day, mark } = input;
  const parts = [formatDateLong(parseISO(day))];
  if (day === input.today)
    parts.push(translate('common.today'));
  if (mark) {
    parts.push(mark.name);
    parts.push(translate(mark.pending ? 'enterprise.absence.status.pending' : 'enterprise.absence.status.approved'));
  }
  if (input.holiday)
    parts.push(translate('enterprise.absence.holiday'));
  return parts.join(', ');
}

export type BalanceLike = {
  periodStart: string;
  periodEnd: string;
};

/** Saldo-rækken der dækker i dag; ellers den nyeste (listen er sorteret nyeste først). */
export function pickCurrentBalance<T extends BalanceLike>(balances: readonly T[] | undefined, today: string): T | undefined {
  if (!balances || balances.length === 0)
    return undefined;
  return balances.find(b => b.periodStart <= today && b.periodEnd >= today) ?? balances[0];
}

/** "6. sep. – 10. sep." / "6. sep." / "Fra 6. sep." (åben periode) */
export function formatAbsenceRange(range: RangeLike, fmt: (d: string) => string): string {
  if (!range.endDate)
    return `Fra ${fmt(range.startDate)}`;
  if (range.startDate === range.endDate)
    return fmt(range.startDate);
  return `${fmt(range.startDate)} – ${fmt(range.endDate)}`;
}

/** Periode-tekst med appens korte datoformat. */
export function requestPeriodText(range: RangeLike): string {
  return formatAbsenceRange(range, d => formatDateShort(parseISO(d)));
}

/** Ugedags-nøgler til kalender-headere (stabile React-keys). */
export const WEEKDAY_HEADERS: ReadonlyArray<{ key: string; label: string }> = [
  { key: 'mon', label: 'M' },
  { key: 'tue', label: 'T' },
  { key: 'wed', label: 'O' },
  { key: 'thu', label: 'T' },
  { key: 'fri', label: 'F' },
  { key: 'sat', label: 'L' },
  { key: 'sun', label: 'S' },
];
