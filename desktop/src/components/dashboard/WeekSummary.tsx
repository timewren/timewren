import { BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import { formatDuration, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { TimeEntry } from "@/lib/types";

/** Get the Monday of the week containing the given date */
function getMonday(date: Date): Date {
  const d = new Date(date);
  const day = d.getDay();
  // Sunday = 0, Monday = 1, ...
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

/** Get an array of 7 dates (Mon-Sun) starting from the given Monday */
function getWeekDates(monday: Date): Date[] {
  const dates: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    dates.push(d);
  }
  return dates;
}

export function WeekSummary() {
  const { t } = useTranslation();
  // Samme række som kalenderens `calendar.dayHeaders`, som findes i alle sprog.
  // Før lå den her som syv nøgler (`calendar.shortDay*`) der ikke fandtes i nogen
  // locale, med en dansk `FALLBACK_DAYS`-array bagved — så en svensk bruger fik
  // danske ugedage her, men de rigtige i kalenderen.
  const dayHeaders = t("calendar.dayHeaders", {
    returnObjects: true,
  }) as string[];
  // Dagens uge, brugt som nøgle per søjle. Nøglen skal være den samme hver gang
  // komponenten tegnes, også når brugeren skifter sprog.
  const weekDates = getWeekDates(getMonday(new Date()));
  const [thisWeekSeconds, setThisWeekSeconds] = useState<number[]>(
    Array(7).fill(0),
  );
  const [lastWeekTotal, setLastWeekTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const fetchWeekData = useCallback(async () => {
    try {
      const now = new Date();
      const thisMonday = getMonday(now);
      const lastMonday = new Date(thisMonday);
      lastMonday.setDate(lastMonday.getDate() - 7);

      const thisWeekDates = getWeekDates(thisMonday);
      const lastWeekDates = getWeekDates(lastMonday);

      // Fetch this week's entries
      const thisFrom = `${toLocalDateStr(thisWeekDates[0])}T00:00:00`;
      const thisSunday = thisWeekDates[6];
      const thisTo = `${toLocalDateStr(thisSunday)}T23:59:59`;

      // Fetch last week's entries
      const lastFrom = `${toLocalDateStr(lastWeekDates[0])}T00:00:00`;
      const lastSunday = lastWeekDates[6];
      const lastTo = `${toLocalDateStr(lastSunday)}T23:59:59`;

      const [thisEntries, lastEntries] = await Promise.all([
        tauriInvoke<TimeEntry[]>("list_time_entries", {
          from: thisFrom,
          to: thisTo,
        }),
        tauriInvoke<TimeEntry[]>("list_time_entries", {
          from: lastFrom,
          to: lastTo,
        }),
      ]);

      // Group this week by day
      const dailySeconds = Array(7).fill(0) as number[];
      for (const entry of thisEntries) {
        if (entry.is_running) continue;
        const entryDate = new Date(entry.start_time);
        const entryDateStr = toLocalDateStr(entryDate);
        for (let i = 0; i < 7; i++) {
          if (toLocalDateStr(thisWeekDates[i]) === entryDateStr) {
            dailySeconds[i] += entry.duration ?? 0;
            break;
          }
        }
      }
      setThisWeekSeconds(dailySeconds);

      // Calculate last week total
      const lwTotal = lastEntries
        .filter((e) => !e.is_running)
        .reduce((sum, e) => sum + (e.duration ?? 0), 0);
      setLastWeekTotal(lwTotal);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load week summary:", err);
      // Uden denne viste oversigten en graf med syv nuller — altså at brugeren
      // ikke havde arbejdet noget i denne uge. Det er ikke det samme som at
      // ugen ikke kunne hentes, og det er den besked brugeren faktisk læser.
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchWeekData();
  }, [fetchWeekData]);

  const thisWeekTotal = thisWeekSeconds.reduce((a, b) => a + b, 0);
  const diff = thisWeekTotal - lastWeekTotal;
  const maxSeconds = Math.max(...thisWeekSeconds, 1);

  // Get today's day-of-week index (0 = Mon, 6 = Sun)
  const today = new Date();
  const todayDow = today.getDay();
  const todayIndex = todayDow === 0 ? 6 : todayDow - 1;

  if (loading) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.weekSummary")}
          </h3>
        </div>
        <div className="flex items-center justify-center py-6">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-(--color-border) border-t-(--color-accent)" />
        </div>
      </div>
    );
  }

  if (loadFailed) {
    return (
      <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
        <div className="flex items-center gap-2 mb-3">
          <BarChart3 size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.weekSummary")}
          </h3>
        </div>
        <LoadError
          message={t("dashboard.weekSummaryLoadFailed")}
          onRetry={() => {
            setLoading(true);
            fetchWeekData();
          }}
          className="py-4"
        />
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-(--color-border) bg-(--color-surface) p-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <BarChart3 size={16} className="text-(--color-accent)" />
          <h3 className="text-sm font-semibold text-(--color-text)">
            {t("dashboard.weekSummary")}
          </h3>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm font-bold text-(--color-text)">
            {formatDuration(thisWeekTotal)}
          </span>
          {diff !== 0 && (
            <span
              className={`flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] font-medium ${
                diff > 0
                  ? "bg-emerald-500/15 text-emerald-400"
                  : "bg-red-500/15 text-red-400"
              }`}
            >
              {diff > 0 ? <TrendingUp size={10} /> : <TrendingDown size={10} />}
              {diff > 0 ? "+" : ""}
              {formatDuration(Math.abs(diff))}
            </span>
          )}
        </div>
      </div>

      {/* Bar chart */}
      <div className="flex items-end gap-1.5 h-24">
        {thisWeekSeconds.map((seconds, i) => {
          const heightPercent =
            maxSeconds > 0 ? (seconds / maxSeconds) * 100 : 0;
          const isToday = i === todayIndex;

          // Kalenderens overskrifter: mandag først, som `getWeekDates` lægger dem.
          const dayLabel = dayHeaders[i] ?? "";

          return (
            <div
              key={toLocalDateStr(weekDates[i])}
              className="flex flex-1 flex-col items-center gap-1"
            >
              {/* Bar */}
              <div className="relative w-full flex items-end justify-center h-[72px]">
                <div
                  className={`w-full max-w-[32px] rounded-t transition-all ${
                    isToday
                      ? "bg-(--color-accent)"
                      : seconds > 0
                        ? "bg-(--color-accent)/40"
                        : "bg-(--color-border)/40"
                  }`}
                  style={{
                    height: `${Math.max(heightPercent, seconds > 0 ? 8 : 2)}%`,
                  }}
                  title={formatDuration(seconds)}
                />
              </div>
              {/* Day label */}
              <span
                className={`text-[10px] ${
                  isToday
                    ? "font-bold text-(--color-accent)"
                    : "text-(--color-text-muted)"
                }`}
              >
                {dayLabel}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
