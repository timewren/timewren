import { tr } from "@/i18n/server-text";
/**
 * Kør en enterprise-rapport (E4, #462): config → periode → datasæt →
 * aggregering → tabel. Delt af tRPC (run/export) og cron (planlagt mail).
 */
import { sharedT } from "@/i18n/shared-text";
import type { db as dbClient } from "@/lib/db";
import { MAX_PERIOD_DAYS, periodLengthDays, validatePeriod } from "../period";
import type { VisibleScope } from "../scope";
import { getVacationOrgSettings } from "../vacation";
import {
  type AggregateResult,
  aggregateDataset,
  filterEmployees,
} from "./aggregate";
import type { EnterpriseColumnKey } from "./columns";
import {
  type EnterpriseReportConfig,
  REPORT_TYPE_DEFINITIONS,
  resolveReportPeriod,
} from "./config";
import {
  buildEnterpriseDataset,
  loadTimeDetails,
  type TimeDetailRow,
} from "./dataset";
import { buildReportTable, type ReportTable } from "./render";

type Db = typeof dbClient;

export type ReportSummary = {
  employeeCount: number;
  hours: number;
  normHours: number;
  flexDelta: number;
  absenceDays: number;
  sickDays: number;
  sickPct: number | null;
  longTermSickCount: number;
};

export type EnterpriseReportResult = {
  reportType: EnterpriseReportConfig["reportType"];
  title: string;
  period: { from: string; to: string };
  table: ReportTable;
  summary: ReportSummary;
  details: { rows: TimeDetailRow[]; truncated: boolean } | null;
  breakPolicy: string;
  generatedAt: string;
};

export class ReportPeriodError extends Error {}

export function reportTitle(config: EnterpriseReportConfig): string {
  return (
    config.title?.trim() ||
    sharedT("enterpriseReports", `types.${config.reportType}.label`)
  );
}

/** Fjern kolonner der kræver en dimension som ikke er valgt — undgår tomme kolonner. */
export function effectiveColumns(
  config: EnterpriseReportConfig,
): EnterpriseColumnKey[] {
  const dims = new Set<string>(config.dimensions);
  return config.columns.filter((c) => {
    switch (c) {
      case "employee":
      case "department":
      case "project":
      case "activityType":
      case "absenceType":
      case "day":
      case "week":
      case "month":
      case "vacationYear":
        return dims.has(c);
      case "email":
      case "employeeNumber":
      case "employmentType":
      case "weeklyHours":
      case "dailyNorm":
        return dims.has("employee");
      case "payrollCode":
        return dims.has("activityType");
      default:
        return true;
    }
  });
}

export async function runEnterpriseReport(
  db: Db,
  params: {
    orgId: string;
    scope: VisibleScope;
    config: EnterpriseReportConfig;
    now?: Date;
    today?: string;
  },
): Promise<EnterpriseReportResult> {
  const { orgId, scope, config } = params;
  // Ferieåret følger org'ens indstilling (#461): kalenderår eller 1/9–31/8
  const { yearStartMonth: vacationYearStartMonth } =
    await getVacationOrgSettings(db, orgId);
  const period = resolveReportPeriod(
    config.period,
    params.now,
    vacationYearStartMonth,
  );
  const periodError = validatePeriod(period.from, period.to);
  if (periodError) throw new ReportPeriodError(periodError);
  if (periodLengthDays(period.from, period.to) > MAX_PERIOD_DAYS) {
    throw new ReportPeriodError(
      await tr("serverErrors", "enterprise.periodMaxDaysAsync", {
        days: MAX_PERIOD_DAYS,
      }),
    );
  }

  const dataset = await buildEnterpriseDataset(db, {
    orgId,
    from: period.from,
    to: period.to,
    scope,
    today: params.today,
    vacationYearStartMonth,
  });

  const aggOptions = {
    filters: config.filters,
    vacationYearStartMonth,
  };
  const result: AggregateResult = aggregateDataset(dataset, {
    ...aggOptions,
    dimensions: config.dimensions,
  });
  const subtotals =
    config.dimensions.length >= 2
      ? aggregateDataset(dataset, {
          ...aggOptions,
          dimensions: config.dimensions.slice(0, 1),
        })
      : null;

  const table = buildReportTable({
    result,
    subtotals,
    columns: effectiveColumns(config),
    dimensions: config.dimensions,
  });

  const t = result.totals.values;
  const summary: ReportSummary = {
    employeeCount: result.employeeCount,
    hours: Number(t.hours ?? 0),
    normHours: Number(t.normHours ?? 0),
    flexDelta: Number(t.flexDelta ?? 0),
    absenceDays: Number(t.absenceDays ?? 0),
    sickDays: Number(t.sickDays ?? 0),
    sickPct: typeof t.sickPct === "number" ? t.sickPct : null,
    longTermSickCount: Number(t.longTermSickCount ?? 0),
  };

  let details: EnterpriseReportResult["details"] = null;
  if (
    config.includeDetails &&
    REPORT_TYPE_DEFINITIONS[config.reportType].supportsDetails
  ) {
    details = await loadTimeDetails(db, {
      orgId,
      from: period.from,
      to: period.to,
      employees: filterEmployees(dataset.employees, config.filters),
      includeRejected: config.filters.includeRejected,
      onlyApproved: config.filters.onlyApproved,
      projectIds: config.filters.projectIds,
      activityTypeIds: config.filters.activityTypeIds,
    });
  }

  return {
    reportType: config.reportType,
    title: reportTitle(config),
    period,
    table,
    summary,
    details,
    breakPolicy: dataset.breakPolicy,
    generatedAt: new Date().toISOString(),
  };
}
