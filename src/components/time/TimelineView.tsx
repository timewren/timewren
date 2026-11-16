"use client";

import { Clock, Info } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { toLocalDateStr } from "@/lib/format";

interface TimeEntry {
  id: string;
  description: string | null;
  hours: string | null;
  date: string | Date;
  startTime?: string | Date | null;
  endTime?: string | Date | null;
  project?: {
    name: string;
    client?: { name: string } | null;
  } | null;
  client?: { name: string } | null;
}

interface TimelineViewProps {
  entries: TimeEntry[];
  date: Date;
  workingHoursStart?: number; // e.g., 8 for 8:00
  workingHoursEnd?: number; // e.g., 18 for 18:00
  onEntryClick?: (entry: TimeEntry) => void;
}

// Color palette for different projects
const PROJECT_COLORS = [
  {
    bg: "bg-blue-500",
    light: "bg-blue-100 dark:bg-blue-900/30",
    text: "text-blue-700 dark:text-blue-300",
  },
  {
    bg: "bg-green-500",
    light: "bg-green-100 dark:bg-green-900/30",
    text: "text-green-700 dark:text-green-300",
  },
  {
    bg: "bg-purple-500",
    light: "bg-purple-100 dark:bg-purple-900/30",
    text: "text-purple-700 dark:text-purple-300",
  },
  {
    bg: "bg-orange-500",
    light: "bg-orange-100 dark:bg-orange-900/30",
    text: "text-orange-700 dark:text-orange-300",
  },
  {
    bg: "bg-pink-500",
    light: "bg-pink-100 dark:bg-pink-900/30",
    text: "text-pink-700 dark:text-pink-300",
  },
  {
    bg: "bg-teal-500",
    light: "bg-teal-100 dark:bg-teal-900/30",
    text: "text-teal-700 dark:text-teal-300",
  },
  {
    bg: "bg-indigo-500",
    light: "bg-indigo-100 dark:bg-indigo-900/30",
    text: "text-indigo-700 dark:text-indigo-300",
  },
  {
    bg: "bg-amber-500",
    light: "bg-amber-100 dark:bg-amber-900/30",
    text: "text-amber-700 dark:text-amber-300",
  },
];

