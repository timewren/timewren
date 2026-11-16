/**
 * Pure calculation logic for the "Reel timepris" (profitability) widget.
 *
 * Extracted as pure functions so they can be unit-tested without a database.
 */

export interface TimeEntryForProfitability {
  hours: string; // decimal string, e.g. "2.5"
  isBillable: boolean;
  resolvedRate: number | null; // rate already resolved via rate hierarchy
}

export interface InvoiceForProfitability {
  amount: string; // decimal string
  issueDate: Date;
}

export interface ProfitabilityInput {
  entries: TimeEntryForProfitability[];
  invoicedAmount: number;
}

export interface ProfitabilityResult {
  /** Weighted average rate across all tracked entries. Falls back to user default when no entries. */
  agreedRate: number | null;
  /** sum(invoiced) / sum(billable hours). Null when no billable hours or no invoices. */
  billableAvg: number | null;
  /** sum(invoiced) / sum(ALL hours). Null when no total hours or no invoices. */
  realRate: number | null;
  /** (realRate - agreedRate) / agreedRate * 100. Null if either rate is null. */
  deltaPercent: number | null;
  totalHours: number;
  billableHours: number;
  invoicedAmount: number;
  hasData: boolean;
}

/**
 * Compute profitability metrics from a set of time entries and invoiced amount.
 *
 * Business decisions:
 * - "Aftalt timepris" uses ALL time entries (billable + non-billable) weighted by hours,
 *   because non-billable time was still planned at some intended rate. If an entry has no
 *   resolved rate we skip it from the weighted sum (shouldn't inflate the average).
 *   If no entries exist at all, falls back to `fallbackRate` (user default rate).
 * - "Reel timepris" divides invoiced amount by ALL hours (total), not just billable.
 *   This is the core insight: admin/transport time dilutes your real rate.
 * - "Fakturerbar gennemsnit" divides invoiced amount by billable hours only.
 */
export function computeProfitability(
  input: ProfitabilityInput,
  fallbackRate: number | null,
): ProfitabilityResult {
  let totalHours = 0;
  let billableHours = 0;
  let weightedRateSum = 0;
  let weightedRateHours = 0;

  for (const entry of input.entries) {
    const hours = Number.parseFloat(entry.hours) || 0;
    if (hours <= 0) continue;

    totalHours += hours;

    if (entry.isBillable) {
      billableHours += hours;
    }

    // Only include entries with a resolved rate in the weighted avg
    if (entry.resolvedRate !== null && entry.resolvedRate > 0) {
      weightedRateSum += entry.resolvedRate * hours;
      weightedRateHours += hours;
    }
  }

  const hasData = totalHours > 0;
  const { invoicedAmount } = input;

  // Agreed rate: weighted average, fall back to user default if no entries
  let agreedRate: number | null;
  if (weightedRateHours > 0) {
    agreedRate = Math.round(weightedRateSum / weightedRateHours);
  } else if (!hasData && fallbackRate !== null && fallbackRate > 0) {
    // No time entries this month → show user's default rate as context
    agreedRate = fallbackRate;
  } else {
    agreedRate = null;
  }

  // Billable avg: invoiced / billable hours
  const billableAvg =
    invoicedAmount > 0 && billableHours > 0
      ? Math.round(invoicedAmount / billableHours)
      : null;

  // Real rate: invoiced / total hours
  const realRate =
    invoicedAmount > 0 && totalHours > 0
      ? Math.round(invoicedAmount / totalHours)
      : null;

  // Delta: how far below (or above) agreed rate is the real rate
  const deltaPercent =
    realRate !== null && agreedRate !== null && agreedRate > 0
      ? Math.round(((realRate - agreedRate) / agreedRate) * 100 * 10) / 10
      : null;

  return {
    agreedRate,
    billableAvg,
    realRate,
    deltaPercent,
    totalHours: Math.round(totalHours * 100) / 100,
    billableHours: Math.round(billableHours * 100) / 100,
    invoicedAmount: Math.round(invoicedAmount),
    hasData,
  };
}
