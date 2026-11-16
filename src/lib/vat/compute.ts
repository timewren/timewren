/**
 * VAT (moms) calculation utilities for Danish freelancers.
 *
 * Supports quarterly (kvartalsvis), semi-annual (halvårlig) and monthly
 * VAT periods. The user's `vatPeriod` is read from their settings — pass
 * it to `computeVatOverview` via the `vatPeriod` input.
 */

export const VAT_RATE = 0.25;

// -------------------------------------------------------------------------
// Period types
// -------------------------------------------------------------------------

/**
 * The VAT declaration cadence for the user. Matches `users.vatPeriod`
 * values: 'monthly' | 'quarterly' | 'semi_annual' | 'none'.
 *
 * 'none' means the user is not VAT-registered and no calculations apply.
 */
export type VatPeriodKind = "monthly" | "quarterly" | "semi_annual";

export interface VatPeriod {
  kind: VatPeriodKind;
  /** Human-readable label, e.g. "April 2026", "Q2 2026", "H1 2026" */
  label: string;
  /** ISO date "YYYY-MM-DD" of first day */
  from: string;
  /** ISO date "YYYY-MM-DD" of last day */
  to: string;
  year: number;
  /** Internal ordinal: 1-12 for monthly, 1-4 for quarterly, 1-2 for semi-annual */
  ordinal: number;
}

// -------------------------------------------------------------------------
// Legacy quarter types (kept for backwards-compat with existing callers)
// -------------------------------------------------------------------------

export interface VatQuarter {
  label: string;
  from: string;
  to: string;
  quarter: 1 | 2 | 3 | 4;
  year: number;
}

export interface VatDeadline {
  /** Human-readable Danish label, e.g. "20. juli 2026" */
  label: string;
  daysUntil: number;
  /** The period label, e.g. "Q2 2026" / "April 2026" / "H1 2026" */
  periodLabel: string;
}

export interface VatOverviewInput {
  /** Invoices to consider — only status 'sent' or 'paid' */
  invoices: Array<{
    issueDate: Date;
    /** Ex-VAT amount (invoices.amount stores ex-VAT totals) */
    amountExVat: number;
  }>;
  /** Today's date (injected for testability) */
  today: Date;
  /** User's VAT period. Defaults to 'quarterly' when not specified. */
  vatPeriod?: VatPeriodKind;
}

export interface VatOverview {
  periodKind: VatPeriodKind;
  ytdInvoicedExVat: number;
  ytdVat: number;
  currentPeriod: {
    label: string;
    from: string;
    to: string;
    invoicedExVat: number;
    vat: number;
  };
  nextDeadline: VatDeadline;
  /** Recommended savings = same as currentPeriod.vat */
  recommendedSavings: number;
}

// -------------------------------------------------------------------------
// Helpers: string formatting
// -------------------------------------------------------------------------

/** Zero-pad 2 digits. */
function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Format a Date to "YYYY-MM-DD" using local time (no UTC shift). */
function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Last day of the given 0-indexed month. */
function lastDayOfMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

