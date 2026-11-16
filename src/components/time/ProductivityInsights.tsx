"use client";

import {
  BarChart3,
  Calendar,
  Flame,
  Lightbulb,
  Sparkles,
  Sun,
  TrendingDown,
  TrendingUp,
  Zap,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useMemo } from "react";
import { toLocalDateStr } from "@/lib/format";
import { weekStartDateStr } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

interface HourlyData {
  hour: number;
  totalHours: number;
  entryCount: number;
}

interface DailyData {
  weekday: number;
  weekdayName: string;
  totalHours: number;
  avgHours: number;
  entryCount: number;
}

interface Insight {
  id: string;
  type: "peak" | "trend" | "recommendation" | "streak";
  icon: typeof Flame;
  iconColor: string;
  title: string;
  value?: string;
  description: string;
}

export function ProductivityInsights() {
  const t = useTranslations("time");
  const getWeekdayName = useCallback(
    (dayIndex: number): string => t(`insights.weekday.${dayIndex}`),
    [t],
  );
  const formatHours = useCallback(
    (hours: number): string => {
      const h = Math.floor(hours);
      const m = Math.round((hours - h) * 60);
      if (h === 0) return t("insights.fmtM", { m });
      if (m === 0) return t("insights.fmtH", { h });
      return t("insights.fmtHM", { h, m });
    },
    [t],
  );
  // Fetch time entries for the last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const { data: entriesData, isLoading } = trpc.time.list.useQuery({
    startDate: toLocalDateStr(thirtyDaysAgo),
    limit: 100,
  });

  // Analyze productivity patterns
  const analysis = useMemo(() => {
    if (!entriesData?.entries || entriesData.entries.length < 5) {
      return null;
    }

    const entries = entriesData.entries;

    // Analyze by hour of day (using startTime if available)
    const hourlyData: HourlyData[] = Array.from({ length: 24 }, (_, i) => ({
      hour: i,
      totalHours: 0,
      entryCount: 0,
    }));

    // Analyze by weekday
    const weekdayData: DailyData[] = Array.from({ length: 7 }, (_, i) => ({
      weekday: i,
      weekdayName: getWeekdayName(i),
      totalHours: 0,
      avgHours: 0,
      entryCount: 0,
    }));

    // Track unique days for averaging
    const uniqueDaysByWeekday: Record<number, Set<string>> = {};
    for (let i = 0; i < 7; i++) {
      uniqueDaysByWeekday[i] = new Set();
    }

    // Calculate streak
    const sortedDates = entries
      .map((e) => toLocalDateStr(new Date(e.date)))
      .filter((d, i, arr) => arr.indexOf(d) === i)
      .sort((a, b) => b.localeCompare(a)); // Most recent first

    let currentStreak = 0;
    const today = new Date();
    for (let i = 0; i < 30; i++) {
      const checkDate = new Date(today);
      checkDate.setDate(checkDate.getDate() - i);
      const checkDateStr = toLocalDateStr(checkDate);

      // Skip weekends for streak calculation (optional)
      const dayOfWeek = checkDate.getDay();
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        continue; // Skip weekends
      }

      if (sortedDates.includes(checkDateStr)) {
        currentStreak++;
      } else if (i > 0) {
        break;
      }
    }

    // Process entries
    for (const entry of entries) {
      const entryDate = new Date(entry.date);
      const weekday = entryDate.getDay();
      const dateStr = toLocalDateStr(entryDate);
      const hours = parseFloat(entry.hours || "0");

      // Weekday analysis
      weekdayData[weekday].totalHours += hours;
      weekdayData[weekday].entryCount++;
      uniqueDaysByWeekday[weekday].add(dateStr);

      // Hourly analysis (if startTime is available)
      if (entry.startTime) {
        const startHour = new Date(entry.startTime).getHours();
        hourlyData[startHour].totalHours += hours;
        hourlyData[startHour].entryCount++;
      }
    }

    // Calculate averages for weekdays
    for (let i = 0; i < 7; i++) {
      const uniqueDays = uniqueDaysByWeekday[i].size;
      if (uniqueDays > 0) {
        weekdayData[i].avgHours = weekdayData[i].totalHours / uniqueDays;
      }
    }

    // Find peak hours (top 3 hours with most activity)
    const peakHours = [...hourlyData]
      .filter((h) => h.entryCount > 0)
      .sort((a, b) => b.totalHours - a.totalHours)
      .slice(0, 3);

    // Find most productive day
    const mostProductiveDay = [...weekdayData]
      .filter((d) => d.entryCount > 0)
      .sort((a, b) => b.avgHours - a.avgHours)[0];

    // Find least productive day (for contrast)
    const workdayData = weekdayData.filter(
      (d) => d.weekday >= 1 && d.weekday <= 5,
    );
    const leastProductiveDay = [...workdayData]
      .filter((d) => d.entryCount > 0)
      .sort((a, b) => a.avgHours - b.avgHours)[0];

    // Calculate weekly average
    const totalHours = entries.reduce(
      (sum, e) => sum + parseFloat(e.hours || "0"),
      0,
    );
    const weeksSpanned = Math.max(1, Math.ceil(entries.length / 7));
    const weeklyAverage = totalHours / weeksSpanned;

    // Calculate this week's hours (ISO-uge: mandag–søndag)
    const startOfWeek = weekStartDateStr(toLocalDateStr(new Date()));

    const thisWeekHours = entries
      .filter((e) => toLocalDateStr(new Date(e.date)) >= startOfWeek)
      .reduce((sum, e) => sum + parseFloat(e.hours || "0"), 0);

    const weeklyTrend = thisWeekHours > weeklyAverage * 0.8 ? "up" : "down";

    return {
      hourlyData,
      weekdayData,
      peakHours,
      mostProductiveDay,
      leastProductiveDay,
      totalHours,
      weeklyAverage,
      thisWeekHours,
      weeklyTrend,
      currentStreak,
      entriesCount: entries.length,
    };
  }, [entriesData, getWeekdayName]);

  // Generate insights
  const insights = useMemo<Insight[]>(() => {
    if (!analysis) return [];

    const result: Insight[] = [];

    // Peak hours insight
    if (analysis.peakHours.length > 0) {
      const peakHour = analysis.peakHours[0];
      const hourLabel = `${peakHour.hour}:00 - ${peakHour.hour + 1}:00`;
      result.push({
        id: "peak-hour",
        type: "peak",
        icon: Zap,
        iconColor: "text-amber-500",
        title: t("insights.peakTitle"),
        value: hourLabel,
        description: t("insights.peakDescription", {
          range: hourLabel,
          hours: formatHours(peakHour.totalHours),
        }),
      });
    }

    // Most productive day insight
    if (analysis.mostProductiveDay) {
      result.push({
        id: "best-day",
        type: "peak",
        icon: Flame,
        iconColor: "text-orange-500",
        title: t("insights.bestDayTitle"),
        value: analysis.mostProductiveDay.weekdayName,
        description: t("insights.bestDayDescription", {
          day: analysis.mostProductiveDay.weekdayName,
          hours: formatHours(analysis.mostProductiveDay.avgHours),
        }),
      });
    }

    // Current streak
    if (analysis.currentStreak > 0) {
      result.push({
        id: "streak",
        type: "streak",
        icon: Calendar,
        iconColor: "text-green-500",
        title: t("insights.streakTitle"),
        value: t("insights.streakValue", { count: analysis.currentStreak }),
        description:
          analysis.currentStreak >= 5
            ? t("insights.streakGood")
            : t("insights.streakTry"),
      });
    }

    // Weekly trend
    result.push({
      id: "weekly-trend",
      type: "trend",
      icon: analysis.weeklyTrend === "up" ? TrendingUp : TrendingDown,
      iconColor:
        analysis.weeklyTrend === "up" ? "text-green-500" : "text-red-500",
      title: t("insights.weekTitle"),
      value: formatHours(analysis.thisWeekHours),
      description:
        analysis.weeklyTrend === "up"
          ? t("insights.weekAbove", {
              hours: formatHours(analysis.weeklyAverage),
            })
          : t("insights.weekBelow", {
              hours: formatHours(analysis.weeklyAverage),
            }),
    });

    // Recommendation based on least productive day
    if (analysis.leastProductiveDay && analysis.mostProductiveDay) {
      if (
        analysis.leastProductiveDay.weekday !==
        analysis.mostProductiveDay.weekday
      ) {
        result.push({
          id: "recommendation",
          type: "recommendation",
          icon: Lightbulb,
          iconColor: "text-purple-500",
          title: t("insights.recommendationTitle"),
          description: t("insights.recommendationDescription", {
            best: analysis.mostProductiveDay.weekdayName,
            least: analysis.leastProductiveDay.weekdayName,
          }),
        });
      }
    }

    return result;
  }, [analysis, t, formatHours]);

  if (isLoading) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="h-5 w-5 text-gray-400 animate-pulse" />
          <span className="text-gray-500">{t("insights.analysing")}</span>
        </div>
      </div>
    );
  }

  if (!analysis || analysis.entriesCount < 5) {
    return null; // Not enough data to show insights
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-brand-500 dark:text-brand-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {t("insights.title")}
          </h3>
        </div>
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {t("insights.basedOn")}
        </span>
      </div>

      {/* Insights Grid */}
      <div className="p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {insights.map((insight) => {
          const Icon = insight.icon;
          return (
            <div
              key={insight.id}
              className="flex items-start gap-3 rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3"
            >
              <div
                className={`flex-shrink-0 flex items-center justify-center h-8 w-8 rounded-full bg-white dark:bg-gray-800 shadow-sm ${insight.iconColor}`}
              >
                <Icon className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-medium text-gray-900 dark:text-white">
                    {insight.title}
                  </span>
                  {insight.value && (
                    <span className="text-sm font-bold text-gray-900 dark:text-white">
                      {insight.value}
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">
                  {insight.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Hourly Activity Bar Chart (simplified) */}
      {analysis.peakHours.length > 0 && (
        <div className="px-4 pb-4">
          <div className="rounded-lg bg-gray-50 dark:bg-gray-700/50 p-3">
            <div className="flex items-center gap-2 mb-3">
              <Sun className="h-4 w-4 text-amber-500" />
              <span className="text-sm font-medium text-gray-900 dark:text-white">
                {t("insights.hoursByDay")}
              </span>
            </div>
            <div className="flex items-end gap-0.5 h-16">
              {analysis.hourlyData.map((hourData) => {
                const maxHours = Math.max(
                  ...analysis.hourlyData.map((h) => h.totalHours),
                );
                const height =
                  maxHours > 0 ? (hourData.totalHours / maxHours) * 100 : 0;
                const isPeak = analysis.peakHours.some(
                  (p) => p.hour === hourData.hour,
                );

                return (
                  <div
                    key={hourData.hour}
                    className="flex-1 flex flex-col items-center"
                    title={`${hourData.hour}:00 - ${formatHours(hourData.totalHours)}`}
                  >
                    <div
                      className={`w-full rounded-t transition-all ${
                        isPeak
                          ? "bg-amber-500"
                          : height > 0
                            ? "bg-brand-400 dark:bg-brand-500"
                            : "bg-gray-200 dark:bg-gray-600"
                      }`}
                      style={{ height: `${Math.max(height, 4)}%` }}
                    />
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-1 text-[10px] text-gray-500">
              <span>00:00</span>
              <span>06:00</span>
              <span>12:00</span>
              <span>18:00</span>
              <span>24:00</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
