import type { StatTone } from '~/components/ui/stat-tile';
import type { TxKeyPath } from '~/lib/i18n';

export type OvertimePostType = 'used' | 'payout' | 'adjustment';

export function overtimeTypeKey(type: string): TxKeyPath {
  switch (type) {
    case 'earned': return 'enterprise.overtime.type.earned';
    case 'used': return 'enterprise.overtime.type.used';
    case 'payout': return 'enterprise.overtime.type.payout';
    case 'adjustment': return 'enterprise.overtime.type.adjustment';
    default: return 'enterprise.overtime.type.other';
  }
}

export function overtimeTypeTone(type: string): StatTone {
  switch (type) {
    case 'earned': return 'success';
    case 'used': return 'violet';
    case 'payout': return 'primary';
    case 'adjustment': return 'warning';
    default: return 'default';
  }
}

/**
 * Timer som de sendes til addOvertimeEntry: used/payout skal være positive
 * (backenden bogfører dem negativt), adjustment angives med fortegn.
 * Returnerer null når inputtet ikke er gyldigt.
 */
export function parseOvertimeHours(text: string, type: OvertimePostType): number | null {
  const n = Number.parseFloat(text.trim().replace(',', '.'));
  if (!Number.isFinite(n))
    return null;
  const rounded = Math.round(n * 100) / 100;
  if (rounded === 0 || Math.abs(rounded) > 500)
    return null;
  if (type !== 'adjustment' && rounded < 0)
    return null;
  return rounded;
}
