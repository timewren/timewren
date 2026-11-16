"use client";

import { AlertTriangle, Calendar, Clock } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { trpc } from "@/providers/trpc-provider";

function getMonday(d: Date): Date {
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(d);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday;
}

function ProgressBar({
  value,
  max,
  color,
}: {
  value: number;
  max: number;
  color: string;
}) {
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0;
  return (
    <div className="h-2 w-full rounded-full bg-gray-100 dark:bg-gray-800">
      <div
        className={`h-2 rounded-full transition-all ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function CalendarSyncWidget() {
  const t = useTranslations("dashboard.widgets.calendarSync");
  const monday = useMemo(() => getMonday(new Date()), []);

  const { data: status } = trpc.calendar.getConnectionStatus.useQuery(
    undefined,
    { retry: false },
  );
  const { data: summary } = trpc.calendar.getWeeklySummary.useQuery(
    { weekStart: monday.toISOString() },
    { enabled: !!status?.connected },
  );

  if (!status?.connected || !summary) return null;

  const captureColor =
    summary.captureRate >= 90
      ? "text-green-600 dark:text-green-400"
      : summary.captureRate >= 70
        ? "text-amber-600 dark:text-amber-400"
        : "text-red-600 dark:text-red-400";

  const captureBg =
    summary.captureRate >= 90
      ? "bg-green-100 dark:bg-green-900/30"
      : summary.captureRate >= 70
        ? "bg-amber-100 dark:bg-amber-900/30"
        : "bg-red-100 dark:bg-red-900/30";

  const maxHours = Math.max(summary.calendarHours, summary.trackedHours, 1);

  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Calendar className="h-4 w-4 text-tt-graa" />
          <h3 className="text-sm font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h3>
        </div>
        <Link
          href="/dashboard/calendar"
          className="text-xs text-brand-600 hover:underline dark:text-brand-400"
        >
          {t("seeCalendar")}
        </Link>
      </div>

      {/* Capture rate badge */}
      <div className="mt-3 flex items-center gap-3">
        <div
          className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${captureBg}`}
        >
          <span className={`text-lg font-bold ${captureColor}`}>
            {summary.captureRate}%
          </span>
          <span className="text-[10px] font-medium text-gray-500 dark:text-gray-400">
            {t("captureRate")}
          </span>
        </div>
        <div className="text-xs text-gray-500 dark:text-gray-400">
          {t("eventsTracked", {
            tracked: summary.trackedEventsCount,
            total: summary.eventsCount,
          })}
        </div>
      </div>

      {/* Visual comparison bars */}
      <div className="mt-4 space-y-3">
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3 w-3 text-brand-500 dark:text-brand-400" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t("calendar")}
              </span>
            </div>
            <span className="text-xs font-semibold text-gray-900 dark:text-white">
              {summary.calendarHours}t
            </span>
          </div>
          <ProgressBar
            value={summary.calendarHours}
            max={maxHours}
            color="bg-brand-500"
          />
        </div>
        <div>
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-1.5">
              <Clock className="h-3 w-3 text-green-500" />
              <span className="text-xs text-gray-600 dark:text-gray-400">
                {t("tracked")}
              </span>
            </div>
            <span className="text-xs font-semibold text-gray-900 dark:text-white">
              {summary.trackedHours}t
            </span>
          </div>
          <ProgressBar
            value={summary.trackedHours}
            max={maxHours}
            color="bg-green-500"
          />
        </div>
      </div>

      {/* Gap warning */}
      {summary.gapHours > 0 && (
        <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-50 dark:bg-amber-950/30 px-2.5 py-1.5 text-xs text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          {t("gap", { hours: summary.gapHours })}
        </div>
      )}

      {/* Per-project breakdown */}
      {summary.byProject.length > 0 && (
        <div className="mt-3 border-t border-gray-200 dark:border-gray-700 pt-3">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-gray-400">
            {t("perProject")}
          </p>
          <div className="space-y-1.5">
            {summary.byProject.slice(0, 4).map((p) => {
              const projHours = Math.round((p.minutes / 60) * 10) / 10;
              return (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs text-gray-600 dark:text-gray-400">
                    {p.name}
                  </span>
                  <div className="w-16">
                    <ProgressBar
                      value={projHours}
                      max={
                        Math.round((summary.byProject[0].minutes / 60) * 10) /
                        10
                      }
                      color="bg-purple-400"
                    />
                  </div>
                  <span className="w-8 text-right text-xs font-medium text-gray-900 dark:text-white">
                    {projHours}t
                  </span>
                </div>
              );
            })}
            {summary.byProject.length > 4 && (
              <p className="text-[10px] text-gray-400">
                {t("moreProjects", { count: summary.byProject.length - 4 })}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
