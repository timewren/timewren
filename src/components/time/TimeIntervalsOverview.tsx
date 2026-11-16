"use client";

import { Calendar, ChevronDown, ChevronRight, Clock } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
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

interface TimeIntervalsOverviewProps {
  entries: TimeEntry[];
  title?: string;
  showProject?: boolean;
  maxDates?: number;
}

interface GroupedEntry {
  date: string;
  dateFormatted: string;
  weekday: string;
  totalHours: number;
  entries: Array<{
    id: string;
    description: string | null;
    hours: number;
    startTime: string | null;
    endTime: string | null;
    hasTimeRange: boolean;
    projectName?: string | null;
    clientName?: string | null;
  }>;
}

function formatTimeRange(start: string | null, end: string | null): string {
  if (!start || !end) return "";
  return `${start} - ${end}`;
}

function clock(d: Date): string {
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export function TimeIntervalsOverview({
  entries,
  title: titleProp,
  showProject = false,
  maxDates = 10,
}: TimeIntervalsOverviewProps) {
  const t = useTranslations("time");
  const locale = useLocale();
  const title = titleProp ?? t("intervals.title");
  const formatDuration = (hours: number): string => {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    if (h === 0) return t("duration.m", { m });
    if (m === 0) return t("duration.h", { h });
    return t("duration.hm", { h, m });
  };
  const [expandedDates, setExpandedDates] = useState<Set<string>>(new Set());
  const [showAll, setShowAll] = useState(false);

  // Group entries by date and format time ranges
  const groupedEntries = useMemo(() => {
    const groups = new Map<string, GroupedEntry>();

    for (const entry of entries) {
      const dateObj = new Date(entry.date);
      const dateKey = toLocalDateStr(dateObj);

      let group = groups.get(dateKey);
      if (!group) {
        group = {
          date: dateKey,
          dateFormatted: dateObj.toLocaleDateString(toIntlLocale(locale), {
            day: "numeric",
            month: "short",
            year: "numeric",
          }),
          weekday: dateObj.toLocaleDateString(toIntlLocale(locale), {
            weekday: "long",
          }),
          totalHours: 0,
          entries: [],
        };
        groups.set(dateKey, group);
      }

      const hours = parseFloat(entry.hours || "0");
      group.totalHours += hours;

      // Format start/end times
      let startTimeStr: string | null = null;
      let endTimeStr: string | null = null;

      // Altid "08:05" med kolon — da-DK-locale giver "08.05" i Chrome, og
      // Logbog/Teamoverblik bruger kolon.
      if (entry.startTime) startTimeStr = clock(new Date(entry.startTime));
      if (entry.endTime) endTimeStr = clock(new Date(entry.endTime));

      group.entries.push({
        id: entry.id,
        description: entry.description,
        hours,
        startTime: startTimeStr,
        endTime: endTimeStr,
        hasTimeRange: !!(startTimeStr && endTimeStr),
        projectName: entry.project?.name,
        clientName: entry.project?.client?.name || entry.client?.name,
      });
    }

    // Sort by date descending, then sort entries within each group by startTime
    const sortedGroups = Array.from(groups.values())
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((group) => ({
        ...group,
        entries: group.entries.sort((a, b) => {
          if (!a.startTime) return 1;
          if (!b.startTime) return -1;
          return a.startTime.localeCompare(b.startTime);
        }),
      }));

    return sortedGroups;
  }, [entries, locale]);

  const toggleDate = (date: string) => {
    const newExpanded = new Set(expandedDates);
    if (newExpanded.has(date)) {
      newExpanded.delete(date);
    } else {
      newExpanded.add(date);
    }
    setExpandedDates(newExpanded);
  };

  const displayedGroups = showAll
    ? groupedEntries
    : groupedEntries.slice(0, maxDates);

  const totalHoursAll = groupedEntries.reduce(
    (sum, g) => sum + g.totalHours,
    0,
  );
  const entriesWithTimeRange = entries.filter(
    (e) => e.startTime && e.endTime,
  ).length;

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-5">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
          {t("intervals.empty")}
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-800">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-gray-400" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {title}
          </h3>
        </div>
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400">
          <span>
            <span className="font-medium tabular-nums text-gray-900 dark:text-white">
              {formatDuration(totalHoursAll)}
            </span>{" "}
            {t("intervals.total")}
          </span>
          {entriesWithTimeRange > 0 && (
            <span className="flex items-center gap-1 text-xs">
              <Clock className="h-3 w-3" />
              {t("intervals.withRange", {
                count: entriesWithTimeRange,
                total: entries.length,
              })}
            </span>
          )}
        </div>
      </div>

      {/* Date groups */}
      <div className="divide-y divide-gray-100 dark:divide-gray-700">
        {displayedGroups.map((group) => {
          const isExpanded = expandedDates.has(group.date);

          return (
            <div key={group.date}>
              {/* Date header */}
              <button
                type="button"
                onClick={() => toggleDate(group.date)}
                className="w-full flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors"
              >
                <div className="flex items-center gap-3">
                  {isExpanded ? (
                    <ChevronDown className="h-4 w-4 text-gray-400" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-gray-400" />
                  )}
                  <div className="text-left">
                    <span className="font-medium text-gray-900 dark:text-white capitalize">
                      {group.weekday}
                    </span>
                    <span className="ml-2 text-sm text-gray-500 dark:text-gray-400">
                      {group.dateFormatted}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    {t("intervals.entryCount", { count: group.entries.length })}
                  </span>
                  <span className="tabular-nums font-semibold text-gray-900 dark:text-white">
                    {formatDuration(group.totalHours)}
                  </span>
                </div>
              </button>

              {/* Expanded entries */}
              {isExpanded && (
                <div className="bg-gray-50 dark:bg-gray-800/50 border-t border-gray-100 dark:border-gray-700">
                  {group.entries.map((entry, idx) => (
                    <div
                      key={entry.id}
                      className={`flex items-start gap-3 px-4 py-2.5 ${
                        idx !== group.entries.length - 1
                          ? "border-b border-gray-100 dark:border-gray-700"
                          : ""
                      }`}
                    >
                      {/* Time range indicator */}
                      <div className="w-24 flex-shrink-0">
                        {entry.hasTimeRange ? (
                          <span className="inline-flex items-center gap-1 text-xs tabular-nums text-brand-600 dark:text-brand-400">
                            <Clock className="h-3 w-3" />
                            {formatTimeRange(entry.startTime, entry.endTime)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {t("intervals.noRange")}
                          </span>
                        )}
                      </div>

                      {/* Description and project */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-900 dark:text-white truncate">
                          {entry.description || t("intervals.noDescription")}
                        </p>
                        {showProject && entry.projectName && (
                          <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                            {entry.clientName && `${entry.clientName} → `}
                            {entry.projectName}
                          </p>
                        )}
                      </div>

                      {/* Duration */}
                      <div className="flex-shrink-0 text-right">
                        <span className="tabular-nums text-sm text-gray-900 dark:text-white">
                          {formatDuration(entry.hours)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show more button */}
      {groupedEntries.length > maxDates && (
        <div className="p-3 border-t border-gray-100 dark:border-gray-700">
          <button
            type="button"
            onClick={() => setShowAll(!showAll)}
            className="w-full text-center text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300 font-medium"
          >
            {showAll
              ? t("intervals.showLess")
              : t("intervals.showAll", { count: groupedEntries.length })}
          </button>
        </div>
      )}
    </div>
  );
}
