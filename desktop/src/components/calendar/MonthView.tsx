import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LoadError } from "@/components/ui/LoadError";
import {
  formatShortDate,
  getMonthGrid,
  isToday,
  toISODateStr,
} from "@/lib/calendar";
import { formatDuration, toLocalDateStr } from "@/lib/format";
import { tauriInvoke } from "@/lib/tauri";
import type { TimeEntry } from "@/lib/types";

interface MonthViewProps {
  date: Date;
  onSelectDay: (date: Date) => void;
}

export function MonthView({ date, onSelectDay }: MonthViewProps) {
  const { t } = useTranslation();
  const dayHeaders = t("calendar.dayHeaders", {
    returnObjects: true,
  }) as string[];
  const [entries, setEntries] = useState<TimeEntry[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const fetchNr = useRef(0);

  const weeks = useMemo(() => getMonthGrid(date), [date]);
  const currentMonth = date.getMonth();

  // Compute date range for fetching (first day of grid to last)
  const gridRange = useMemo(() => {
    const first = weeks[0][0];
    const last = weeks[weeks.length - 1][6];
    return { from: toISODateStr(first), to: toISODateStr(last) };
  }, [weeks]);

  const fetchData = useCallback(() => {
    // Kaldene nummereres, fordi de ikke er samtidige: brugeren kan skifte
    // måned, og et kald for sidste måned kan komme tilbage efter et for denne
    // og tømme den nye måned.
    const kald = ++fetchNr.current;
    const gælder = () => fetchNr.current === kald;

    tauriInvoke<TimeEntry[]>("list_time_entries", {
      from: gridRange.from,
      to: gridRange.to,
    })
      .then((result) => {
        if (!gælder()) return;
        setEntries(result);
        setLoadFailed(false);
      })
      .catch(() => {
        if (!gælder()) return;
        setEntries([]);
        setLoadFailed(true);
      });
  }, [gridRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Group entries by date string for quick lookup
  const entriesByDate = useMemo(() => {
    const map = new Map<
      string,
      {
        totalSeconds: number;
        projects: Map<string, { color: string; seconds: number }>;
      }
    >();

    for (const entry of entries) {
      const dateKey = toLocalDateStr(new Date(entry.start_time));
      const dur = entry.duration ?? 0;
      let dayData = map.get(dateKey);
      if (!dayData) {
        dayData = { totalSeconds: 0, projects: new Map() };
        map.set(dateKey, dayData);
      }
      dayData.totalSeconds += dur;

      const projKey = entry.project_id ?? "__none__";
      const projData = dayData.projects.get(projKey);
      if (projData) {
        projData.seconds += dur;
      } else {
        dayData.projects.set(projKey, {
          color: entry.project_color ?? "#6b7280",
          seconds: dur,
        });
      }
    }

    return map;
  }, [entries]);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Day name headers */}
      <div className="grid shrink-0 grid-cols-7 border-b border-(--color-border)">
        {dayHeaders.map((name) => (
          <div
            key={name}
            className="py-2 text-center text-[11px] font-medium text-(--color-text-muted)"
          >
            {name}
          </div>
        ))}
      </div>

      {/* En fejlet indlæsning erstatter rækkerne: en låst database må ikke
          vise en måned uden én eneste registreret time. */}
      {loadFailed ? (
        <LoadError
          message={t("errors.couldNotLoadEntries")}
          onRetry={fetchData}
          className="flex-1"
        />
      ) : (
        <>
          {/* Week rows */}
          <div className="grid flex-1 auto-rows-fr">
            {weeks.map((week) => (
              <div
                key={toLocalDateStr(week[0])}
                className="grid grid-cols-7 border-b border-(--color-border)/30 last:border-b-0"
              >
                {week.map((day) => {
                  const dateKey = toLocalDateStr(day);
                  const dayData = entriesByDate.get(dateKey);
                  const isCurrentMonth = day.getMonth() === currentMonth;
                  const today = isToday(day);
                  const projectDots = dayData
                    ? Array.from(dayData.projects.entries()).slice(0, 5)
                    : [];

                  return (
                    <button
                      type="button"
                      key={dateKey}
                      aria-label={`${formatShortDate(day)} ${day.getFullYear()}${dayData ? `, ${formatDuration(dayData.totalSeconds)}` : ""}`}
                      onClick={() => onSelectDay(day)}
                      className={`flex flex-col items-center border-l border-(--color-border)/20 px-1 py-1.5 text-left transition-colors first:border-l-0 hover:bg-(--color-border)/20 ${
                        isCurrentMonth ? "" : "opacity-30"
                      } ${today ? "bg-(--color-accent)/5" : ""}`}
                    >
                      <span
                        className={`flex h-6 w-6 items-center justify-center rounded-full text-xs ${
                          today
                            ? "bg-(--color-accent) font-bold text-white"
                            : isCurrentMonth
                              ? "font-medium text-(--color-text)"
                              : "text-(--color-text-muted)"
                        }`}
                      >
                        {day.getDate()}
                      </span>

                      {dayData && (
                        <>
                          <span className="mt-0.5 text-[10px] font-medium text-(--color-text-muted)">
                            {formatDuration(dayData.totalSeconds)}
                          </span>
                          <div className="mt-0.5 flex gap-0.5">
                            {projectDots.map(([projKey, p]) => (
                              <span
                                key={projKey}
                                className="inline-block h-1.5 w-1.5 rounded-full"
                                style={{ backgroundColor: p.color }}
                                title={formatDuration(p.seconds)}
                              />
                            ))}
                          </div>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
