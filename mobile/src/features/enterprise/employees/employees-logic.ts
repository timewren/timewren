import type { RouterOutputs } from '~/api/app-router';
import { intlLocale } from '~/lib/locale';

export type Employee = RouterOutputs['enterprise']['listMembers'][number];

export type EmployeeRole = 'owner' | 'admin' | 'hr' | 'manager' | 'member';
export type EmploymentType = 'full_time' | 'part_time' | 'hourly' | 'student' | 'temp';

const ROLES: readonly EmployeeRole[] = ['owner', 'admin', 'hr', 'manager', 'member'];
const TYPES: readonly EmploymentType[] = ['full_time', 'part_time', 'hourly', 'student', 'temp'];

/** Ukendte roller/typer falder tilbage til member/full_time, så i18n-nøglen altid findes. */
export function roleKey(role: string | null | undefined): EmployeeRole {
  return ROLES.includes(role as EmployeeRole) ? (role as EmployeeRole) : 'member';
}

export function employmentTypeKey(type: string | null | undefined): EmploymentType {
  return TYPES.includes(type as EmploymentType) ? (type as EmploymentType) : 'full_time';
}

export function filterEmployees(
  employees: readonly Employee[],
  filter: { query: string; departmentId: string | null; includeInactive?: boolean },
): Employee[] {
  const q = filter.query.trim().toLowerCase();
  return employees
    .filter(e => filter.includeInactive || e.isActive)
    .filter(e => !filter.departmentId || e.departmentId === filter.departmentId)
    .filter(e => q === '' || (e.user?.name ?? '').toLowerCase().includes(q) || (e.user?.email ?? '').toLowerCase().includes(q))
    .sort((a, b) => (a.user?.name ?? '').localeCompare(b.user?.name ?? '', intlLocale()));
}

const DAY_LABELS: Record<string, string> = { 1: 'Man', 2: 'Tir', 3: 'Ons', 4: 'Tor', 5: 'Fre', 6: 'Lør', 7: 'Søn' };

/** ["1","2","3"] → "Man, Tir, Ons" */
export function formatWorkingDays(days: unknown): string {
  if (!Array.isArray(days))
    return '—';
  return days.map(d => DAY_LABELS[String(d)] ?? String(d)).join(', ') || '—';
}
