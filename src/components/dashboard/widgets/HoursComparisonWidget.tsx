import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { formatTime } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function HoursComparisonWidget() {
  const t = useTranslations("dashboard.widgets.hoursComparison");
  const { data: comparison } = trpc.time.weeklyComparison.useQuery();

  if (!comparison) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const isPositive = comparison.difference >= 0;
  const hasData =
    comparison.currentWeek.hours > 0 || comparison.lastWeek.hours > 0;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/time"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("details")}
        </Link>
      }
    >
      {!hasData ? (
        <div className="flex items-center justify-center h-full">
          <p className="text-sm text-gray-500 dark:text-gray-500">
            {t("none")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Current vs Last Week */}
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t("thisWeek")}
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatTime(comparison.currentWeek.hours)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {t("format")}
              </p>
            </div>

            <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
              <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                {t("lastWeek")}
              </p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatTime(comparison.lastWeek.hours)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                {t("format")}
              </p>
            </div>
          </div>

          {/* Difference Indicator */}
          <div
            className={`rounded-lg border p-4 ${
              isPositive
                ? "border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20"
                : "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20"
            }`}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                {isPositive ? (
                  <ArrowUp className="h-5 w-5 text-green-600 dark:text-green-400" />
                ) : (
                  <ArrowDown className="h-5 w-5 text-red-600 dark:text-red-400" />
                )}
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">
                    {isPositive ? t("increase") : t("decrease")}
                  </p>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    {t("vsLastWeek")}
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p
                  className={`text-2xl font-bold ${
                    isPositive
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {isPositive ? "+" : "-"}
                  {formatTime(Math.abs(comparison.difference))}
                </p>
                <p
                  className={`text-sm font-medium ${
                    isPositive
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {isPositive ? "+" : ""}
                  {comparison.percentageChange}%
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
