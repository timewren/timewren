// src/app/dashboard/reports/_components/ReportPreview.tsx
"use client";
import { CalendarRange, Coffee, FileBarChart, Table2 } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatCurrency, formatPause, toLocalDateStr } from "@/lib/format";
import { showsBudgetColumn } from "@/lib/reports/column-keys";
import {
  entryColumns,
  formatReportCell,
  formatReportHours,
  REPORT_COLUMNS,
} from "@/lib/reports/columns";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { resolveDateRange } from "@/lib/reports/date-range";
import type { ReportData } from "./report-types";

/** Nøgler til labels i "Grupperet (…)"-badgen. */
const GROUPING_LABEL_KEYS: Partial<
  Record<ReportTemplateConfig["grouping"], string>
> = {
  client: "preview.byClient",
  clientProject: "preview.byClientProject",
  project: "preview.byProject",
  tag: "preview.byTag",
  task: "preview.byTask",
  member: "preview.byMember",
  day: "preview.byDay",
  week: "preview.byWeek",
  month: "preview.byMonth",
};

const BUDGET_TEXT = {
  green: "text-green-700 dark:text-green-400",
  yellow: "text-amber-700 dark:text-amber-400",
  red: "text-red-700 dark:text-red-400",
} as const;

function fmtHours(h: number, locale: string): string {
  return h.toLocaleString(locale, { maximumFractionDigits: 1 });
}

interface Props {
  config: ReportTemplateConfig;
  data: ReportData | undefined;
  isLoading: boolean;
  isCustomIncomplete: boolean;
}