function getProjectColor(
  projectId: string | undefined | null,
): (typeof PROJECT_COLORS)[0] {
  if (!projectId) return PROJECT_COLORS[0];
  // Simple hash to get consistent color per project
  let hash = 0;
  for (let i = 0; i < projectId.length; i++) {
    hash = projectId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return PROJECT_COLORS[Math.abs(hash) % PROJECT_COLORS.length];
}

function formatTimeLabel(hour: number): string {
  return `${hour.toString().padStart(2, "0")}:00`;
}

export function TimelineView({
  entries,
  date,
  workingHoursStart = 8,
  workingHoursEnd = 18,
  onEntryClick,
}: TimelineViewProps) {
  const t = useTranslations("time");
  const locale = useLocale();
  // Filter entries that have start/end times for the given date
  const timelineEntries = useMemo(() => {
    const dateStr = toLocalDateStr(date);
    return entries.flatMap((entry) => {
      if (!entry.startTime || !entry.endTime) return [];
      const entryDate = toLocalDateStr(new Date(entry.date));
      return entryDate === dateStr
        ? [{ ...entry, startTime: entry.startTime, endTime: entry.endTime }]
        : [];
    });
  }, [entries, date]);

  // Calculate the time range to display
  const { displayStart, displayEnd, hourLabels } = useMemo(() => {
    let minHour = workingHoursStart;
    let maxHour = workingHoursEnd;

    // Extend range based on actual entries
    for (const entry of timelineEntries) {
      if (entry.startTime) {
        const startHour = new Date(entry.startTime).getHours();
        minHour = Math.min(minHour, startHour);
      }
      if (entry.endTime) {
        const endHour = new Date(entry.endTime).getHours() + 1;
        maxHour = Math.max(maxHour, endHour);
      }
    }

    // Ensure reasonable bounds
    minHour = Math.max(0, minHour);
    maxHour = Math.min(24, maxHour);

    // Generate hour labels
    const labels: number[] = [];
    for (let h = minHour; h <= maxHour; h++) {
      labels.push(h);
    }

    return {
      displayStart: minHour,
      displayEnd: maxHour,
      hourLabels: labels,
    };
  }, [timelineEntries, workingHoursStart, workingHoursEnd]);

  const totalHours = displayEnd - displayStart;

  // Calculate position and width for each entry
  const entryPositions = useMemo(() => {
    return timelineEntries.map((entry) => {
      const start = new Date(entry.startTime);
      const end = new Date(entry.endTime);

      const startMinutes = start.getHours() * 60 + start.getMinutes();
      const endMinutes = end.getHours() * 60 + end.getMinutes();

      const displayStartMinutes = displayStart * 60;
      const displayEndMinutes = displayEnd * 60;
      const totalMinutes = displayEndMinutes - displayStartMinutes;

      const left = ((startMinutes - displayStartMinutes) / totalMinutes) * 100;
      const width = ((endMinutes - startMinutes) / totalMinutes) * 100;

      return {
        entry,
        left: Math.max(0, left),
        width: Math.min(100 - left, width),
        startTime: start.toLocaleTimeString(toIntlLocale(locale), {
          hour: "2-digit",
          minute: "2-digit",
        }),
        endTime: end.toLocaleTimeString(toIntlLocale(locale), {
          hour: "2-digit",
          minute: "2-digit",
        }),
        duration: ((endMinutes - startMinutes) / 60).toFixed(1),
      };
    });
  }, [timelineEntries, displayStart, displayEnd, locale]);

  // Calculate total tracked time
  const totalTrackedHours = useMemo(() => {
    return timelineEntries.reduce((sum, entry) => {
      return sum + parseFloat(entry.hours || "0");
    }, 0);
  }, [timelineEntries]);

  if (timelineEntries.length === 0) {
    return (
      <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-6">
        <div className="flex items-center gap-2 mb-4">
          <Clock className="h-5 w-5 text-gray-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {t("timeline.title")}
          </h3>
        </div>
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Info className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("timeline.empty")}
          </p>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t("timeline.emptyHint")}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4 sm:p-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-brand-500 dark:text-brand-400" />
          <h3 className="font-semibold text-gray-900 dark:text-white">
            {t("timeline.title")}
          </h3>
        </div>
        <div className="text-sm text-gray-600 dark:text-gray-400">
          <span className="font-medium">
            {t("timeline.hoursShort", { value: totalTrackedHours.toFixed(1) })}
          </span>{" "}
          {t("timeline.tracked")}
        </div>
      </div>

      {/* Timeline */}
      <div className="relative">
        {/* Hour labels */}
        <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-2">
          {hourLabels.map((hour) => (
            <span
              key={hour}
              className="w-0 text-center"
              style={{
                marginLeft: hour === displayStart ? 0 : undefined,
                marginRight: hour === displayEnd ? 0 : undefined,
              }}
            >
              {formatTimeLabel(hour)}
            </span>
          ))}
        </div>

        {/* Timeline track */}
        <div className="relative h-16 sm:h-20 bg-gray-100 dark:bg-gray-700 rounded-lg overflow-hidden">
          {/* Hour grid lines */}
          {hourLabels.slice(1).map((hour) => {
            const position = ((hour - displayStart) / totalHours) * 100;
            return (
              <div
                key={hour}
                className="absolute top-0 bottom-0 w-px bg-gray-200 dark:bg-gray-600"
                style={{ left: `${position}%` }}
              />
            );
          })}

          {/* Working hours highlight */}
          <div
            className="absolute top-0 bottom-0 bg-brand-50 dark:bg-tt-gran-lys"
            style={{
              left: `${((workingHoursStart - displayStart) / totalHours) * 100}%`,
              width: `${((workingHoursEnd - workingHoursStart) / totalHours) * 100}%`,
            }}
          />

          {/* Time entries */}
          {entryPositions.map(
            ({ entry, left, width, startTime, endTime, duration }) => {
              const color = getProjectColor(entry.project?.name);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => onEntryClick?.(entry)}
                  className={`absolute top-2 bottom-2 ${color.bg} rounded-md shadow-sm hover:shadow-md transition-shadow cursor-pointer group min-w-[4px]`}
                  style={{
                    left: `${left}%`,
                    width: `${Math.max(width, 1)}%`,
                  }}
                  title={`${entry.project?.name || entry.client?.name || t("timeline.noProject")}\n${startTime} - ${endTime} (${t("timeline.hoursShort", { value: duration })})\n${entry.description || ""}`}
                >
                  {/* Entry content - only show if wide enough */}
                  {width > 8 && (
                    <div className="h-full px-2 py-1 overflow-hidden">
                      <p className="text-xs font-medium text-white truncate">
                        {entry.project?.name || entry.client?.name || "–"}
                      </p>
                      {width > 15 && (
                        <p className="text-xs text-white/80 truncate">
                          {startTime} - {endTime}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Hover tooltip */}
                  <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                    <div className="bg-gray-900 dark:bg-gray-700 text-white text-xs rounded-lg px-3 py-2 shadow-lg whitespace-nowrap max-w-[calc(100vw-2rem)]">
                      <p className="font-medium">
                        {entry.project?.name ||
                          entry.client?.name ||
                          t("timeline.noProject")}
                      </p>
                      <p className="text-gray-300">
                        {startTime} - {endTime} (
                        {t("timeline.hoursShort", { value: duration })})
                      </p>
                      {entry.description && (
                        <p className="text-gray-400 max-w-[200px] truncate">
                          {entry.description}
                        </p>
                      )}
                    </div>
                  </div>
                </button>
              );
            },
          )}

          {/* Current time indicator */}
          {(() => {
            const now = new Date();
            const nowDateStr = toLocalDateStr(now);
            const dateStr = toLocalDateStr(date);
            if (nowDateStr !== dateStr) return null;

            const nowMinutes = now.getHours() * 60 + now.getMinutes();
            const displayStartMinutes = displayStart * 60;
            const displayEndMinutes = displayEnd * 60;

            if (
              nowMinutes < displayStartMinutes ||
              nowMinutes > displayEndMinutes
            ) {
              return null;
            }

            const position =
              ((nowMinutes - displayStartMinutes) /
                (displayEndMinutes - displayStartMinutes)) *
              100;

            return (
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10"
                style={{ left: `${position}%` }}
              >
                <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-2 h-2 rounded-full bg-red-500" />
              </div>
            );
          })()}
        </div>
      </div>

      {/* Legend */}
      {entryPositions.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3">
          {Array.from(
            new Set(
              entryPositions.map(
                ({ entry }) =>
                  entry.project?.name ||
                  entry.client?.name ||
                  t("timeline.other"),
              ),
            ),
          ).map((name) => {
            const entry = entryPositions.find(
              (e) =>
                (e.entry.project?.name ||
                  e.entry.client?.name ||
                  t("timeline.other")) === name,
            )?.entry;
            const color = getProjectColor(entry?.project?.name);
            return (
              <div key={name} className="flex items-center gap-2">
                <div className={`w-3 h-3 rounded ${color.bg}`} />
                <span className="text-xs text-gray-600 dark:text-gray-400">
                  {name}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * Compact timeline for use in headers or summary views
 */
interface CompactTimelineProps {
  entries: TimeEntry[];
  date: Date;
}

export function CompactTimeline({ entries, date }: CompactTimelineProps) {
  const timelineEntries = useMemo(() => {
    const dateStr = toLocalDateStr(date);
    return entries.flatMap((entry) => {
      if (!entry.startTime || !entry.endTime) return [];
      const entryDate = toLocalDateStr(new Date(entry.date));
      return entryDate === dateStr
        ? [{ ...entry, startTime: entry.startTime, endTime: entry.endTime }]
        : [];
    });
  }, [entries, date]);

  if (timelineEntries.length === 0) {
    return (
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className="h-full w-0" />
      </div>
    );
  }

  // Simplified 24-hour view
  const entryBars = timelineEntries.map((entry) => {
    const start = new Date(entry.startTime);
    const end = new Date(entry.endTime);

    const startPercent =
      ((start.getHours() * 60 + start.getMinutes()) / (24 * 60)) * 100;
    const endPercent =
      ((end.getHours() * 60 + end.getMinutes()) / (24 * 60)) * 100;

    return {
      id: entry.id,
      left: startPercent,
      width: endPercent - startPercent,
      color: getProjectColor(entry.project?.name),
    };
  });

  return (
    <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden relative">
      {entryBars.map((bar) => (
        <div
          key={bar.id}
          className={`absolute top-0 bottom-0 ${bar.color.bg}`}
          style={{
            left: `${bar.left}%`,
            width: `${Math.max(bar.width, 0.5)}%`,
          }}
        />
      ))}
    </div>
  );
}
