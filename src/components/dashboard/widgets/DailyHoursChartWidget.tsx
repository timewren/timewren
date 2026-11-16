"use client";

import { BarChart3 } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { toLocalDateStr } from "@/lib/format";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

function generateLast14Days(): string[] {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 13; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    dates.push(toLocalDateStr(d));
  }
  return dates;
}

function isWeekend(dateStr: string): boolean {
  const day = new Date(dateStr).getDay();
  return day === 0 || day === 6;
}

export function DailyHoursChartWidget() {
  const t = useTranslations("dashboard.widgets.dailyHours");
  const dates = useMemo(() => generateLast14Days(), []);
  const startDate = dates[0];
  const endDate = dates[dates.length - 1];

  const config: ReportTemplateConfig = {
    audience: "internal",
    filters: {
      dateRange: "custom",
      customStart: startDate,
      customEnd: endDate,
      clientIds: [],
      projectIds: [],
      memberIds: [],
      tagIds: [],
      billable: "all",
      billedStatus: "all",
      includePrepaid: true,
    },
    grouping: "day",
    sortBy: "date",
    sortDir: "desc",
    columns: ["date", "client", "project", "hours", "value"],
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

  const { data, isLoading } = trpc.reports.getReportData.useQuery({ config });

  const chartData = useMemo(() => {
    const dataMap = new Map<string, number>();
    if (data) {
      for (const g of data.aggregates.groups) {
        dataMap.set(g.key, g.hours);
      }
    }
    return dates.map((date) => ({
      date,
      hours: dataMap.get(date) ?? 0,
      label: t(`day.${new Date(date).getDay()}`),
      weekend: isWeekend(date),
    }));
  }, [data, dates, t]);

  const maxHours = useMemo(
    () => Math.max(...chartData.map((d) => d.hours), 1),
    [chartData],
  );

  const totalHours = useMemo(
    () => chartData.reduce((sum, d) => sum + d.hours, 0),
    [chartData],
  );

  const avgHours = totalHours / 14;

  if (isLoading) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<BarChart3 className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const barWidth = 100 / 14;
  const barPadding = barWidth * 0.2;
  const barActualWidth = barWidth - barPadding * 2;
  const chartHeight = 120;
  const avgY = chartHeight - (avgHours / maxHours) * chartHeight;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<BarChart3 className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/time"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("details")}
        </Link>
      }
    >
      <div className="flex flex-col h-full">
        {/* Summary bar */}
        <div className="flex items-center gap-4 mb-3 text-sm">
          <div>
            <span className="text-gray-500 dark:text-gray-400">{t("avg")}</span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {t("hoursShort", { value: avgHours.toFixed(1) })}
            </span>
          </div>
          <div>
            <span className="text-gray-500 dark:text-gray-400">
              {t("total")}
            </span>
            <span className="font-semibold text-gray-900 dark:text-white">
              {t("hoursShort", { value: totalHours.toFixed(1) })}
            </span>
          </div>
        </div>

        {/* SVG Chart */}
        <div className="flex-1 min-h-0">
          <svg
            aria-hidden="true"
            viewBox={`0 0 100 ${chartHeight + 20}`}
            preserveAspectRatio="none"
            className="w-full h-full"
          >
            {/* Bars */}
            {chartData.map((d, i) => {
              const barH = d.hours > 0 ? (d.hours / maxHours) * chartHeight : 0;
              const x = i * barWidth + barPadding;
              const y = chartHeight - barH;
              return (
                <g key={d.date}>
                  <rect
                    x={x}
                    y={y}
                    width={barActualWidth}
                    height={barH}
                    rx={1}
                    className="fill-brand-500 dark:fill-brand-400"
                    opacity={d.weekend ? 0.6 : 1}
                  />
                  {/* Day label */}
                  <text
                    x={x + barActualWidth / 2}
                    y={chartHeight + 12}
                    textAnchor="middle"
                    className="fill-gray-400 dark:fill-gray-500"
                    style={{ fontSize: "4px" }}
                  >
                    {d.label}
                  </text>
                </g>
              );
            })}

            {/* Average line */}
            {avgHours > 0 && (
              <line
                x1={0}
                y1={avgY}
                x2={100}
                y2={avgY}
                strokeDasharray="2 2"
                className="stroke-amber-500 dark:stroke-amber-400"
                strokeWidth={0.5}
              />
            )}
          </svg>
        </div>
      </div>
    </DashboardWidget>
  );
}
