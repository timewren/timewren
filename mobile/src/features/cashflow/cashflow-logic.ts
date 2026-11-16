import type { RouterOutputs } from '~/api/app-router';
import { formatDateShort, formatMoney } from '~/lib/format';

export type VatOverview = RouterOutputs['vat']['getVatOverview'];
/** Serverens svar når brugeren har valgt "ikke momspligtig" i virksomhedsprofilen. */
export type VatExempt = Extract<VatOverview, { isVatExempt: true }>;
/** Serverens tal for den aktive afgiftsperiode og år-til-dato. */
export type VatNumbers = Extract<VatOverview, { isVatExempt: false }>;
export type CashflowForecast = RouterOutputs['cashflow']['getCashflowForecast'];
export type ForecastWeek = CashflowForecast['weeks'][number];

export type DeadlineTone = 'danger' | 'warning' | 'default';

const TONE_TEXT: Record<DeadlineTone, string> = {
  danger: 'text-danger-600 dark:text-danger-400',
  warning: 'text-warning-600 dark:text-warning-400',
  default: 'text-foreground',
};

export function toneClass(tone: DeadlineTone): string {
  return TONE_TEXT[tone];
}

/** Et ugyldigt tal fra serveren må aldrig blive "NaN kr.". */
export function safeAmount(amount: number | null | undefined): number {
  return typeof amount === 'number' && Number.isFinite(amount) ? amount : 0;
}

/**
 * Web's `getUpcomingDeadlines` nummererer alle moms-frister med `vat-`
 * (`vat-q1-2027`, `vat-h2-2026`, `vat-monthly-2026-10`). B-skat og
 * selvangivelse har andre præfikser, så præfikset er en pålidelig skeln —
 * titlen ("Moms Q1") kan derimod ændre sig i web'ens oversættelse.
 */
export function isVatDeadline(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('vat-');
}

export function isVatExempt(vat: VatOverview | null | undefined): vat is VatExempt {
  return vat?.isVatExempt === true;
}

/**
 * Uden en eneste sendt eller betalt faktura er intet at estimere. Web skjuler
 * widgetten bag "opret din første faktura", og det samme gør vi: en "0 kr."
 * ville se ud som et resultat af noget, der aldrig skete.
 */
export function hasVatFigures(vat: VatNumbers | null | undefined): boolean {
  if (!vat)
    return false;
  return safeAmount(vat.ytdInvoicedExVat) > 0 || safeAmount(vat.currentPeriod.invoicedExVat) > 0;
}

/** Uden frist-dage fra serveren må vi ikke farve rødt på et gæt. */
export function deadlineTone(daysUntil: number | null | undefined): DeadlineTone {
  if (typeof daysUntil !== 'number' || !Number.isFinite(daysUntil))
    return 'default';
  if (daysUntil <= 7)
    return 'danger';
  return daysUntil <= 30 ? 'warning' : 'default';
}

export type DeadlineCaptionKey
  = | 'cashflow.deadline_unknown'
    | 'cashflow.deadline_overdue'
    | 'cashflow.deadline_today'
    | 'cashflow.deadline_one'
    | 'cashflow.deadline_other';

export function deadlineCaptionKey(daysUntil: number | null | undefined): DeadlineCaptionKey {
  if (typeof daysUntil !== 'number' || !Number.isFinite(daysUntil))
    return 'cashflow.deadline_unknown';
  if (daysUntil < 0)
    return 'cashflow.deadline_overdue';
  if (daysUntil === 0)
    return 'cashflow.deadline_today';
  return daysUntil === 1 ? 'cashflow.deadline_one' : 'cashflow.deadline_other';
}

/** Uden forventede indbetalinger er der ingen prognose at vise. */
export function hasForecast(forecast: CashflowForecast | null | undefined): boolean {
  return safeAmount(forecast?.totalExpected) > 0;
}

/** Skalaen til ugernes bjælker. Mindst 1, så en tom prognose ikke deler med nul. */
export function forecastMax(weeks: readonly ForecastWeek[] | null | undefined): number {
  const max = (weeks ?? []).reduce((best, week) => Math.max(best, safeAmount(week.expectedAmount)), 0);
  return Math.max(max, 1);
}

export function weekBarFraction(amount: number | null | undefined, max: number): number {
  const value = safeAmount(amount);
  if (!Number.isFinite(max) || max <= 0)
    return 0;
  return Math.min(Math.max(value / max, 0), 1);
}

/** 0 i en uge er en tankestreg, ikke "0 kr." — ellers ligner en tom uge et beløb. */
export function weekAmountText(amount: number | null | undefined): string {
  const value = safeAmount(amount);
  return value > 0 ? formatMoney(value) : '—';
}

export type ForecastCoverage = {
  /** Antal uger serveren faktisk har sendt — aldrig et tal fra en tekst. */
  weekCount: number;
  /** "28. sep. – 25. okt." eller tom, hvis serveren ikke gav læsbare datoer. */
  range: string;
};

/**
 * Hvad `totalExpected` dækker.
 *
 * Serveren bygger `FORECAST_WEEKS = 4` mandag–søndag-vinduer fra mandagen i
 * denne uge (`forecast.ts:144-152`, uge 1 klippet til i dag), men kalder sin egen
 * grænse `forecastEnd = addDays(today, 30)` (`:179`). De to dækker aldrig det
 * samme: en betaling mellem sidste vindues søndag og `forecastEnd` består
 * `findWeek`-tjekket og **droppes stille** (`:236-237`). Sidste vindue lukker
 * altid 25/10 i eksemplet, så tabet afhænger af ugedagen — 3 dage en mandag,
 * 5 en onsdag, 9 en søndag. Labelen "næste 30 dage" var derfor en påstand
 * uden kilde; den er erstattet af de uger og den daterække, serveren leverer.
 */
export function forecastCoverage(
  weeks: readonly ForecastWeek[] | null | undefined,
): ForecastCoverage {
  const list = weeks ?? [];
  // En prognose uden uger er ikke "0 uger": den dækker mindst denne uge.
  const weekCount = Math.max(list.length, 1);
  const first = list[0];
  const last = list.at(-1);
  const from = first ? readableDate(first.from) : null;
  const to = last ? readableDate(last.to) : null;
  if (!from || !to)
    return { weekCount, range: '' };
  const start = formatDateShort(from);
  const end = formatDateShort(to);
  return { weekCount, range: start === end ? start : `${start} – ${end}` };
}

function readableDate(value: Date | string | number | null | undefined): Date | null {
  const date = value instanceof Date ? value : new Date(value ?? Number.NaN);
  return Number.isNaN(date.getTime()) ? null : date;
}

export type ExpectedWeeksKey
  = | 'cashflow.expected_weeks_one'
    | 'cashflow.expected_weeks_other';

/**
 * Samme mønster som `deadlineCaptionKey`: nøglen afhænger af tallet, så
 * teksten "1 uge" ikke kan stå ved siden af "4 uger". `count` sendes stadig
 * med, så i18next finder `_one`/`_other` selv.
 */
export function expectedWeeksKey(weekCount: number): ExpectedWeeksKey {
  return weekCount === 1 ? 'cashflow.expected_weeks_one' : 'cashflow.expected_weeks_other';
}
