"use client";

import { ArrowDown, ArrowUp, CalendarRange } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { formatCurrency, toLocalDateStr } from "@/lib/format";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

function formatMonthLabel(dateStr: string, locale: string): string {
  const date = new Date(dateStr);
  return date.toLocaleDateString(toIntlLocale(locale), { month: "short" });
}

function calcChange(
  current: number,
  previous: number,
): { pct: string; positive: boolean } | null {
  if (previous === 0) return null;
  const change = ((current - previous) / previous) * 100;
  return { pct: Math.abs(change).toFixed(0), positive: change >= 0 };
}

const BASE_CONFIG: Omit<ReportTemplateConfig, "filters"> = {
  audience: "internal",
  grouping: "none",
  sortBy: "date",
  sortDir: "desc",
  columns: [
    "date",
    "client",
    "project",
    "description",
    "hours",
    "rate",
    "value",
    "billed",
    "prepaid",
    "prepaidPackage",
    "fromTemplate",
  ],
  branding: {
    showLogo: false,
    primaryColor: BRAND_LIGHT.gran,
    title: "Tidsrapport",
    showSummaryCards: true,
    showClientBreakdown: true,
    showProjectBreakdown: false,
    showEntriesTable: true,
    showPauses: false,
  },
  rounding: "useUserSetting",
};

const BASE_FILTERS = {
  clientIds: [] as string[],
  projectIds: [] as string[],
  memberIds: [] as string[],
  tagIds: [] as string[],
  billable: "all" as const,
  billedStatus: "all" as const,
  includePrepaid: true,
};

export function MonthComparisonWidget() {
  const t = useTranslations("dashboard.widgets.monthComparison");
  const locale = useLocale();
  const now = new Date();
  const startDate = toLocalDateStr(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const endDate = toLocalDateStr(
    new Date(now.getFullYear(), now.getMonth() + 1, 0),
  );

  // Previous period: same duration, ending the day before current start
  const currentStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const currentEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const duration = currentEnd.getTime() - currentStart.getTime();
  const dayMs = 86400000;
  const prevEnd = new Date(currentStart.getTime() - dayMs);
  const prevStart = new Date(currentStart.getTime() - duration - dayMs);
  const prevStartStr = toLocalDateStr(prevStart);
  const prevEndStr = toLocalDateStr(prevEnd);

  const { data: currentData, isLoading: currentLoading } =
    trpc.reports.getReportData.useQuery({
      config: {
        ...BASE_CONFIG,
        filters: {
          ...BASE_FILTERS,
          dateRange: "custom",
          customStart: startDate,
          customEnd: endDate,
        },
      },
    });

  const { data: previousData, isLoading: previousLoading } =
    trpc.reports.getReportData.useQuery({
      config: {
        ...BASE_CONFIG,
        filters: {
          ...BASE_FILTERS,
          dateRange: "custom",
          customStart: prevStartStr,
          customEnd: prevEndStr,
        },
      },
    });

  const isLoading = currentLoading || previousLoading;

  if (isLoading || !currentData || !previousData) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<CalendarRange className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const currentLabel = formatMonthLabel(startDate, locale);
  const previousLabel = formatMonthLabel(prevStartStr, locale);

  const metrics = [
    {
      label: t("hours"),
      current: currentData.aggregates.summary.totalHours,
      previous: previousData.aggregates.summary.totalHours,
      format: (v: number) => t("hoursValue", { value: v.toFixed(1) }),
    },
    {
      label: t("revenue"),
      current: currentData.aggregates.summary.totalRevenue,
      previous: previousData.aggregates.summary.totalRevenue,
      format: (v: number) => formatCurrency(v),
    },
    {
      label: t("entries"),
      current: currentData.aggregates.summary.entriesCount,
      previous: previousData.aggregates.summary.entriesCount,
      format: (v: number) => String(v),
    },
  ];

  return (
    <DashboardWidget
      title={t("title")}
      icon={<CalendarRange className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/reports"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeReports")}
        </Link>
      }
    >
      <div className="flex flex-col h-full">
        {/* Period badges */}
        <div className="flex items-center gap-2 mb-3">
          <span className="inline-flex items-center rounded-full bg-brand-100 dark:bg-tt-gran-lys px-2.5 py-0.5 text-xs font-medium text-brand-700 dark:text-brand-300 capitalize">
            {currentLabel}
          </span>
          <span className="text-xs text-gray-400 dark:text-gray-500">
            {t("vs")}
          </span>
          <span className="inline-flex items-center rounded-full bg-gray-100 dark:bg-gray-800 px-2.5 py-0.5 text-xs font-medium text-gray-600 dark:text-gray-400 capitalize">
            {previousLabel}
          </span>
        </div>

        {/* Metric rows */}
        <div className="space-y-3 flex-1">
          {metrics.map((metric) => {
            const change = calcChange(metric.current, metric.previous);
            return (
              <div key={metric.label}>
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-xs text-gray-500 dark:text-gray-400">
                    {metric.label}
                  </span>
                  {change ? (
                    <span
                      className={`inline-flex items-center gap-0.5 text-xs font-medium ${
                        change.positive
                          ? "text-green-600 dark:text-green-400"
                          : "text-red-600 dark:text-red-400"
                      }`}
                    >
                      {change.positive ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      )}
                      {change.pct}%
                    </span>
                  ) : (
                    <span className="text-xs text-gray-400 dark:text-gray-500">
                      –
                    </span>
                  )}
                </div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-bold text-gray-900 dark:text-white">
                    {metric.format(metric.current)}
                  </span>
                  <span className="text-xs text-gray-400 dark:text-gray-500">
                    {t("vsValue", { value: metric.format(metric.previous) })}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </DashboardWidget>
  );
}
