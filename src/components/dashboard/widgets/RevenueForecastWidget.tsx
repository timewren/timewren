import { ArrowDown, ArrowUp, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function RevenueForecastWidget() {
  const t = useTranslations("dashboard.widgets.revenueForecast");
  const intlLocale = toIntlLocale(useLocale());
  const { data: forecast } = trpc.time.revenueForecast.useQuery();

  if (!forecast) {
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

  const hasData =
    forecast.monthlyData.length >= 2 &&
    forecast.monthlyData.some((m) => m.revenue > 0);
  const isPositiveTrend = forecast.trendPercentage >= 0;

  // Simple SVG line chart coordinates
  const chartWidth = 300;
  const chartHeight = 100;
  const maxRevenue = Math.max(
    ...forecast.monthlyData.map((m) => m.revenue),
    forecast.forecastRevenue,
    1,
  );

  // Generate path points for the line chart
  const points = forecast.monthlyData.map((month, index) => {
    const x = (index / (forecast.monthlyData.length - 1)) * chartWidth;
    const y = chartHeight - (month.revenue / maxRevenue) * chartHeight;
    return `${x},${y}`;
  });

  // Add forecast point (dashed line)
  const forecastX = chartWidth;
  const forecastY =
    chartHeight - (forecast.forecastRevenue / maxRevenue) * chartHeight;

  return (
    <DashboardWidget
      title={t("title")}
      icon={<TrendingUp className="h-5 w-5 text-tt-graa" />}
      actions={
        <Link
          href="/dashboard/reports"
          className="text-sm font-medium text-brand-600 dark:text-brand-400 hover:underline"
        >
          {t("seeReports")}
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
          {/* Current month forecast */}
          <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-4">
            <div className="flex items-start justify-between">
              <div>
                <p className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  {t("expected")}
                </p>
                <p className="text-2xl font-bold text-gray-900 dark:text-white">
                  {t("amountKr", {
                    amount: forecast.forecastRevenue.toLocaleString(intlLocale),
                  })}
                </p>
                <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
                  {t("basedOn", {
                    day: forecast.dayOfMonth,
                    total: forecast.daysInMonth,
                  })}
                </p>
              </div>
              <div
                className={`flex items-center gap-1 rounded-full px-2 py-1 ${
                  isPositiveTrend
                    ? "bg-green-100 dark:bg-green-900/30"
                    : "bg-red-100 dark:bg-red-900/30"
                }`}
              >
                {isPositiveTrend ? (
                  <ArrowUp className="h-3 w-3 text-green-600 dark:text-green-400" />
                ) : (
                  <ArrowDown className="h-3 w-3 text-red-600 dark:text-red-400" />
                )}
                <span
                  className={`text-xs font-medium ${
                    isPositiveTrend
                      ? "text-green-600 dark:text-green-400"
                      : "text-red-600 dark:text-red-400"
                  }`}
                >
                  {Math.abs(forecast.trendPercentage)}%
                </span>
              </div>
            </div>
          </div>

          {/* Mini line chart */}
          <div className="relative">
            <svg
              aria-hidden="true"
              viewBox={`-5 -5 ${chartWidth + 10} ${chartHeight + 10}`}
              className="w-full h-24"
            >
              {/* Grid lines */}
              <line
                x1="0"
                y1={chartHeight / 2}
                x2={chartWidth}
                y2={chartHeight / 2}
                stroke="currentColor"
                strokeWidth="1"
                strokeDasharray="4 4"
                className="text-gray-200 dark:text-gray-700"
              />

              {/* Historical line */}
              <polyline
                points={points.join(" ")}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinejoin="round"
                className="text-brand-600 dark:text-brand-400"
              />

              {/* Forecast line (dashed) */}
              <line
                x1={points[points.length - 1].split(",")[0]}
                y1={points[points.length - 1].split(",")[1]}
                x2={forecastX}
                y2={forecastY}
                stroke="currentColor"
                strokeWidth="2"
                strokeDasharray="6 4"
                className="text-brand-400 dark:text-brand-400"
              />

              {/* Data points */}
              {forecast.monthlyData.map((_month, index) => {
                const [x, y] = points[index].split(",").map(Number);
                return (
                  <circle
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    key={index}
                    cx={x}
                    cy={y}
                    r="3"
                    fill="currentColor"
                    className="text-brand-600 dark:text-brand-400"
                  />
                );
              })}

              {/* Forecast point */}
              <circle
                cx={forecastX}
                cy={forecastY}
                r="3"
                fill="currentColor"
                className="text-brand-400 dark:text-brand-400"
              />
            </svg>

            {/* X-axis labels */}
            <div className="flex justify-between mt-1 px-1">
              {forecast.monthlyData.slice(-3).map((month, index) => (
                <span
                  // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                  key={index}
                  className="text-xs text-gray-500 dark:text-gray-500"
                >
                  {month.month}
                </span>
              ))}
            </div>
          </div>

          {/* 6-month average */}
          <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-3">
            <p className="text-xs text-gray-600 dark:text-gray-400">
              {t("sixMonthAvg")}
            </p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">
              {t("amountKr", {
                amount: forecast.sixMonthAverage.toLocaleString(intlLocale),
              })}
            </p>
          </div>
        </div>
      )}
    </DashboardWidget>
  );
}
