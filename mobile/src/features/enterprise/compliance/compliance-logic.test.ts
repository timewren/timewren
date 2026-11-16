import type { ComplianceEmployee } from './compliance-logic';
import { complianceTone, findingCounts, sortByStatus, summarize, withIssues } from './compliance-logic';

function emp(name: string, status: 'ok' | 'warning' | 'violation', exempt = false): ComplianceEmployee {
  return {
    profile: { id: name, user: { name } },
    absenceDays: 0,
    compliance: {
      exempt,
      overallStatus: status,
      weeklyAverage: { averageHoursPerWeek: 40, status: status === 'violation' ? 'ok' : status, weeksInPeriod: 4, totalHours: 160 },
      dailyRestViolations: status === 'violation' ? [{ date: '2026-09-01', restHours: 8 }] : [],
      weeklyRestViolations: [],
      longDays: [],
    },
  } as unknown as ComplianceEmployee;
}

describe('compliance-logic', () => {
  it('tone', () => {
    expect(complianceTone('ok')).toBe('success');
    expect(complianceTone('warning')).toBe('warning');
    expect(complianceTone('violation')).toBe('danger');
    expect(complianceTone(undefined)).toBe('default');
  });

  it('summarize tæller status og undtagne', () => {
    const s = summarize([emp('A', 'ok'), emp('B', 'warning'), emp('C', 'violation'), emp('D', 'ok', true)]);
    expect(s).toEqual({ total: 4, ok: 2, warning: 1, violation: 1, exempt: 1 });
  });

  it('sortByStatus og withIssues', () => {
    const list = [emp('Zed', 'ok'), emp('Bo', 'warning'), emp('Anna', 'violation'), emp('Carl', 'violation')];
    expect(sortByStatus(list).map(e => e.profile.user?.name)).toEqual(['Anna', 'Carl', 'Bo', 'Zed']);
    expect(withIssues(list).map(e => e.profile.user?.name)).toEqual(['Anna', 'Carl', 'Bo']);
  });

  it('findingCounts', () => {
    expect(findingCounts(emp('A', 'violation').compliance)).toEqual({ dailyRest: 1, weeklyRest: 0, longDays: 0, weeklyAverage: false });
    expect(findingCounts(emp('A', 'warning').compliance).weeklyAverage).toBe(true);
  });
});
