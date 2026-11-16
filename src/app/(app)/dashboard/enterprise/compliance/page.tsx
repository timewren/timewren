"use client";

import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Info,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { RoleGuard } from "@/components/RoleGuard";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  type ComplianceResult,
  LIMIT_DAILY_REST,
  LIMIT_DAY_SUM,
  LIMIT_WEEKLY_AVERAGE,
  LIMIT_WEEKLY_REST,
} from "@/lib/enterprise/compliance";
import { buildCsv, downloadCsv } from "@/lib/enterprise/csv";
import { trpc } from "@/providers/trpc-provider";

export default function CompliancePage() {
  return (
    <RoleGuard minRole="manager">
      <ComplianceContent />
    </RoleGuard>
  );
}

type ViolationRow = {
  employee: string;
  email: string;
  date: string;
  rule: string;
  severity: "severityWarning" | "severityViolation";
  value: number;
  limit: number;
};

/** Flad liste over overtrædelser/advarsler til tabel og CSV (E11, #469). */
function violationRows(
  employee: string,
  email: string,
  c: ComplianceResult,
  period: { from: string; to: string },
  t: (key: string, values?: Record<string, string>) => string,
): ViolationRow[] {
  if (c.exempt) return [];
  const rows: ViolationRow[] = [];
  if (c.weeklyAverage.status !== "ok") {
    rows.push({
      employee,
      email,
      date: t("compliance.periodRange", { from: period.from, to: period.to }),
      rule: t("compliance.rule48h"),
      severity:
        c.weeklyAverage.status === "violation"
          ? "severityViolation"
          : "severityWarning",
      value: c.weeklyAverage.averageHoursPerWeek,
      limit: LIMIT_WEEKLY_AVERAGE,
    });
  }
  for (const v of c.dailyRestViolations) {
    rows.push({
      employee,
      email,
      date: v.date,
      rule: t("compliance.ruleDailyRest"),
      severity: "severityViolation",
      value: v.restHours,
      limit: LIMIT_DAILY_REST,
    });
  }
  for (const v of c.longDays) {
    rows.push({
      employee,
      email,
      date: v.date,
      rule: t("compliance.daySum", { rule: t("compliance.ruleDailyRest") }),
      severity: "severityViolation",
      value: v.hours,
      limit: LIMIT_DAY_SUM,
    });
  }
  for (const v of c.weeklyRestViolations) {
    rows.push({
      employee,
      email,
      date: t("compliance.weekFrom", { date: v.weekStart }),
      rule: t("compliance.ruleWeeklyRest"),
      severity: "severityViolation",
      value: v.maxConsecutiveRestHours,
      limit: LIMIT_WEEKLY_REST,
    });
  }
  return rows;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function defaultPeriod(months: number): { from: string; to: string } {
  const today = new Date();
  const from = new Date(today.getFullYear(), today.getMonth() - months, 1);
  return { from: toDateStr(from), to: toDateStr(today) };
}

const inputClass =
  "rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100";

function ComplianceContent() {
  const t = useTranslations("enterprise");
  const intlLocale = toIntlLocale(useLocale());
  const [filterViolations, setFilterViolations] = useState(false);
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(
    null,
  );
  const [draft, setDraft] = useState<{ from: string; to: string } | null>(null);
  const { data, isLoading, error } =
    trpc.enterprise.getComplianceOverview.useQuery(period ?? undefined);

  const effectivePeriod = data?.period ?? period ?? defaultPeriod(4);
  const draftValue = draft ?? effectivePeriod;

  const employees = data?.employees ?? [];

  const allViolations = useMemo(
    () =>
      employees.flatMap((e) =>
        violationRows(
          e.profile.user?.name ?? e.profile.userId,
          e.profile.user?.email ?? "",
          e.compliance,
          effectivePeriod,
          t,
        ),
      ),
    [employees, effectivePeriod, t],
  );

  const exportCsv = () => {
    if (allViolations.length === 0) {
      toast.info(t("compliance.noneToExport"));
      return;
    }
    const csv = buildCsv(
      [
        t("compliance.csvEmployee"),
        t("compliance.csvEmail"),
        t("compliance.csvDate"),
        t("compliance.csvRule"),
        t("compliance.csvType"),
        t("compliance.csvValue"),
        t("compliance.csvLimit"),
      ],
      allViolations.map((r) => [
        r.employee,
        r.email,
        r.date,
        r.rule,
        t(`compliance.${r.severity}`),
        r.value,
        r.limit,
      ]),
    );
    downloadCsv(
      `${t("compliance.csvFile")}-${effectivePeriod.from}_${effectivePeriod.to}.csv`,
      csv,
    );
  };

  if (isLoading) {
    return (
      <ModuleGuard module="enterprise">
        <div className="space-y-6">
          <PageHeader
            title={t("compliance.title")}
            description={t("compliance.description")}
          />
          {/* Skeleton cards */}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-lg border border-gray-200 p-6 dark:border-gray-700"
              >
                <div className="h-4 w-20 rounded bg-gray-200 dark:bg-gray-700" />
                <div className="mt-2 h-8 w-12 rounded bg-gray-200 dark:bg-gray-700" />
              </div>
            ))}
          </div>
          {/* Skeleton table rows */}
          <div className="animate-pulse space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-16 rounded-lg bg-gray-100 dark:bg-gray-800"
              />
            ))}
          </div>
        </div>
      </ModuleGuard>
    );
  }

  const countOk = employees.filter(
    (e) => !e.profile.isSelfScheduler && e.compliance.overallStatus === "ok",
  ).length;
  const countWarning = employees.filter(
    (e) =>
      !e.profile.isSelfScheduler && e.compliance.overallStatus === "warning",
  ).length;
  const countViolation = employees.filter(
    (e) =>
      !e.profile.isSelfScheduler && e.compliance.overallStatus === "violation",
  ).length;
  const countExempt = employees.filter((e) => e.profile.isSelfScheduler).length;

  const filteredEmployees = filterViolations
    ? employees.filter(
        (e) =>
          !e.profile.isSelfScheduler && e.compliance.overallStatus !== "ok",
      )
    : employees;

  const statusOrder = { violation: 0, warning: 1, ok: 2 };
  const sorted = [...filteredEmployees].sort((a, b) => {
    if (a.profile.isSelfScheduler && !b.profile.isSelfScheduler) return 1;
    if (!a.profile.isSelfScheduler && b.profile.isSelfScheduler) return -1;
    const aOrder = statusOrder[a.compliance.overallStatus] ?? 2;
    const bOrder = statusOrder[b.compliance.overallStatus] ?? 2;
    return aOrder - bOrder;
  });

  const rules = data?.settings.rules;
  const ruleModeLabel = (mode: "off" | "warn" | "block") =>
    mode === "off"
      ? t("compliance.modeOff")
      : mode === "warn"
        ? t("compliance.modeWarn")
        : t("compliance.modeBlock");

  return (
    <ModuleGuard module="enterprise">
      <div className="space-y-6">
        <PageHeader
          title={t("compliance.title")}
          description={t("compliance.description")}
        />

        {error && (
          <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
            {error.message}
          </div>
        )}

        {/* Periode + eksport (E11, #469) */}
        <div className="flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <label className="text-sm text-gray-700 dark:text-gray-300">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("compliance.from")}
            </span>
            <input
              type="date"
              value={draftValue.from}
              max={draftValue.to}
              onChange={(e) =>
                setDraft({ ...draftValue, from: e.target.value })
              }
              className={inputClass}
            />
          </label>
          <label className="text-sm text-gray-700 dark:text-gray-300">
            <span className="mb-1 block text-xs font-medium text-gray-500">
              {t("compliance.to")}
            </span>
            <input
              type="date"
              value={draftValue.to}
              min={draftValue.from}
              onChange={(e) => setDraft({ ...draftValue, to: e.target.value })}
              className={inputClass}
            />
          </label>
          <button
            type="button"
            onClick={() => {
              if (draft) setPeriod(draft);
            }}
            disabled={!draft}
            className="rounded-md bg-tt-gran px-3 py-1.5 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk disabled:opacity-50"
          >
            {t("compliance.showPeriod")}
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(null);
              setPeriod(null);
            }}
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            {t("compliance.referencePeriod", {
              months: data?.settings.referencePeriodMonths ?? 4,
            })}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={exportCsv}
            className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            <Download className="h-4 w-4" />
            {t("compliance.exportViolations")}
          </button>
        </div>

        {rules && (
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t("compliance.rulesSummary", {
              from: effectivePeriod.from,
              to: effectivePeriod.to,
              rule48h: ruleModeLabel(rules.rule48h),
              dailyRest: ruleModeLabel(rules.dailyRest),
              weeklyRest: ruleModeLabel(rules.weeklyRest),
            })}{" "}
            <Link
              href="/dashboard/enterprise/settings"
              className="text-brand-600 hover:underline dark:text-brand-400"
            >
              {t("compliance.editInSettings")}
            </Link>
          </p>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
          <div className="rounded-lg border border-gray-200 p-6 dark:border-gray-700">
            <p className="text-sm font-medium text-gray-500 dark:text-gray-400">
              {t("compliance.totalEmployees")}
            </p>
            <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-gray-100">
              {employees.length}
            </p>
          </div>
          <div className="rounded-lg border border-green-200 bg-green-50 p-6 dark:border-green-800 dark:bg-green-900/20">
            <p className="text-sm font-medium text-green-700 dark:text-green-400">
              {t("compliance.ok")}
            </p>
            <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-400">
              {countOk}
            </p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-6 dark:border-amber-800 dark:bg-amber-900/20">
            <p className="text-sm font-medium text-amber-700 dark:text-amber-400">
              {t("compliance.warnings")}
            </p>
            <p className="mt-1 text-2xl font-bold text-amber-700 dark:text-amber-400">
              {countWarning}
            </p>
          </div>
          <div className="rounded-lg border border-red-200 bg-red-50 p-6 dark:border-red-800 dark:bg-red-900/20">
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              {t("compliance.violations")}
            </p>
            <p className="mt-1 text-2xl font-bold text-red-700 dark:text-red-400">
              {countViolation}
            </p>
          </div>
          <div className="rounded-lg border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
            <p className="text-sm font-medium text-brand-700 dark:text-brand-400">
              {t("compliance.exempt")}
            </p>
            <p className="mt-1 text-2xl font-bold text-brand-700 dark:text-brand-400">
              {countExempt}
            </p>
          </div>
        </div>

        {/* Filter toggle */}
        <div className="flex items-center gap-2">
          <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={filterViolations}
              onChange={(e) => setFilterViolations(e.target.checked)}
              className="rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500"
            />
            {t("compliance.onlyViolations")}
          </label>
        </div>

        {/* Table */}
        {sorted.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-600">
            <Info className="mx-auto h-12 w-12 text-gray-400" />
            <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-gray-100">
              {filterViolations
                ? t("compliance.noViolationsFound")
                : t("compliance.noEmployees")}
            </h3>
            <p className="mt-2 text-gray-500 dark:text-gray-400">
              {filterViolations
                ? t("compliance.allComply")
                : t("compliance.addEmployees")}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                  <th className="px-4 py-3 text-left text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("compliance.colEmployee")}
                  </th>
                  <th className="hidden px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400 sm:table-cell">
                    {t("compliance.colWeeklyAvg")}
                  </th>
                  <th className="hidden px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400 md:table-cell">
                    {t("compliance.colRest11")}
                  </th>
                  <th className="hidden px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400 lg:table-cell">
                    {t("compliance.colRest24")}
                  </th>
                  <th className="hidden px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400 lg:table-cell">
                    {t("compliance.colAbsenceDays")}
                  </th>
                  <th className="px-4 py-3 text-right text-sm font-medium text-gray-500 dark:text-gray-400">
                    {t("compliance.colStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((employee) => {
                  const { profile, compliance } = employee;
                  const isExempt = profile.isSelfScheduler;
                  const restCount =
                    compliance.dailyRestViolations.length +
                    compliance.longDays.length;

                  return (
                    <tr
                      key={profile.id}
                      className="border-b border-gray-200 last:border-0 hover:bg-gray-50 dark:border-gray-700 dark:hover:bg-gray-700"
                    >
                      <td className="px-4 py-3">
                        <Link
                          href={`/dashboard/enterprise/employees/${profile.id}`}
                          className="font-medium text-gray-900 hover:text-brand-600 dark:text-gray-100 dark:hover:text-brand-400"
                        >
                          {profile.user?.name ?? profile.userId}
                        </Link>
                      </td>
                      <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300 sm:table-cell">
                        {isExempt
                          ? "-"
                          : t("compliance.hoursPerWeekShort", {
                              hours:
                                compliance.weeklyAverage.averageHoursPerWeek.toFixed(
                                  1,
                                ),
                            })}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300 md:table-cell">
                        {isExempt ? "-" : restCount}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300 lg:table-cell">
                        {isExempt
                          ? "-"
                          : compliance.weeklyRestViolations.length}
                      </td>
                      <td className="hidden px-4 py-3 text-right text-sm tabular-nums text-gray-600 dark:text-gray-300 lg:table-cell">
                        {employee.absenceDays}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {isExempt ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
                            <Info className="h-3 w-3" />
                            {t("compliance.statusExempt")}
                          </span>
                        ) : compliance.overallStatus === "ok" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                            <CheckCircle2 className="h-3 w-3" />
                            {t("compliance.ok")}
                          </span>
                        ) : compliance.overallStatus === "warning" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
                            <AlertTriangle className="h-3 w-3" />
                            {t("compliance.severityWarning")}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
                            <XCircle className="h-3 w-3" />
                            {t("compliance.severityViolation")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Overtrædelser pr. medarbejder (E11, #469) */}
        {allViolations.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
              {t("compliance.violationsInPeriod", {
                count: allViolations.length,
              })}
            </h3>
            <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-800/50">
                    <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.colEmployee")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.tblDate")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.tblRule")}
                    </th>
                    <th className="px-4 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.tblType")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.tblValue")}
                    </th>
                    <th className="px-4 py-2 text-right font-medium text-gray-500 dark:text-gray-400">
                      {t("compliance.tblLimit")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {allViolations.map((r) => (
                    <tr
                      key={`${r.email}-${r.date}-${r.rule}`}
                      className="border-b border-gray-200 last:border-0 dark:border-gray-700"
                    >
                      <td className="px-4 py-2 text-gray-900 dark:text-gray-100">
                        {r.employee}
                      </td>
                      <td className="px-4 py-2 tabular-nums text-gray-600 dark:text-gray-300">
                        {r.date}
                      </td>
                      <td className="px-4 py-2 text-gray-600 dark:text-gray-300">
                        {r.rule}
                      </td>
                      <td className="px-4 py-2">
                        <span
                          className={
                            r.severity === "severityViolation"
                              ? "text-red-700 dark:text-red-400"
                              : "text-amber-700 dark:text-amber-400"
                          }
                        >
                          {t(`compliance.${r.severity}`)}
                        </span>
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                        {t("compliance.hoursValue", {
                          value: r.value.toLocaleString(intlLocale, {
                            minimumFractionDigits: 1,
                            maximumFractionDigits: 1,
                          }),
                        })}
                      </td>
                      <td className="px-4 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">
                        {t("compliance.hoursValue", { value: r.limit })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </ModuleGuard>
  );
}
