import { tr } from "@/i18n/server-text";
/**
 * Kør lønmapping for en periode (E5, #463): datasæt → mapping-motor →
 * totaler pr. medarbejder × lønart. Delt af preview og eksport i tRPC.
 */
import type { db as dbClient } from "@/lib/db";
import { MAX_PERIOD_DAYS, periodLengthDays, validatePeriod } from "../period";
import {
  absenceFactPasses,
  filterEmployees,
  timeFactPasses,
} from "../reporting/aggregate";
import type { ReportFilters } from "../reporting/config";
import { buildEnterpriseDataset } from "../reporting/dataset";
import { ReportPeriodError } from "../reporting/run";
import type { VisibleScope } from "../scope";
import {
  mapFactsToWageLines,
  summarizeUnmapped,
  summarizeWageLines,
  type WageLineTotal,
} from "./mapping";

type Db = typeof dbClient;

export type PayrollMappingRun = {
  period: { from: string; to: string };
  totals: WageLineTotal[];
  unmapped: ReturnType<typeof summarizeUnmapped>;
  /** Medarbejdere med linjer men uden medarbejdernummer */
  missingEmployeeNumbers: Array<{ userId: string; name: string }>;
  employeeCount: number;
  hasConfig: boolean;
};

export async function runPayrollMapping(
  db: Db,
  params: {
    orgId: string;
    scope: VisibleScope;
    from: string;
    to: string;
    filters: ReportFilters;
    today?: string;
  },
): Promise<PayrollMappingRun> {
  const { orgId, scope, from, to, filters } = params;
  const periodError = validatePeriod(from, to);
  if (periodError) throw new ReportPeriodError(periodError);
  if (periodLengthDays(from, to) > MAX_PERIOD_DAYS) {
    throw new ReportPeriodError(
      await tr("serverErrors", "enterprise.periodMaxDaysAsync", {
        days: MAX_PERIOD_DAYS,
      }),
    );
  }
  const dataset = await buildEnterpriseDataset(db, {
    orgId,
    from,
    to,
    scope,
    today: params.today,
  });
  const employees = filterEmployees(dataset.employees, filters);
  const inScope = new Set(employees.map((e) => e.userId));
  const mapped = mapFactsToWageLines({
    config: dataset.payroll,
    calendar: dataset.calendar,
    payrollHolidaysByUser: dataset.payrollHolidaysByUser,
    time: dataset.time.filter(
      (f) => inScope.has(f.userId) && timeFactPasses(f, filters),
    ),
    absence: dataset.absence.filter(
      (f) =>
        inScope.has(f.userId) &&
        absenceFactPasses(f, filters) &&
        f.date >= from &&
        f.date <= to,
    ),
    overtime: dataset.overtime.filter((f) => inScope.has(f.userId)),
    flex: dataset.flex.filter((f) => inScope.has(f.userId)),
    checkIns: dataset.checkIns.filter((f) => inScope.has(f.userId)),
    absenceTypes: dataset.absenceTypes,
  });
  const totals = summarizeWageLines(mapped.lines, employees);
  const missing = new Map<string, string>();
  for (const t of totals) {
    if (!t.employeeNumber) missing.set(t.userId, t.employeeName);
  }
  return {
    period: { from, to },
    totals,
    unmapped: summarizeUnmapped(mapped.unmapped),
    missingEmployeeNumbers: Array.from(missing, ([userId, name]) => ({
      userId,
      name,
    })),
    employeeCount: employees.length,
    hasConfig:
      dataset.payroll.wageTypes.some((w) => !w.isArchived) ||
      dataset.activityTypes.some((a) => a.payrollCode) ||
      dataset.absenceTypes.some((a) => a.payrollCode),
  };
}
