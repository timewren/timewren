import { Flame, TrendingUp } from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatTime, toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";
import { DashboardWidget } from "../DashboardWidget";

export function ProductivityHeatmapWidget() {
  const t = useTranslations("dashboard.widgets.productivity");
  const intlLocale = toIntlLocale(useLocale());
  const { data: heatmapData } = trpc.time.productivityHeatmap.useQuery();

  if (!heatmapData) {
    return (
      <DashboardWidget
        title={t("title")}
        icon={<Flame className="h-5 w-5 text-tt-graa" />}
      >
        <div className="flex items-center justify-center h-full">
          <InlineSpinner className="h-8 w-8" />
        </div>
      </DashboardWidget>
    );
  }

  const hasData = heatmapData.heatmapData.length > 0;

  // Create a map of dates to hours for quick lookup
  const dateMap = new Map(
    heatmapData.heatmapData.map((d) => [d.date, d.hours]),
  );

  // Calculate max hours for color scaling
  const maxHours = Math.max(...heatmapData.heatmapData.map((d) => d.hours), 1);

  // Generate the last 56 days (8 weeks)
  const today = new Date();
  const days = [];
  for (let i = 55; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    days.push(date);
  }

  // Group days by week (8 weeks)
  const weeks: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    weeks.push(days.slice(i, i + 7));
  }

  // Get color intensity based on hours
  const getColorIntensity = (hours: number) => {
    if (hours === 0) return "bg-gray-100 dark:bg-gray-800";
    const intensity = hours / maxHours;
    if (intensity < 0.25) return "bg-brand-200 dark:bg-tt-gran-lys";
    if (intensity < 0.5) return "bg-brand-400 dark:bg-brand-700";
    if (intensity < 0.75) return "bg-brand-600 dark:bg-brand-500";
    return "bg-brand-800 dark:bg-brand-400";
  };

  return (
    <DashboardWidget
      title={t("title")}
      icon={<Flame className="h-5 w-5 text-tt-graa" />}
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
            {t("noData")}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Stats row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Current streak */}
            <div className="rounded-lg border border-orange-200 dark:border-orange-800 bg-orange-50 dark:bg-orange-900/20 p-3">
              <div className="flex items-center gap-2 mb-1">
                <Flame className="h-4 w-4 text-orange-600 dark:text-orange-400" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t("streak")}
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {heatmapData.currentStreak}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {heatmapData.currentStreak === 1
                  ? t("streakDay")
                  : t("streakDays")}
              </p>
            </div>

            {/* Weekly average */}
            <div className="rounded-lg border border-brand-200 dark:border-brand-600 bg-brand-50 dark:bg-tt-gran-lys p-3">
              <div className="flex items-center gap-2 mb-1">
                <TrendingUp className="h-4 w-4 text-tt-graa" />
                <span className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {t("weeklyAvg")}
                </span>
              </div>
              <p className="text-2xl font-bold text-gray-900 dark:text-white">
                {formatTime(heatmapData.weeklyAverage)}
              </p>
              <p className="text-xs text-gray-500 dark:text-gray-500">
                {t("perWeek")}
              </p>
            </div>
          </div>

          {/* Heatmap grid */}
          <div className="space-y-1">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t("last8")}
              </span>
              <div className="flex items-center gap-1 text-xs text-gray-500 dark:text-gray-500">
                <span>{t("less")}</span>
                <div className="flex gap-1">
                  <div className="w-3.5 h-3.5 rounded-sm bg-gray-100 dark:bg-gray-800" />
                  <div className="w-3.5 h-3.5 rounded-sm bg-brand-200 dark:bg-tt-gran-lys" />
                  <div className="w-3.5 h-3.5 rounded-sm bg-brand-400 dark:bg-brand-700" />
                  <div className="w-3.5 h-3.5 rounded-sm bg-brand-600 dark:bg-brand-500" />
                  <div className="w-3.5 h-3.5 rounded-sm bg-brand-800 dark:bg-brand-400" />
                </div>
                <span>{t("more")}</span>
              </div>
            </div>

            {/* Calendar grid */}
            <div className="overflow-x-auto">
              <div className="inline-flex gap-1">
                {weeks.map((week, weekIndex) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                  <div key={weekIndex} className="flex flex-col gap-1">
                    {week.map((day, dayIndex) => {
                      const dateStr = toLocalDateStr(day);
                      const hours = dateMap.get(dateStr) || 0;
                      const colorClass = getColorIntensity(hours);

                      return (
                        <div
                          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                          key={dayIndex}
                          className={`w-3.5 h-3.5 rounded-sm ${colorClass} transition-all hover:ring-2 hover:ring-brand-600 dark:hover:ring-brand-400 hover:ring-offset-1 cursor-pointer`}
                          title={`${day.toLocaleDateString(intlLocale, {
                            weekday: "short",
                            day: "numeric",
                            month: "short",
                          })}: ${formatTime(hours)}`}
                        />
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Month labels */}
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-500 mt-1 px-1">
              {[0, 4, 7].map((weekOffset) => {
                const date = new Date(today);
                date.setDate(today.getDate() - (7 - weekOffset) * 7);
                return (
                  <span key={weekOffset}>
                    {date.toLocaleDateString(intlLocale, {
                      month: "short",
                    })}
                  </span>
                );
              })}
            </div>
          </div>

          {/* Motivational message based on streak */}
          {heatmapData.currentStreak > 0 && (
            <div className="rounded-lg bg-brand-50 dark:bg-tt-gran-lys border border-brand-200 dark:border-brand-600 p-3">
              <p className="text-xs text-gray-700 dark:text-gray-300">
                {heatmapData.currentStreak >= 7
                  ? t("msgHigh")
                  : heatmapData.currentStreak >= 3
                    ? t("msgMid")
                    : t("msgLow")}
              </p>
            </div>
          )}
        </div>
      )}
    </DashboardWidget>
  );
}
