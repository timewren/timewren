import type { StatTone } from '~/components/ui/stat-tile';
import { addDays, addMonths, endOfMonth, endOfWeek, format, startOfMonth, startOfWeek } from 'date-fns';
import { formatHours } from '~/lib/format';
import { dateFnsLocale, formatWords } from '~/lib/locale';

function toNumber(value: number | string | null | undefined): number {
  const n = typeof value === 'string' ? Number.parseFloat(value) : (value ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** +2,5 t / −1 t / ±0 t */
export function formatDelta(delta: number | string | null | undefined): string {
  const safe = Math.round(toNumber(delta) * 100) / 100;
  if (safe === 0)
    return `±${formatHours(0)}`;
  const sign = safe > 0 ? '+' : '−';
  return `${sign}${formatHours(Math.abs(safe))}`;
}

export function deltaTone(delta: number | string | null | undefined): StatTone {
  const n = toNumber(delta);
  if (Math.abs(n) < 0.005)
    return 'default';
  return n > 0 ? 'success' : 'danger';
}

export type FlexRangeMode = 'week' | 'month';

export type FlexRange = { start: string; end: string; label: string };

/** Uge- eller måneds-interval omkring `anchor`, som yyyy-MM-dd + label. */
export function flexRange(anchor: Date, mode: FlexRangeMode): FlexRange {
  if (mode === 'week') {
    const start = startOfWeek(anchor, { weekStartsOn: 1 });
    const end = endOfWeek(anchor, { weekStartsOn: 1 });
    return {
      start: format(start, 'yyyy-MM-dd'),
      end: format(end, 'yyyy-MM-dd'),
      label: `${formatWords().week} ${format(start, 'I')} · ${format(start, 'd/M')}–${format(end, 'd/M')}`,
    };
  }
  const start = startOfMonth(anchor);
  const end = endOfMonth(anchor);
  const month = format(start, 'MMMM yyyy', { locale: dateFnsLocale() });
  return {
    start: format(start, 'yyyy-MM-dd'),
    end: format(end, 'yyyy-MM-dd'),
    label: month.charAt(0).toUpperCase() + month.slice(1),
  };
}

export function shiftAnchor(anchor: Date, mode: FlexRangeMode, direction: -1 | 1): Date {
  return mode === 'week' ? addDays(anchor, 7 * direction) : addMonths(anchor, direction);
}

/** Summen af delta over en liste af poster (strenge fra decimal-kolonner). */
export function sumDelta(entries: ReadonlyArray<{ delta: string | number }>): number {
  const total = entries.reduce((sum, e) => sum + toNumber(e.delta), 0);
  return Math.round(total * 100) / 100;
}
