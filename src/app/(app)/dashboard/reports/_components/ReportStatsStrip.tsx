// src/app/dashboard/reports/_components/ReportStatsStrip.tsx
"use client";
import type { LucideIcon } from "lucide-react";
import { BarChart3, Clock, DollarSign, TrendingUp } from "lucide-react";
import { useTranslations } from "next-intl";
import { formatCurrency } from "@/lib/format";
import { formatReportHours } from "@/lib/reports/columns";
import type { ReportData } from "./report-types";

interface StatDefinition {
  labelKey: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
}

const STAT_DEFINITIONS: StatDefinition[] = [
  {
    labelKey: "stats.totalHours",
    icon: Clock,
    color: "text-tt-graa",
    bgColor: "bg-blue-50 dark:bg-blue-950/40",
  },
  {
    labelKey: "stats.billable",
    icon: BarChart3,
    color: "text-tt-graa",
    bgColor: "bg-emerald-50 dark:bg-emerald-950/40",
  },
  {
    labelKey: "stats.revenue",
    icon: DollarSign,
    color: "text-tt-graa",
    bgColor: "bg-violet-50 dark:bg-violet-950/40",
  },
  {
    labelKey: "stats.avgDaily",
    icon: TrendingUp,
    color: "text-amber-600 dark:text-amber-400",
    bgColor: "bg-amber-50 dark:bg-amber-950/40",
  },
];

interface Props {
  data: ReportData | undefined;
  isLoading: boolean;
}

export function ReportStatsStrip({ data, isLoading }: Props) {
  const t = useTranslations("reports");
  const summary = data?.aggregates?.summary;

  // Calculate average daily hours from entries
  const avgDailyHours = (() => {
    if (!data?.entries || data.entries.length === 0) return 0;
    const uniqueDays = new Set(
      data.entries.map((e) => {
        const d = new Date(e.date);
        return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      }),
    );
    return uniqueDays.size > 0
      ? (summary?.totalHours ?? 0) / uniqueDays.size
      : 0;
  })();

  const values = [
    summary ? formatReportHours(summary.totalHours) : "--",
    summary ? formatReportHours(summary.billedHours) : "--",
    summary ? formatCurrency(summary.totalRevenue) : "--",
    summary ? formatReportHours(avgDailyHours) : "--",
  ];

  return (
    <section
      aria-label={t("stats.label")}
      className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200/80 dark:bg-gray-800 md:grid-cols-4"
    >
      {STAT_DEFINITIONS.map((stat, idx) => {
        const Icon = stat.icon;
        return (
          <div
            key={stat.labelKey}
            className="flex items-center gap-3 bg-white px-4 py-4 dark:bg-gray-900"
          >
            <div
              className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${stat.bgColor}`}
            >
              <Icon className={`h-4 w-4 ${stat.color}`} />
            </div>
            <div className="min-w-0">
              <p className="text-[11px] font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                {t(stat.labelKey)}
              </p>
              {isLoading ? (
                <span className="mt-1 inline-block h-5 w-16 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              ) : (
                <p className="text-lg font-semibold tabular-nums text-gray-900 dark:text-white">
                  {values[idx]}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </section>
  );
}
