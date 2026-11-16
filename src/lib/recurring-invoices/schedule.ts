// Gentagne fakturaer (#198): ren kalender-logik — ingen DB-imports, så den
// kan bruges fra både cron, tRPC og "use client"-komponenter og testes i
// vitest. Alle datoer er danske kalenderdatoer som "yyyy-MM-dd".

import { roundMoney, sumMoney } from "@/lib/format";
import { addDaysToDateStr, addMonthsToDateStr } from "@/lib/time/copenhagen";
import { clampDayOfMonth } from "@/lib/time/recurring-next-due";

export const RECURRING_INVOICE_INTERVALS = [
  "monthly",
  "quarterly",
  "yearly",
] as const;
export type RecurringInvoiceInterval =
  (typeof RECURRING_INVOICE_INTERVALS)[number];

export const RECURRING_INVOICE_INTERVAL_LABELS: Record<
  RecurringInvoiceInterval,
  string
> = {
  monthly: "Hver måned",
  quarterly: "Hvert kvartal",
  yearly: "Hvert år",
};

/**
 * fixed = faste linjer, forudbetalt for perioden der starter på kørselsdatoen.
 * time = registreret tid i perioden der slutter dagen før kørselsdatoen
 * (bagudbetalt), plus eventuelle faste linjer.
 */
export const RECURRING_INVOICE_MODES = ["fixed", "time"] as const;
export type RecurringInvoiceMode = (typeof RECURRING_INVOICE_MODES)[number];

const INTERVAL_MONTHS: Record<RecurringInvoiceInterval, number> = {
  monthly: 1,
  quarterly: 3,
  yearly: 12,
};

export function isRecurringInvoiceInterval(
  value: string | null | undefined,
): value is RecurringInvoiceInterval {
  return (
    !!value &&
    (RECURRING_INVOICE_INTERVALS as readonly string[]).includes(value)
  );
}

/**
 * Kørselsdatoen `steps` intervaller fra `dateStr` (negativ = bagud). Dagen er
 * altid `anchorDay` klemt til månedens længde, så en aftale der starter den
 * 31. giver 31/1 → 28/2 → 31/3 og aldrig glider ned på den 28. for altid.
 */
export function shiftRunDate(
  dateStr: string,
  interval: RecurringInvoiceInterval,
  anchorDay: number,
  steps = 1,
): string {
  const firstOfTarget = addMonthsToDateStr(
    `${dateStr.slice(0, 7)}-01`,
    INTERVAL_MONTHS[interval] * steps,
  );
  return clampDayOfMonth(firstOfTarget, anchorDay);
}

/** Næste kørselsdato efter `dateStr`. */
export function nextRunDate(
  dateStr: string,
  interval: RecurringInvoiceInterval,
  anchorDay: number,
): string {
  return shiftRunDate(dateStr, interval, anchorDay, 1);
}

/** Ankerdagen for en startdato (1-31). */
export function anchorDayOf(dateStr: string): number {
  return Number(dateStr.slice(8, 10));
}

export interface InvoicePeriod {
  start: string;
  end: string;
}

/**
 * Perioden en kørsel fakturerer. Fast beløb forudbetales: perioden starter
 * på kørselsdatoen. Registreret tid faktureres bagud: perioden slutter dagen
 * før kørselsdatoen. Begge ender er inklusive.
 */
export function periodForRun(
  runDate: string,
  interval: RecurringInvoiceInterval,
  anchorDay: number,
  mode: RecurringInvoiceMode,
): InvoicePeriod {
  if (mode === "time") {
    return {
      start: shiftRunDate(runDate, interval, anchorDay, -1),
      end: addDaysToDateStr(runDate, -1),
    };
  }
  return {
    start: runDate,
    end: addDaysToDateStr(nextRunDate(runDate, interval, anchorDay), -1),
  };
}

/** De næste `count` kørselsdatoer fra og med `fromDate`. */
export function upcomingRunDates(
  fromDate: string,
  interval: RecurringInvoiceInterval,
  anchorDay: number,
  count: number,
): string[] {
  const dates: string[] = [];
  let current = fromDate;
  for (let i = 0; i < count; i++) {
    dates.push(current);
    current = nextRunDate(current, interval, anchorDay);
  }
  return dates;
}

/**
 * Første kørselsdato på eller efter `today` i rytmen fra `dateStr`. Bruges når
 * en skabelon genoptages efter en pause: de perioder der lå i pausen springes
 * over i stedet for at blive faktureret i ét hug.
 */
export function rollForwardRunDate(
  dateStr: string,
  interval: RecurringInvoiceInterval,
  anchorDay: number,
  today: string,
): string {
  let current = dateStr;
  // Loft mod uendelige løkker ved korrupte data (1000 år på månedlig)
  for (let i = 0; current < today && i < 12000; i++) {
    current = nextRunDate(current, interval, anchorDay);
  }
  return current;
}

const MONTH_NAMES = [
  "januar",
  "februar",
  "marts",
  "april",
  "maj",
  "juni",
  "juli",
  "august",
  "september",
  "oktober",
  "november",
  "december",
];

/** "2026-10-31" → "31.10.2026" */
export function formatDanishDate(dateStr: string): string {
  return `${dateStr.slice(8, 10)}.${dateStr.slice(5, 7)}.${dateStr.slice(0, 4)}`;
}

/** Tekstvariabler der kan bruges i linjebeskrivelser og noter. */
export const PERIOD_VARIABLES = [
  "{periode}",
  "{periode_start}",
  "{periode_slut}",
  "{måned}",
  "{år}",
] as const;

/**
 * Udfyld periodevariablerne i en tekst, så beskrivelsen ikke skal rettes
 * hver måned ("Teknisk partner, {periode}").
 */
export function renderPeriodText(text: string, period: InvoicePeriod): string {
  const month = Number(period.start.slice(5, 7));
  const values: Record<string, string> = {
    "{periode}": `${formatDanishDate(period.start)}–${formatDanishDate(period.end)}`,
    "{periode_start}": formatDanishDate(period.start),
    "{periode_slut}": formatDanishDate(period.end),
    "{måned}": `${MONTH_NAMES[month - 1] ?? ""} ${period.start.slice(0, 4)}`,
    "{år}": period.start.slice(0, 4),
  };
  return text.replace(
    /\{(periode|periode_start|periode_slut|måned|år)\}/g,
    (match) => values[match] ?? match,
  );
}

export interface RecurringInvoiceLineInput {
  description: string;
  quantity: string;
  unitPrice: string;
}

/** Linjebeløb i hele kroner og ører — samme afrunding som fakturalinjerne. */
export function lineAmount(line: {
  quantity: string;
  unitPrice: string;
}): number {
  const qty = Number.parseFloat(line.quantity) || 0;
  const price = Number.parseFloat(line.unitPrice) || 0;
  return roundMoney(qty * price);
}

/** Sum af de faste linjer (eksklusive moms). */
export function fixedLinesTotal(lines: RecurringInvoiceLineInput[]): number {
  return sumMoney(lines.map(lineAmount));
}
