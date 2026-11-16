import type { RouterOutputs } from '~/api/app-router';
import type { StatTone } from '~/components/ui/stat-tile';
import { intlLocale } from '~/lib/locale';

export type ComplianceOverview = RouterOutputs['enterprise']['getComplianceOverview'];
export type ComplianceEmployee = ComplianceOverview['employees'][number];
export type ComplianceResult = RouterOutputs['enterprise']['getEmployeeCompliance'];
export type ComplianceStatus = ComplianceResult['overallStatus'];

const ORDER: Record<ComplianceStatus, number> = { violation: 0, warning: 1, ok: 2 };

export function complianceTone(status: ComplianceStatus | undefined): StatTone {
  switch (status) {
    case 'violation': return 'danger';
    case 'warning': return 'warning';
    case 'ok': return 'success';
    default: return 'default';
  }
}

export type ComplianceSummary = { total: number; ok: number; warning: number; violation: number; exempt: number };

export function summarize(employees: readonly ComplianceEmployee[]): ComplianceSummary {
  const out: ComplianceSummary = { total: employees.length, ok: 0, warning: 0, violation: 0, exempt: 0 };
  for (const e of employees) {
    if (e.compliance.exempt)
      out.exempt++;
    out[e.compliance.overallStatus]++;
  }
  return out;
}

/** Værste først, dernæst navn. */
export function sortByStatus(employees: readonly ComplianceEmployee[]): ComplianceEmployee[] {
  return [...employees].sort((a, b) => {
    const byStatus = ORDER[a.compliance.overallStatus] - ORDER[b.compliance.overallStatus];
    if (byStatus !== 0)
      return byStatus;
    return (a.profile.user?.name ?? '').localeCompare(b.profile.user?.name ?? '', intlLocale());
  });
}

/** Kun medarbejdere med afvigelser (advarsel/overtrædelse). */
export function withIssues(employees: readonly ComplianceEmployee[]): ComplianceEmployee[] {
  return sortByStatus(employees.filter(e => e.compliance.overallStatus !== 'ok'));
}

/** Antal fund pr. regel i et resultat — til korte linjer i listen. */
export function findingCounts(result: Pick<ComplianceResult, 'dailyRestViolations' | 'weeklyRestViolations' | 'longDays' | 'weeklyAverage'>) {
  return {
    dailyRest: result.dailyRestViolations.length,
    weeklyRest: result.weeklyRestViolations.length,
    longDays: result.longDays.length,
    weeklyAverage: result.weeklyAverage.status !== 'ok',
  };
}
