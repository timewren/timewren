"use client";

import { PieChart } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { BRAND_LIGHT } from "@/lib/brand/tokens";
import { formatCurrency, toLocalDateStr } from "@/lib/format";
import type { ReportTemplateConfig } from "@/lib/reports/config-schema";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

const BAR_COLORS = [
  {
    bg: "bg-blue-500 dark:bg-blue-400",
    text: "text-blue-600 dark:text-blue-400",
  },
  {
    bg: "bg-emerald-500 dark:bg-emerald-400",
    text: "text-emerald-600 dark:text-emerald-400",
  },
  {
    bg: "bg-amber-500 dark:bg-amber-400",
    text: "text-amber-600 dark:text-amber-400",
  },
  {
    bg: "bg-purple-500 dark:bg-purple-400",
    text: "text-purple-600 dark:text-purple-400",
  },
  {
    bg: "bg-rose-500 dark:bg-rose-400",
    text: "text-rose-600 dark:text-rose-400",
  },
];

function getMonthLabel(locale: string): string {
  return new Date().toLocaleDateString(toIntlLocale(locale), {
    month: "long",
    year: "numeric",
  });
}

export function RevenueByClientWidget() {
  const t = useTranslations("dashboard.widgets.revenueByClient");
  const locale = useLocale();
  const now = new Date();
  const startDate = toLocalDateStr(
    new Date(now.getFullYear(), now.getMonth(), 1),
  );
  const endDate = toLocalDateStr(
    new Date(now.getFullYear(), now.getMonth() + 1, 0),
  );

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
    grouping: "client",
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

  const { data, isLoading, isError } = trpc.reports.getReportData.useQuery({
    config,
  });

  const { clients, maxRevenue, totalRevenue } = useMemo(() => {
    const groups = data?.aggregates.groups ?? [];
    if (groups.length === 0) {
      return { clients: [], maxRevenue: 0, totalRevenue: 0 };
    }
    const top5 = groups.slice(0, 5);
    return {
      clients: top5.map((g, i) => ({
        clientId: g.key,
        clientName: g.label,
        revenueNum: g.revenue,
        color: BAR_COLORS[i],
      })),
      maxRevenue: Math.max(...top5.map((g) => g.revenue)),
      totalRevenue: top5.reduce((sum, g) => sum + g.revenue, 0),
    };
  }, [data]);

  if (isLoading) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<PieChart className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  return (
    <DashboardWidget
      title={t("title")}
      icon={<PieChart className="h-5 w-5 text-tt-graa" />}
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
        {/* Header with month and total */}
        <div className="flex items-center justify-between mb-3 text-sm">
          <span className="text-gray-500 dark:text-gray-400 capitalize">
            {getMonthLabel(locale)}
          </span>
          <span className="font-semibold text-gray-900 dark:text-white">
            {formatCurrency(totalRevenue)}
          </span>
        </div>

        {isError ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-red-600 dark:text-red-400">
              {t("loadFailed")}
            </p>
          </div>
        ) : clients.length === 0 ? (
          <div className="flex items-center justify-center flex-1">
            <p className="text-sm text-gray-500 dark:text-gray-500">
              {t("none")}
            </p>
          </div>
        ) : (
          <div className="space-y-2.5 flex-1">
            {clients.map((client) => {
              const widthPct =
                maxRevenue > 0 ? (client.revenueNum / maxRevenue) * 100 : 0;
              return (
                <div key={client.clientId}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-gray-700 dark:text-gray-300 truncate max-w-[60%]">
                      {client.clientName}
                    </span>
                    <span className="text-xs font-medium text-gray-900 dark:text-white">
                      {formatCurrency(client.revenueNum)}
                    </span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
                    <div
                      className={`h-full rounded-full ${client.color.bg} transition-all duration-500`}
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </DashboardWidget>
  );
}