export function ReportPreview({
  config,
  data,
  isLoading,
  isCustomIncomplete,
}: Props) {
  const t = useTranslations("reports");
  const locale = toIntlLocale(useLocale());
  if (isLoading) {
    return (
      <div
        role="status"
        aria-label={t("preview.loadingAria")}
        className="flex h-64 items-center justify-center rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex flex-col items-center gap-3">
          <InlineSpinner className="h-6 w-6" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("preview.loading")}
          </p>
        </div>
      </div>
    );
  }

  if (isCustomIncomplete) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200/80 bg-white py-16 text-center dark:border-gray-800 dark:bg-gray-900">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          <CalendarRange className="h-6 w-6 text-gray-400 dark:text-gray-500" />
        </div>
        <p className="mt-4 text-base font-medium text-gray-700 dark:text-gray-200">
          {t("preview.chooseDates")}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("preview.chooseDatesHint")}
        </p>
      </div>
    );
  }

  if (!data) return null;

  const { entries, aggregates } = data;
  // Gruppe-niveau kolonner (budget) hører kun til i gruppe-tabellen
  const detailColumns = entryColumns(config.columns);
  const showBudget = showsBudgetColumn(config);

  // Drill-down (#191): every number links to the Tid page with the report's
  // period and filters applied, so "hvilke poster ligger bag de 42 timer?"
  // is one click instead of manually rebuilding the filter.
  let periodQuery: string | null = null;
  try {
    const { start, end } = resolveDateRange(config.filters);
    periodQuery = `range=custom&from=${toLocalDateStr(start)}&to=${toLocalDateStr(end)}`;
  } catch {
    // Incomplete custom range — links degrade to plain text
    periodQuery = null;
  }
  const singleClient =
    config.filters.clientIds.length === 1
      ? `&client=${config.filters.clientIds[0]}`
      : "";
  const singleProject =
    config.filters.projectIds.length === 1
      ? `&project=${config.filters.projectIds[0]}`
      : "";
  const timeHref = (extra = "") =>
    periodQuery
      ? `/dashboard/time?${periodQuery}${singleClient}${singleProject}${extra}`
      : undefined;
  const groupHref = (key: string) => {
    if (!periodQuery || key === "_none") return undefined;
    if (config.grouping === "client") {
      return `/dashboard/time?${periodQuery}&client=${key}`;
    }
    if (config.grouping === "project") {
      return `/dashboard/time?${periodQuery}${singleClient}&project=${key}`;
    }
    if (config.grouping === "clientProject") {
      const [clientId, projectId] = key.split(":");
      if (!projectId) return undefined;
      return `/dashboard/time?${periodQuery}${clientId ? `&client=${clientId}` : ""}&project=${projectId}`;
    }
    return undefined;
  };

  if (entries.length === 0 && aggregates.groups.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-gray-200/80 bg-white py-16 text-center dark:border-gray-800 dark:bg-gray-900">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-gray-100 dark:bg-gray-800">
          <FileBarChart className="h-6 w-6 text-gray-400 dark:text-gray-500" />
        </div>
        <p className="mt-4 text-base font-medium text-gray-700 dark:text-gray-200">
          {t("preview.empty")}
        </p>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          {t("preview.emptyHint")}
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Summary cards */}
      {config.branding.showSummaryCards && (
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200/80 dark:bg-gray-800 md:grid-cols-4">
          <SummaryCard
            label={t("preview.cardTotalHours")}
            value={formatReportHours(aggregates.summary.totalHours)}
            href={timeHref()}
          />
          <SummaryCard
            label={t("preview.cardRevenue")}
            value={formatCurrency(aggregates.summary.totalRevenue)}
            href={timeHref()}
          />
          <SummaryCard
            label={t("preview.cardInvoiced")}
            value={formatReportHours(aggregates.summary.billedHours)}
            href={timeHref("&billed=billed")}
          />
          <SummaryCard
            label={t("preview.cardNotInvoiced")}
            value={formatCurrency(aggregates.summary.unbilledRevenue)}
            href={timeHref("&billed=unbilled")}
          />
        </div>
      )}

      {/* Grouped data table */}
      {aggregates.groups.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 border-b border-gray-200/80 px-4 py-3 dark:border-gray-800">
            <Table2 className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("preview.groupedBy", {
                group: GROUPING_LABEL_KEYS[config.grouping]
                  ? t(GROUPING_LABEL_KEYS[config.grouping] as string)
                  : config.grouping,
              })}
            </span>
          </div>
          {aggregates.groupingNote && (
            <p className="border-b border-gray-200/80 bg-amber-50/60 px-4 py-2 text-xs text-amber-800 dark:border-gray-800 dark:bg-amber-900/20 dark:text-amber-300">
              {aggregates.groupingNote}
            </p>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-200/80 bg-gray-50/50 text-left dark:border-gray-800 dark:bg-gray-900/50">
                <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("preview.colGroup")}
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("preview.colHours")}
                </th>
                <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("preview.colRevenue")}
                </th>
                {showBudget && (
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("preview.colMonthBudget")}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {aggregates.groups.map((g) => (
                <tr
                  key={g.key}
                  className="border-t border-gray-100 transition-colors hover:bg-gray-50/50 dark:border-gray-800/50 dark:hover:bg-gray-800/30"
                >
                  <td className="px-4 py-2.5 font-medium text-gray-900 dark:text-gray-100">
                    {groupHref(g.key) ? (
                      <Link
                        href={groupHref(g.key) as string}
                        className="hover:text-brand-600 hover:underline dark:hover:text-brand-400"
                        title={t("preview.seeEntries")}
                      >
                        {g.label}
                      </Link>
                    ) : (
                      g.label
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {t("preview.hoursValue", { hours: g.hours.toFixed(2) })}
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                    {formatCurrency(g.revenue)}
                  </td>
                  {showBudget && (
                    <td
                      className={`px-4 py-2.5 text-right tabular-nums ${
                        g.budget
                          ? BUDGET_TEXT[g.budget.healthStatus]
                          : "text-gray-400 dark:text-gray-600"
                      }`}
                      title={
                        g.budget
                          ? t("preview.budgetTitle", { month: g.budget.month })
                          : t("preview.budgetTitleNone")
                      }
                    >
                      {g.budget
                        ? t("preview.budgetCell", {
                            used: fmtHours(g.budget.usedHours, locale),
                            budget: fmtHours(g.budget.budgetHours, locale),
                            pct: g.budget.percentage,
                          })
                        : "–"}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pauser (#593) */}
      {config.branding.showPauses && aggregates.pauses && (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center gap-2 border-b border-gray-200/80 px-4 py-3 dark:border-gray-800">
            <Coffee className="h-4 w-4 text-gray-400 dark:text-gray-500" />
            <span className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
              {t("preview.pauses")}
            </span>
            <span className="ml-auto text-sm font-medium tabular-nums text-gray-900 dark:text-gray-100">
              {t("preview.pausesTotal", {
                duration: formatPause(aggregates.pauses.totalGapMinutes),
              })}
            </span>
          </div>
          <p className="border-b border-gray-200/80 px-4 py-2 text-xs text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {t("preview.pausesExplain", {
              minutes: aggregates.pauses.minGapMinutes,
            })}
            {aggregates.pauses.untimedEntries > 0 && (
              <>
                {" "}
                <strong className="text-amber-700 dark:text-amber-400">
                  {t("preview.untimed", {
                    count: aggregates.pauses.untimedEntries,
                  })}
                </strong>
              </>
            )}
          </p>
          {aggregates.pauses.byDay.length === 0 ? (
            <p className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
              {t("preview.noPauses")}
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/80 bg-gray-50/50 text-left dark:border-gray-800 dark:bg-gray-900/50">
                  <th className="px-4 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("preview.pauseDate")}
                  </th>
                  <th className="px-4 py-2.5 text-right text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                    {t("preview.pauseColumn")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {aggregates.pauses.byDay.map((d) => (
                  <tr
                    key={d.date}
                    className="border-t border-gray-100 dark:border-gray-800/50"
                  >
                    <td className="px-4 py-2.5 text-gray-900 dark:text-gray-200">
                      {formatReportCell(d.date, "date")}
                    </td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-700 dark:text-gray-300">
                      {formatPause(d.gapMinutes)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {aggregates.pauses.byUser.length > 1 && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200/80 px-4 py-2.5 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400">
              {aggregates.pauses.byUser.map((u) => (
                <span key={u.userId}>
                  {u.name}: {formatPause(u.gapMinutes)}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Detailed entries table */}
      {config.branding.showEntriesTable && entries.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200/80 bg-gray-50/50 text-left dark:border-gray-800 dark:bg-gray-900/50">
                  {detailColumns.map((k) => (
                    <th
                      key={k}
                      className="px-3 py-2.5 text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400"
                    >
                      {t(`columns.${k}`)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {entries.slice(0, 100).map((e, i) => (
                  <tr
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    key={`${e.date.toString()}-${e.hours}-${e.description ?? ""}-${i}`}
                    className="border-t border-gray-100 transition-colors hover:bg-gray-50/50 dark:border-gray-800/50 dark:hover:bg-gray-800/30"
                  >
                    {detailColumns.map((k) => {
                      const v = REPORT_COLUMNS[k].getValue(e);
                      const isNumeric =
                        k === "hours" ||
                        k === "roundedHours" ||
                        k === "rate" ||
                        k === "value";
                      return (
                        <td
                          key={k}
                          className={`px-3 py-2.5 ${
                            isNumeric
                              ? "whitespace-nowrap text-right tabular-nums text-gray-700 dark:text-gray-300"
                              : "text-gray-900 dark:text-gray-200"
                          }`}
                        >
                          {formatReportCell(v, REPORT_COLUMNS[k].format)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {entries.length > 100 && (
            <div className="border-t border-gray-200/80 px-4 py-2.5 dark:border-gray-800">
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {t("preview.showing100", { total: entries.length })}{" "}
                {entries.length > 10_000
                  ? t("preview.narrowPeriod")
                  : t("preview.downloadFull")}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  href,
}: {
  label: string;
  value: string;
  href?: string;
}) {
  const t = useTranslations("reports");
  const inner = (
    <>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
        {label}
      </p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
        {value}
      </p>
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        title={t("preview.seeEntries")}
        className="block bg-white px-4 py-3 transition-colors hover:bg-brand-50/60 dark:bg-gray-900 dark:hover:bg-gray-800/60"
      >
        {inner}
      </Link>
    );
  }

  return <div className="bg-white px-4 py-3 dark:bg-gray-900">{inner}</div>;
}
