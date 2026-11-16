import type { StatTone } from '~/components/ui/stat-tile';
import { translate } from '~/lib/i18n';

export type ProjectStatus = 'active' | 'completed' | 'on_hold' | 'archived';

export const PROJECT_STATUSES: readonly ProjectStatus[] = ['active', 'on_hold', 'completed', 'archived'];

export type RateSource = 'project' | 'client' | 'global' | 'none';

export type ResolvedRate = {
  rate: number | null;
  source: RateSource;
};

function num(v: string | number | null | undefined): number | null {
  if (v === null || v === undefined || v === '')
    return null;
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return Number.isFinite(n) ? n : null;
}

/** Timepris-hierarki: projekt → kunde → global (web's domæneregel). */
export function resolveRate(input: {
  projectRate?: string | number | null;
  clientRate?: string | number | null;
  globalRate?: string | number | null;
}): ResolvedRate {
  const p = num(input.projectRate);
  if (p !== null)
    return { rate: p, source: 'project' };
  const c = num(input.clientRate);
  if (c !== null)
    return { rate: c, source: 'client' };
  const g = num(input.globalRate);
  if (g !== null)
    return { rate: g, source: 'global' };
  return { rate: null, source: 'none' };
}

export type HealthStatus = 'green' | 'yellow' | 'red';

export type BudgetInfo = {
  /** Estimeret budget i timer (fastpris / timepris) eller null */
  budgetHours: number | null;
  usedHours: number;
  /** 0–100, null uden budget */
  percentage: number | null;
  health: HealthStatus | null;
};

/** Samme regel som web's `healthStatus`: < 75 grøn, < 90 gul, ellers rød. */
export function healthFromPercentage(percentage: number): HealthStatus {
  if (percentage < 75)
    return 'green';
  if (percentage < 90)
    return 'yellow';
  return 'red';
}

export function projectBudget(input: {
  fixedPrice?: string | number | null;
  hourlyRate?: string | number | null;
  usedHours: number;
}): BudgetInfo {
  const fixed = num(input.fixedPrice);
  const rate = num(input.hourlyRate);
  const budgetHours = fixed !== null && rate !== null && rate > 0
    ? Math.round((fixed / rate) * 10) / 10
    : null;
  if (budgetHours === null || budgetHours <= 0)
    return { budgetHours: null, usedHours: input.usedHours, percentage: null, health: null };
  const percentage = Math.round((input.usedHours / budgetHours) * 100);
  return { budgetHours, usedHours: input.usedHours, percentage, health: healthFromPercentage(percentage) };
}

export function healthTone(health: HealthStatus | null | undefined): StatTone {
  switch (health) {
    case 'green': return 'success';
    case 'yellow': return 'warning';
    case 'red': return 'danger';
    default: return 'default';
  }
}

export function statusTone(status: string | null | undefined): StatTone {
  switch (status) {
    case 'active': return 'success';
    case 'on_hold': return 'warning';
    case 'completed': return 'primary';
    case 'archived': return 'default';
    default: return 'default';
  }
}

export function statusLabel(status: string | null | undefined): string {
  switch (status) {
    case 'on_hold': return translate('projects.status_on_hold');
    case 'completed': return translate('projects.status_completed');
    case 'archived': return translate('projects.status_archived');
    default: return translate('projects.status_active');
  }
}