const DANISH_MONTHS = [
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

/**
 * Format a Date as a Danish date string, e.g. "20. juli 2026".
 */
export function formatDanishDate(date: Date): string {
  return `${date.getDate()}. ${DANISH_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

// -------------------------------------------------------------------------
// Period resolvers
// -------------------------------------------------------------------------

/**
 * Return the calendar month containing `date` as a VAT period.
 * Monthly VAT deadline is the 25th of the following month (simplified —
 * SKAT's rule is "last weekday of following month", which we approximate).
 */
function getMonthlyPeriod(date: Date): VatPeriod {
  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed
  const from = `${year}-${pad(month + 1)}-01`;
  const to = `${year}-${pad(month + 1)}-${pad(lastDayOfMonth(year, month))}`;
  const label = `${DANISH_MONTHS[month].charAt(0).toUpperCase()}${DANISH_MONTHS[month].slice(1)} ${year}`;
  return {
    kind: "monthly",
    label,
    from,
    to,
    year,
    ordinal: month + 1, // 1-12
  };
}

/**
 * Return the quarter containing `date` as a VAT period.
 */
function getQuarterlyPeriod(date: Date): VatPeriod {
  const year = date.getFullYear();
  const month = date.getMonth();
  let quarter: 1 | 2 | 3 | 4;
  let from: string;
  let to: string;
  if (month <= 2) {
    quarter = 1;
    from = `${year}-01-01`;
    to = `${year}-03-31`;
  } else if (month <= 5) {
    quarter = 2;
    from = `${year}-04-01`;
    to = `${year}-06-30`;
  } else if (month <= 8) {
    quarter = 3;
    from = `${year}-07-01`;
    to = `${year}-09-30`;
  } else {
    quarter = 4;
    from = `${year}-10-01`;
    to = `${year}-12-31`;
  }
  return {
    kind: "quarterly",
    label: `Q${quarter} ${year}`,
    from,
    to,
    year,
    ordinal: quarter,
  };
}

/**
 * Return the half-year containing `date` as a VAT period.
 * H1 = Jan-Jun, H2 = Jul-Dec.
 */
function getSemiAnnualPeriod(date: Date): VatPeriod {
  const year = date.getFullYear();
  const month = date.getMonth();
  const half: 1 | 2 = month <= 5 ? 1 : 2;
  const from = half === 1 ? `${year}-01-01` : `${year}-07-01`;
  const to = half === 1 ? `${year}-06-30` : `${year}-12-31`;
  return {
    kind: "semi_annual",
    label: `H${half} ${year}`,
    from,
    to,
    year,
    ordinal: half,
  };
}

/**
 * Return the VAT period containing `date`, for the given period kind.
 */
export function getVatPeriodForDate(
  date: Date,
  kind: VatPeriodKind,
): VatPeriod {
  switch (kind) {
    case "monthly":
      return getMonthlyPeriod(date);
    case "quarterly":
      return getQuarterlyPeriod(date);
    case "semi_annual":
      return getSemiAnnualPeriod(date);
  }
}

// -------------------------------------------------------------------------
// Deadline resolvers
// -------------------------------------------------------------------------

/**
 * Danish VAT deadline for the period.
 *
 * - Monthly: 25th of the month after the period (period end + 1 month).
 * - Quarterly: 20th of the month two months after quarter-end (Q1 → 20. april,
 *   Q2 → 20. juli, Q3 → 20. oktober, Q4 → 20. januar next year).
 * - Semi-annual: H1 → 1. september same year · H2 → 1. marts next year.
 */
export function getNextDeadlineForPeriod(period: VatPeriod): Date {
  if (period.kind === "monthly") {
    const month = period.ordinal; // 1-12 current month
    const deadlineYear = month === 12 ? period.year + 1 : period.year;
    const deadlineMonth = month === 12 ? 0 : month; // 0-indexed next month
    return new Date(deadlineYear, deadlineMonth, 25);
  }

  if (period.kind === "quarterly") {
    const q = period.ordinal;
    if (q === 4) return new Date(period.year + 1, 0, 20); // 20. januar
    return new Date(period.year, q * 3 + 0, 20); // 20. of (q*3+1)'th month 0-indexed = q*3
    // Q1(1) → month 3 (april), Q2(2) → 6 (juli), Q3(3) → 9 (oktober)
  }

  // semi_annual
  if (period.ordinal === 1) return new Date(period.year, 8, 1); // 1. september
  return new Date(period.year + 1, 2, 1); // 1. marts next year
}

// -------------------------------------------------------------------------
// Legacy quarter helpers (kept for compatibility with earlier callers)
// -------------------------------------------------------------------------

/**
 * @deprecated Use `getVatPeriodForDate(date, 'quarterly')` instead.
 */
export function getVatQuarter(date: Date): VatQuarter {
  const p = getQuarterlyPeriod(date);
  return {
    label: p.label,
    from: p.from,
    to: p.to,
    quarter: p.ordinal as 1 | 2 | 3 | 4,
    year: p.year,
  };
}

/**
 * @deprecated Use `getNextDeadlineForPeriod` instead.
 */
export function getQuarterDeadline(quarter: VatQuarter): Date {
  return getNextDeadlineForPeriod({
    kind: "quarterly",
    label: quarter.label,
    from: quarter.from,
    to: quarter.to,
    year: quarter.year,
    ordinal: quarter.quarter,
  });
}

// -------------------------------------------------------------------------
// Date math
// -------------------------------------------------------------------------

/**
 * Days between today and deadline. 0 if same day, negative if past.
 */
export function daysUntilDeadline(today: Date, deadline: Date): number {
  const todayMs = Date.UTC(
    today.getFullYear(),
    today.getMonth(),
    today.getDate(),
  );
  const deadlineMs = Date.UTC(
    deadline.getFullYear(),
    deadline.getMonth(),
    deadline.getDate(),
  );
  return Math.round((deadlineMs - todayMs) / (1000 * 60 * 60 * 24));
}

// -------------------------------------------------------------------------
// Main computation
// -------------------------------------------------------------------------

/**
 * Compute all VAT overview figures for the widget, respecting the user's
 * VAT period (monthly / quarterly / semi-annual). Defaults to quarterly
 * if `vatPeriod` is not provided.
 */
export function computeVatOverview(input: VatOverviewInput): VatOverview {
  const { invoices, today, vatPeriod = "quarterly" } = input;

  const currentYear = today.getFullYear();
  const currentPeriod = getVatPeriodForDate(today, vatPeriod);
  const deadline = getNextDeadlineForPeriod(currentPeriod);
  const daysUntil = daysUntilDeadline(today, deadline);

  // YTD boundary: 1st Jan of current year
  const ytdFrom = `${currentYear}-01-01`;
  const ytdTo = `${currentYear}-12-31`;

  let ytdInvoicedExVat = 0;
  let periodInvoicedExVat = 0;

  for (const inv of invoices) {
    const dateStr = toLocalDateStr(inv.issueDate);
    if (dateStr >= ytdFrom && dateStr <= ytdTo) {
      ytdInvoicedExVat += inv.amountExVat;
    }
    if (dateStr >= currentPeriod.from && dateStr <= currentPeriod.to) {
      periodInvoicedExVat += inv.amountExVat;
    }
  }

  const ytdVat = Math.round(ytdInvoicedExVat * VAT_RATE * 100) / 100;
  const periodVat = Math.round(periodInvoicedExVat * VAT_RATE * 100) / 100;

  return {
    periodKind: vatPeriod,
    ytdInvoicedExVat: Math.round(ytdInvoicedExVat * 100) / 100,
    ytdVat,
    currentPeriod: {
      label: currentPeriod.label,
      from: currentPeriod.from,
      to: currentPeriod.to,
      invoicedExVat: Math.round(periodInvoicedExVat * 100) / 100,
      vat: periodVat,
    },
    nextDeadline: {
      label: formatDanishDate(deadline),
      daysUntil,
      periodLabel: currentPeriod.label,
    },
    recommendedSavings: periodVat,
  };
}
