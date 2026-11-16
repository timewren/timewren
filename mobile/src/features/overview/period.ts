import {
  endOfMonth,
  endOfWeek,
  endOfYear,
  startOfMonth,
  startOfWeek,
  startOfYear,
} from 'date-fns';

export type Period = 'week' | 'month' | 'year';

export const PERIODS: readonly Period[] = ['week', 'month', 'year'];

/** Fra/til for perioden der indeholder `now` (uge = man–søn). Slut er sidste ms i perioden. */
export function periodRange(period: Period, now: Date = new Date()): { from: Date; to: Date } {
  switch (period) {
    case 'week':
      return { from: startOfWeek(now, { weekStartsOn: 1 }), to: endOfWeek(now, { weekStartsOn: 1 }) };
    case 'month':
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case 'year':
      return { from: startOfYear(now), to: endOfYear(now) };
  }
}

/**
 * Anslået omsætning for perioden ud fra profitabilitetstal: fakturerbare timer × vægtet timepris.
 * Returnerer null når der ikke er nogen sats at regne med.
 */
export function estimateRevenue(billableHours: number, agreedRate: number | null): number | null {
  if (agreedRate == null || !Number.isFinite(agreedRate))
    return null;
  return Math.round(Math.max(0, billableHours) * agreedRate);
}

/** Procentdel af timer der er fakturerbare — 0..1, 0 når ingen timer. */
export function billableShare(totalHours: number, billableHours: number): number {
  if (totalHours <= 0)
    return 0;
  return Math.min(1, Math.max(0, billableHours / totalHours));
}
