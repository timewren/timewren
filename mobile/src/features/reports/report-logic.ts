import type { RouterInputs } from '~/api/app-router';
import { endOfWeek, isValid, parse, startOfWeek } from 'date-fns';
import { toISODate } from '~/lib/format';

export type ReportPeriod = 'thisWeek' | 'thisMonth' | 'lastMonth' | 'thisQuarter' | 'thisYear' | 'custom';
export const REPORT_PERIODS: readonly ReportPeriod[] = ['thisWeek', 'thisMonth', 'lastMonth', 'thisQuarter', 'thisYear', 'custom'];

export type ReportMetric = 'hours' | 'revenue';

export type ReportConfig = RouterInputs['reports']['getReportData']['config'];
type ReportFilters = NonNullable<ReportConfig['filters']>;

/** Kolonner der giver mening i en CSV fra mobilen — backenden kræver mindst én. */
export const REPORT_COLUMNS = ['date', 'client', 'project', 'description', 'hours', 'rate', 'value', 'billed'] as const;

export type PeriodInput = { period: ReportPeriod; customStart?: string; customEnd?: string };

function parseISO(text: string | undefined): Date | null {
  if (!text)
    return null;
  const d = parse(text.trim(), 'yyyy-MM-dd', new Date());
  return isValid(d) ? d : null;
}

/**
 * Oversæt mobilens periode-valg til backendens filter. "Denne uge" findes
 * ikke i backendens enum, så den sendes som custom mandag–søndag.
 * Returnerer null når en egen periode er ufuldstændig/ugyldig.
 */
export function periodToFilters(input: PeriodInput, now = new Date()): Pick<ReportFilters, 'dateRange' | 'customStart' | 'customEnd'> | null {
  switch (input.period) {
    case 'thisWeek':
      return {
        dateRange: 'custom',
        customStart: toISODate(startOfWeek(now, { weekStartsOn: 1 })),
        customEnd: toISODate(endOfWeek(now, { weekStartsOn: 1 })),
      };
    case 'custom': {
      const start = parseISO(input.customStart);
      const end = parseISO(input.customEnd);
      if (!start || !end || start > end)
        return null;
      return { dateRange: 'custom', customStart: toISODate(start), customEnd: toISODate(end) };
    }
    default:
      return { dateRange: input.period };
  }
}

export function buildReportConfig(input: PeriodInput, now = new Date()): ReportConfig | null {
  const range = periodToFilters(input, now);
  if (!range)
    return null;
  return {
    audience: 'internal',
    filters: { ...range },
    grouping: 'none',
    columns: [...REPORT_COLUMNS],
    branding: {},
  };
}

export type ReportEntryLike = {
  hours: string;
  _rounded: number;
  _value: number;
  isBilled: boolean;
  billableRate: string | null;
  client: { id: string; name: string } | null;
  project: { id: string; name: string; client: { id: string; name: string } | null } | null;
  member: { userId: string; name: string } | null;
};

export type Bar = { key: string; label: string; hours: number; revenue: number };

export type GroupBy = 'client' | 'project' | 'member';

/**
 * Fordeling pr. kunde/projekt/medlem regnet lokalt ud fra posteringerne, så
 * én forespørgsel (grouping: 'none') dækker alle tre visninger.
 */
export function groupEntries(entries: ReportEntryLike[], by: GroupBy, fallbackLabel: string): Bar[] {
  const groups = new Map<string, Bar>();
  for (const e of entries) {
    const { key, label } = keyFor(e, by, fallbackLabel);
    const g = groups.get(key) ?? { key, label, hours: 0, revenue: 0 };
    g.hours += e._rounded ?? Number.parseFloat(e.hours);
    g.revenue += e._value;
    groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => b.hours - a.hours);
}

function keyFor(e: ReportEntryLike, by: GroupBy, fallback: string): { key: string; label: string } {
  if (by === 'client') {
    const c = e.client ?? e.project?.client;
    return { key: c?.id ?? '_none', label: c?.name ?? fallback };
  }
  if (by === 'project')
    return { key: e.project?.id ?? '_none', label: e.project?.name ?? fallback };
  return { key: e.member?.userId ?? '_none', label: e.member?.name ?? fallback };
}

/** Bredde i procent af den største søjle (0–100), robust mod 0 og negative værdier. */
export function barPercent(value: number, max: number): number {
  if (max <= 0 || value <= 0)
    return 0;
  return Math.min(100, Math.round((value / max) * 100));
}

export function hasMemberData(entries: ReportEntryLike[]): boolean {
  return entries.some(e => e.member?.userId);
}

/** Fakturerbare timer = poster med sats > 0. */
export function billableHours(entries: ReportEntryLike[]): number {
  return entries.reduce((sum, e) => {
    const rate = Number.parseFloat(e.billableRate ?? '0');
    return rate > 0 ? sum + (e._rounded ?? Number.parseFloat(e.hours)) : sum;
  }, 0);
}
