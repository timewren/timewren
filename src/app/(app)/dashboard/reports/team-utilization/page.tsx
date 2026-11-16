"use client";

import { ArrowLeft, Gauge, Users } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

// Udnyttelsesgrad (#143): billable % pr. medarbejder + team-trend, samt
// belægnings- og dækningsgrad mod arbejdstiden (#704, samme grundlag som
// dækningsgraden #679). Kun owner/admin — samme adgangsmodel som
// team-lønsomhed (#142).

/** "yyyy-MM-dd" → "1. sep. 2026" */
function formatDay(dateStr: string, locale: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function pctColor(n: number | null): string {
  if (n === null) return "text-gray-400";
  if (n < 50) return "text-red-600 dark:text-red-400";
  if (n < 70) return "text-amber-600 dark:text-amber-400";
  return "text-green-600 dark:text-green-400";
}

export default function TeamUtilizationPage() {
  const t = useTranslations("reports");
  const locale = toIntlLocale(useLocale());
  const pctFormatter = new Intl.NumberFormat(locale, {
    maximumFractionDigits: 0,
  });
  const hoursFormatter = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const pct = (n: number | null) =>
    n === null ? "–" : `${pctFormatter.format(n)} %`;
  const hours = (n: number | null) =>
    n === null ? "–" : hoursFormatter.format(n);
  const [months, setMonths] = useState(6);
  const { data, isLoading, error } = trpc.reports.getTeamUtilization.useQuery({
    months,
  });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/reports"
            className="mb-1 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            {t("profitability.back")}
          </Link>
          <PageHeader
            title={t("utilization.title")}
            description={t("utilization.description")}
          />
        </div>
        <select
          value={months}
          onChange={(e) => setMonths(Number(e.target.value))}
          className="rounded-lg border border-gray-300 px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          <option value={3}>{t("utilization.months3")}</option>
          <option value={6}>{t("utilization.months6")}</option>
          <option value={12}>{t("utilization.months12")}</option>
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-12 text-center dark:border-gray-700">
          <Users className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-4 text-lg font-medium text-gray-900 dark:text-white">
            {t("utilization.needsAdmin")}
          </h3>
        </div>
      ) : isLoading || !data ? (
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          {/* Team-trend pr. måned */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-900">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
              <Gauge className="h-4 w-4 text-brand-600 dark:text-brand-400" />
              {t("utilization.trend")}
            </h2>
            <div className="flex items-end gap-2">
              {data.trend.map((m) => (
                <div
                  key={m.month}
                  className="flex flex-1 flex-col items-center gap-1"
                  title={t("utilization.trendTitle", {
                    billable: hours(m.billableHours),
                    total: hours(m.totalHours),
                  })}
                >
                  <span className="text-xs tabular-nums text-gray-600 dark:text-gray-300">
                    {pct(m.billablePct)}
                  </span>
                  <div className="flex h-24 w-full items-end rounded bg-gray-100 dark:bg-gray-800">
                    <div
                      className="w-full rounded bg-brand-500"
                      style={{
                        height: `${Math.min(100, m.billablePct ?? 0)}%`,
                      }}
                    />
                  </div>
                  <span className="text-[10px] text-gray-400">{m.month}</span>
                </div>
              ))}
              {data.trend.length === 0 && (
                <p className="py-6 text-sm text-gray-500">
                  {t("utilization.noTime")}
                </p>
              )}
            </div>
          </div>

          {/* Pr. medarbejder */}
          <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-800">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500 dark:bg-gray-900 dark:text-gray-400">
                <tr>
                  <th className="px-4 py-3">{t("utilization.colMember")}</th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colTotalHours")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colBillable")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colBillableShare")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colWorkTime")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colOccupancy")}
                  </th>
                  <th className="px-4 py-3 text-right">
                    {t("utilization.colCoverage")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-950">
                {data.byMember.map((m) => (
                  <tr key={m.id}>
                    <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                      {m.name}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {hours(m.totalHours)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {hours(m.billableHours)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${pctColor(m.billablePct)}`}
                    >
                      {pct(m.billablePct)}
                    </td>
                    <td
                      className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400"
                      title={
                        m.workTimeSource === "hr"
                          ? t("utilization.workTimeHr")
                          : t("utilization.workTimeSchedule")
                      }
                    >
                      {hours(m.workHours)}
                    </td>
                    <td
                      className={`px-4 py-3 text-right font-semibold tabular-nums ${pctColor(m.utilizationPct)}`}
                    >
                      {pct(m.utilizationPct)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-gray-500 dark:text-gray-400">
                      {pct(m.coveragePct)}
                    </td>
                  </tr>
                ))}
                {data.byMember.length === 0 && (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-6 text-center text-gray-500"
                    >
                      {t("utilization.noTimeLogged")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <p className="text-xs text-gray-400 dark:text-gray-500">
            {t("utilization.footnote", {
              from: formatDay(data.from, locale),
              to: formatDay(data.to, locale),
            })}
          </p>
        </>
      )}
    </div>
  );
}
