import { useQuery } from "@tanstack/react-query";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";
import { useEffect, useState } from "react";
import { apiClient } from "../../api/client";
import { useT } from "../../i18n";
import { formatHoursShort } from "../../lib/format-hours";
import { QueryErrorState } from "../../popup/components/QueryErrorState";
import { useAuthStore } from "../../stores/authStore";
import { formatLocalDate } from "../../utils/date";

interface DayData {
  date: string;
  hours: number;
  label: string;
}

export function WeeklyChartWidget() {
  const { t } = useT();
  const selectedOrgId = useAuthStore((s) => s.selectedOrgId);
  const orgsLoaded = useAuthStore((s) => s.orgsLoaded);
  const [weekData, setWeekData] = useState<DayData[]>([]);
  const [previousWeekData, setPreviousWeekData] = useState<DayData[]>([]);

  const {
    data: entriesData,
    isLoading,
    isError,
    error,
    refetch,
  } = useQuery({
    queryKey: ["weeklyEntries", selectedOrgId],
    // Ingen try/catch her: en fejl må ikke caches som en tom uge
    queryFn: async () => {
      // Get entries from the last 14 days (for trend comparison)
      const endDate = new Date();
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 13); // Last 14 days

      return await apiClient.getTimeEntries(
        formatLocalDate(startDate),
        formatLocalDate(endDate),
      );
    },
    staleTime: 1000 * 60 * 5, // 5 minutes
    retry: 1,
    enabled: orgsLoaded,
  });

  useEffect(() => {
    if (!entriesData) return;

    // Initialize last 14 days with 0 hours (7 days current + 7 days previous)
    const last14Days: DayData[] = [];
    const today = new Date();

    for (let i = 13; i >= 0; i--) {
      const date = new Date(today);
      date.setDate(date.getDate() - i);
      date.setHours(0, 0, 0, 0);

      const dayNames = [
        "sun",
        "mon",
        "tue",
        "wed",
        "thu",
        "fri",
        "sat",
      ] as const;
      const label =
        i === 0
          ? t("format.today")
          : t(`format.weekdayShort.${dayNames[date.getDay()]}`);

      last14Days.push({
        date: formatLocalDate(date),
        hours: 0,
        label,
      });
    }

    // Sum hours for each day
    for (const entry of entriesData) {
      // Use the date string directly — don't construct new Date() from date-only
      // string as it parses as UTC midnight, shifting the day in CET
      const entryDate = entry.date.split("T")[0];
      const dayData = last14Days.find((d) => d.date === entryDate);
      if (dayData) {
        dayData.hours += entry.hours;
      }
    }

    // Split into current week (last 7 days) and previous week (days 8-14)
    const currentWeek = last14Days.slice(7, 14); // Last 7 days
    const previousWeek = last14Days.slice(0, 7); // Days 8-14 ago

    setWeekData(currentWeek);
    setPreviousWeekData(previousWeek);
  }, [entriesData, t]);

  if (isLoading || weekData.length === 0) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <QueryErrorState
        error={error}
        fallback={t("newtab.weekly.loadFailed")}
        onRetry={() => refetch()}
        className="h-48"
      />
    );
  }

  const maxHours = Math.max(...weekData.map((d) => d.hours), 8); // At least 8 for scale
  const totalHours = weekData.reduce((sum, d) => sum + d.hours, 0);
  const avgHours = totalHours / 7;

  // Compare to previous week
  const lastWeekTotal = previousWeekData.reduce((sum, d) => sum + d.hours, 0);

  // Calculate percentage change (guard against division by zero)
  const percentChange =
    lastWeekTotal === 0
      ? totalHours > 0
        ? 100
        : 0
      : ((totalHours - lastWeekTotal) / lastWeekTotal) * 100;

  const trend = percentChange > 0 ? "up" : percentChange < 0 ? "down" : "same";

  const formattedPercent = `${percentChange > 0 ? "+" : ""}${Math.round(percentChange)}%`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-[var(--color-text-muted)]">
          {t("newtab.weekly.title")}
        </h2>
        {lastWeekTotal > 0 && (
          <div className="flex items-center gap-1.5 text-sm">
            {trend === "up" && (
              <>
                <TrendingUp size={16} className="text-primary-600" />
                <span className="text-primary-700 font-medium">
                  {formattedPercent}
                </span>
              </>
            )}
            {trend === "down" && (
              <>
                <TrendingDown size={16} className="text-red-500" />
                <span className="text-red-600 font-medium">
                  {formattedPercent}
                </span>
              </>
            )}
            {trend === "same" && (
              <>
                <Minus size={16} className="text-[var(--color-text-muted)]" />
                <span className="text-[var(--color-text-secondary)] font-medium">
                  0%
                </span>
              </>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-[var(--color-surface-sunken)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">
            {t("newtab.weekly.total")}
          </p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatHoursShort(totalHours)}
          </p>
        </div>
        <div className="bg-[var(--color-surface-sunken)] rounded-lg p-3">
          <p className="text-xs text-[var(--color-text-tertiary)] mb-1">
            {t("newtab.weekly.average")}
          </p>
          <p className="text-2xl font-bold text-[var(--color-text-primary)]">
            {formatHoursShort(avgHours)}
          </p>
        </div>
      </div>

      {/* Bar Chart */}
      {/* biome-ignore lint/a11y/useSemanticElements: rollen sidder på en container uden ul/ol-styling (reset), og punkterne er knapper/links; ul/li ville ændre layoutet */}
      <div
        className="space-y-2"
        role="list"
        aria-label={t("newtab.weekly.chartLabel")}
      >
        {weekData.map((day) => {
          const heightPercent = maxHours > 0 ? (day.hours / maxHours) * 100 : 0;
          const isToday = day.label === t("format.today");
          const hoursText = formatHoursShort(day.hours);

          return (
            // biome-ignore lint/a11y/useSemanticElements: rollen sidder på et element, der ikke kan være li uden at ændre layoutet
            <div
              key={day.date}
              className="flex items-center gap-3"
              role="listitem"
              aria-label={t("newtab.weekly.dayHours", {
                day: day.label,
                hours: hoursText,
              })}
            >
              <div className="w-12 text-xs text-[var(--color-text-tertiary)] font-medium">
                {day.label}
              </div>
              <div
                className="flex-1 bg-[var(--color-surface-sunken)] rounded-full h-3 overflow-hidden"
                role="progressbar"
                aria-valuenow={day.hours}
                aria-valuemin={0}
                aria-valuemax={maxHours}
                aria-valuetext={hoursText}
                aria-label={t("newtab.weekly.workHours", { day: day.label })}
              >
                <div
                  className={`h-full rounded-full transition-all duration-500 ${
                    isToday ? "bg-primary-700" : "bg-primary-500"
                  }`}
                  style={{ width: `${heightPercent}%` }}
                />
              </div>
              {/* Værdien står ved siden af bjælken, så den kan læses uanset fyld */}
              <span className="w-14 shrink-0 text-right text-xs font-semibold tabular-nums text-[var(--color-text-secondary)]">
                {day.hours > 0 ? hoursText : ""}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
