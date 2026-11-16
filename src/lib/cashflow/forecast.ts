/**
 * Pure cashflow forecast logic — no DB, no side-effects, fully testable.
 *
 * Predicts incoming money for the next 4 weeks (30 days) based on:
 * 1. Outstanding invoices (sent / overdue) — either confirmed dueDate or
 *    estimated via historical payment lag.
 * 2. Klippekort genkøb prognose — if a client's active prepaid package will
 *    likely run out within 30 days, estimate a renewal at the price of the
 *    most recent package. Only predicted when >= 3 historical packages exist.
 */

export interface CashflowInvoiceBreakdown {
  invoiceId: string;
  invoiceNumber: string;
  amount: number;
  confidence: "confirmed" | "estimated";
}

export interface CashflowPrepaidRenewal {
  clientId: string;
  clientName: string;
  estimatedAmount: number;
}

export interface CashflowWeek {
  weekNumber: number; // ISO week number
  from: Date;
  to: Date;
  expectedAmount: number;
  overdueAmount: number; // Sub-portion of expectedAmount that is already overdue
  breakdown: {
    invoices: CashflowInvoiceBreakdown[];
    prepaidRenewals: CashflowPrepaidRenewal[];
  };
}

export interface CashflowForecast {
  weeks: CashflowWeek[];
  totalExpected: number;
  totalOverdue: number;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface ForecastInvoice {
  id: string;
  invoiceNumber: string;
  amount: number;
  dueDate: Date | null;
  clientId: string;
}

export interface ForecastPrepaidPackage {
  clientId: string;
  clientName: string;
  currentSaldoHours: number;
  historicalPackages: Array<{
    priceExVat: number;
    purchasedAt: Date;
    hoursAtPurchase: number;
  }>;
  avgHoursPerMonth: number;
}

export interface ForecastParams {
  now: Date;
  outstandingInvoices: ForecastInvoice[];
  /**
   * Per-client historical payment lag in days (sent → paid).
   * Key: clientId, value: array of observed lags.
   */
  clientPaymentHistory: Map<string, number[]>;
  /**
   * User-wide fallback average payment lag in days.
   * Used when a client has fewer than MIN_PAYMENT_HISTORY_SAMPLES samples.
   */
  userAvgPaymentDays: number;
  activePrepaid: ForecastPrepaidPackage[];
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum historical samples required before using per-client payment average */
const MIN_PAYMENT_HISTORY_SAMPLES = 3;

/** Minimum historical klippekort required before predicting a renewal */
const MIN_PREPAID_HISTORY = 3;

/** Number of weeks in the forecast window */
const FORECAST_WEEKS = 4;

/** Fallback payment lag (days) when no history exists at all */
const FALLBACK_PAYMENT_DAYS = 14;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns ISO week number for a given date (ISO 8601, Monday-based). */
function isoWeekNumber(date: Date): number {
  const d = new Date(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
  );
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
}

/** Returns a Date at local midnight for the given date. */
function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Add `days` calendar days to a Date. */
function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

/** Numeric average of an array; returns undefined for empty arrays. */
function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Build a set of 4 non-overlapping week windows starting from `weekStart`
 * (Monday of the current week containing `now`).
 *
 * Week 1: Mon–Sun of current week (clipped so `from` is never before `now`).
 * Weeks 2-4: following Monday–Sunday spans.
 */
function buildWeekWindows(
  now: Date,
  weekStartMonday: Date,
): Array<{ from: Date; to: Date }> {
  const windows: Array<{ from: Date; to: Date }> = [];
  for (let i = 0; i < FORECAST_WEEKS; i++) {
    const from = addDays(weekStartMonday, i * 7);
    const to = addDays(from, 6);
    // Set to end-of-day for week boundaries
    to.setHours(23, 59, 59, 999);
    windows.push({ from: i === 0 ? startOfDay(now) : from, to });
  }
  return windows;
}

/**
 * Returns the Monday of the ISO week that contains `d`.
 */
function getIsoMondayOfWeek(d: Date): Date {
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, …
  const diff = day === 0 ? -6 : 1 - day; // Days to subtract to get to Monday
  const monday = new Date(d);
  monday.setDate(d.getDate() + diff);
  return startOfDay(monday);
}

// ---------------------------------------------------------------------------
// Main forecast function
// ---------------------------------------------------------------------------

export function forecastCashflow(params: ForecastParams): CashflowForecast {
  const {
    now,
    outstandingInvoices,
    clientPaymentHistory,
    userAvgPaymentDays,
    activePrepaid,
  } = params;

  const today = startOfDay(now);
  const forecastEnd = addDays(today, 30);
  const weekStart = getIsoMondayOfWeek(today);
  const windows = buildWeekWindows(today, weekStart);

  // Initialise week buckets
  const weeks: CashflowWeek[] = windows.map(({ from, to }) => ({
    weekNumber: isoWeekNumber(from),
    from,
    to,
    expectedAmount: 0,
    overdueAmount: 0,
    breakdown: { invoices: [], prepaidRenewals: [] },
  }));

  // Helper: find the week bucket for a given payment date
  function findWeek(paymentDate: Date): CashflowWeek | null {
    for (const week of weeks) {
      if (paymentDate >= week.from && paymentDate <= week.to) {
        return week;
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------------
  // 1. Invoice forecasting
  // ---------------------------------------------------------------------------
  for (const inv of outstandingInvoices) {
    const isOverdue = inv.dueDate !== null && inv.dueDate < today;
    let paymentDate: Date;
    let confidence: "confirmed" | "estimated";

    if (inv.dueDate !== null) {
      // Use the due date directly.
      // Overdue invoices are bucketed into week 1 ("nu") regardless.
      paymentDate = isOverdue ? today : inv.dueDate;
      confidence = "confirmed";
    } else {
      // No due date — estimate via payment history
      const clientSamples = clientPaymentHistory.get(inv.clientId) ?? [];
      let lagDays: number;

      if (clientSamples.length >= MIN_PAYMENT_HISTORY_SAMPLES) {
        lagDays = average(clientSamples) ?? userAvgPaymentDays;
      } else if (userAvgPaymentDays > 0) {
        lagDays = userAvgPaymentDays;
      } else {
        lagDays = FALLBACK_PAYMENT_DAYS;
      }

      paymentDate = addDays(today, Math.round(lagDays));
      confidence = "estimated";
    }

    // Only include if payment date falls within the 30-day window
    if (paymentDate > forecastEnd) continue;

    const week = findWeek(paymentDate);
    if (!week) continue;

    week.expectedAmount += inv.amount;
    if (isOverdue) {
      week.overdueAmount += inv.amount;
    }
    week.breakdown.invoices.push({
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: inv.amount,
      confidence,
    });
  }

  // ---------------------------------------------------------------------------
  // 2. Klippekort renewal predictions
  // ---------------------------------------------------------------------------
  for (const pkg of activePrepaid) {
    // Require at least MIN_PREPAID_HISTORY historical packages
    if (pkg.historicalPackages.length < MIN_PREPAID_HISTORY) continue;

    // Skip if current burn rate is unknown or zero
    if (pkg.avgHoursPerMonth <= 0) continue;

    // Estimate days until the current saldo runs out
    const hoursPerDay = pkg.avgHoursPerMonth / 30;
    const daysUntilEmpty = pkg.currentSaldoHours / hoursPerDay;

    // Only predict renewal if it falls within the 30-day window
    if (daysUntilEmpty > 30) continue;

    const renewalDate = addDays(today, Math.round(daysUntilEmpty));
    const clampedRenewalDate = renewalDate < today ? today : renewalDate;

    // Only predict if it lands within our forecast window
    if (clampedRenewalDate > forecastEnd) continue;

    const week = findWeek(clampedRenewalDate);
    if (!week) continue;

    // Use price of the most recent historical package as estimated renewal price
    const sortedByDate = [...pkg.historicalPackages].sort(
      (a, b) => b.purchasedAt.getTime() - a.purchasedAt.getTime(),
    );
    const estimatedAmount = sortedByDate[0].priceExVat;

    week.expectedAmount += estimatedAmount;
    week.breakdown.prepaidRenewals.push({
      clientId: pkg.clientId,
      clientName: pkg.clientName,
      estimatedAmount,
    });
  }

  // ---------------------------------------------------------------------------
  // Totals
  // ---------------------------------------------------------------------------
  const totalExpected = weeks.reduce((sum, w) => sum + w.expectedAmount, 0);
  const totalOverdue = weeks.reduce((sum, w) => sum + w.overdueAmount, 0);

  return { weeks, totalExpected, totalOverdue };
}
