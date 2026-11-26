"use client";

import { ChevronLeft, ChevronRight, CopyPlus } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { CoverageStrip } from "@/components/coverage/CoverageStrip";
import { ConfirmDialog } from "@/components/ui";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { useTimeListSummary } from "@/hooks/useTimeListSummary";
import { toIntlLocale } from "@/i18n/format-locale";
import { useSession } from "@/lib/auth-client";
import { formatTime, toLocalDateStr } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

function getWeekDates(referenceDate: Date): {
  start: Date;
  end: Date;
  days: Date[];
} {
  const d = new Date(referenceDate);
  const day = d.getDay();
  const monday = new Date(d);
  monday.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  monday.setHours(0, 0, 0, 0);

  const days: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    days.push(date);
  }

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  return { start: monday, end: sunday, days };
}

const toDateStr = toLocalDateStr;

interface WeeklyTimesheetViewProps {
  onEntryClick?: (entryId: string) => void;
}

export function WeeklyTimesheetView(_props: WeeklyTimesheetViewProps) {
  const t = useTranslations("time");
  const locale = useLocale();
  const [weekOffset, setWeekOffset] = useState(0);
  const [groupMode, setGroupMode] = useState<"project" | "task">("project");
  const [showCopyConfirm, setShowCopyConfirm] = useState(false);
  const { data: session } = useSession();
  const utils = trpc.useUtils();

  const copyWeekMutation = trpc.time.copyWeek.useMutation({
    onSuccess: (result) => {
      if (result.count === 0) {
        toast.info(t("weekly.nothingToCopy"));
      } else {
        toast.success(t("weekly.copied", { count: result.count }));
      }
      utils.time.invalidate();
      utils.coverage.getSummary.invalidate();
    },
    onError: (error) => toast.error(error.message || t("weekly.copyFailed")),
  });

  const { start, end, days } = useMemo(() => {
    const ref = new Date();
    ref.setDate(ref.getDate() + weekOffset * 7);
    return getWeekDates(ref);
  }, [weekOffset]);

  // memberId begrænser til egne registreringer — uden den returnerer
  // time.list hele organisationens tid for org-brugere.
  const { data, isLoading } = useTimeListSummary(
    {
      startDate: toDateStr(start),
      endDate: toDateStr(end),
      memberId: session?.user?.id,
      limit: 500,
    },
    { enabled: !!session?.user?.id },
  );

  const entries = data?.entries ?? [];

  // Group by project or task → then by date
  const { rows, dayTotals, grandTotal } = useMemo(() => {
    const groupMap = new Map<
      string,
      {
        label: string;
        subLabel: string;
        dayHours: Record<string, number>;
        total: number;
      }
    >();

    for (const entry of entries) {
      let key: string;
      let label: string;
      let subLabel: string;

      if (groupMode === "task") {
        const task = entry.task;
        key = task?.id ?? "no-task";
        label = task?.title ?? t("weekly.noTask");
        subLabel = entry.project?.name ?? "";
      } else {
        const project = entry.project;
        key = project?.id ?? "no-project";
        label = project?.name ?? t("weekly.noProject");
        const client = project?.client ?? entry.client;
        subLabel = client?.name ?? "";
      }

      const hours = parseFloat(entry.hours || "0");
      const dateStr =
        entry.date instanceof Date
          ? toDateStr(entry.date)
          : String(entry.date).split("T")[0];

      const existing = groupMap.get(key);
      if (existing) {
        existing.dayHours[dateStr] = (existing.dayHours[dateStr] || 0) + hours;
        existing.total += hours;
      } else {
        groupMap.set(key, {
          label,
          subLabel,
          dayHours: { [dateStr]: hours },
          total: hours,
        });
      }
    }

    const rows = Array.from(groupMap.entries())
      .sort(([, a], [, b]) => b.total - a.total)
      .map(([id, data]) => ({ id, ...data }));

    const dayTotals: Record<string, number> = {};
    let grandTotal = 0;
    for (const day of days) {
      const dateStr = toDateStr(day);
      const total = rows.reduce(
        (sum, r) => sum + (r.dayHours[dateStr] || 0),
        0,
      );
      dayTotals[dateStr] = total;
      grandTotal += total;
    }

    return { rows, dayTotals, grandTotal };
  }, [entries, days, groupMode, t]);

  const isThisWeek = weekOffset === 0;
  const intlLocale = toIntlLocale(locale);
  const weekLabel = `${start.toLocaleDateString(intlLocale, { day: "numeric", month: "short" })}–${end.toLocaleDateString(intlLocale, { day: "numeric", month: "short", year: "numeric" })}`;

  return (
    <div className="rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
        <h2 className="font-semibold text-gray-900 dark:text-white">
          {t("weekly.title")}
        </h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setShowCopyConfirm(true)}
            disabled={copyWeekMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
            title={t("weekly.copyTitle")}
          >
            <CopyPlus className="h-3.5 w-3.5" />
            {copyWeekMutation.isPending
              ? t("weekly.copying")
              : t("weekly.copyLastWeek")}
          </button>
          <button
            type="button"
            onClick={() =>
              setGroupMode((g) => (g === "project" ? "task" : "project"))
            }
            className="rounded-md border border-gray-300 px-2 py-1 text-xs font-medium text-gray-600 hover:bg-gray-50 dark:border-gray-600 dark:text-gray-400 dark:hover:bg-gray-700"
          >
            {groupMode === "project"
              ? t("weekly.groupByTask")
              : t("weekly.groupByProject")}
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o - 1)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={t("weekly.previousWeek")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            disabled={isThisWeek}
            className="rounded-lg px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-50 transition-colors"
          >
            {isThisWeek ? weekLabel : t("weekly.thisWeek")}
          </button>
          {!isThisWeek && (
            <span className="text-sm text-gray-500 dark:text-gray-400">
              {weekLabel}
            </span>
          )}
          <button
            type="button"
            onClick={() => setWeekOffset((o) => o + 1)}
            className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            title={t("weekly.nextWeek")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <CoverageStrip weekStart={toDateStr(start)} />

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
              <th className="text-left font-medium text-gray-600 dark:text-gray-400 px-2 sm:px-4 py-2.5 min-w-[120px] sm:min-w-[200px]">
                {groupMode === "project"
                  ? t("weekly.colProject")
                  : t("weekly.colTask")}
              </th>
              {days.map((day, i) => {
                const dateStr = toDateStr(day);
                const isToday = dateStr === toDateStr(new Date());
                return (
                  <th
                    key={dateStr}
                    className={`text-center font-medium px-1 sm:px-2 py-2.5 min-w-[50px] sm:min-w-[70px] ${
                      isToday
                        ? "text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                        : "text-gray-600 dark:text-gray-400"
                    } ${i >= 5 ? "text-gray-400 dark:text-gray-500" : ""}`}
                  >
                    <div>{t(`weekly.dayShort.${i}`)}</div>
                    <div className="text-xs font-normal">
                      {day.toLocaleDateString(intlLocale, {
                        day: "numeric",
                        month: "numeric",
                      })}
                    </div>
                  </th>
                );
              })}
              <th className="text-center font-semibold text-gray-900 dark:text-white px-2 sm:px-3 py-2.5 min-w-[50px] sm:min-w-[70px]">
                {t("weekly.total")}
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
            {isLoading ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-500">
                  <div className="flex items-center justify-center gap-2">
                    <InlineSpinner className="h-4 w-4" />
                    {t("weekly.loading")}
                  </div>
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={9}
                  className="px-4 py-8 text-center text-gray-500 dark:text-gray-400"
                >
                  {t("weekly.empty")}
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.id}
                  className="hover:bg-gray-50 dark:hover:bg-gray-700/30"
                >
                  <td className="px-2 sm:px-4 py-2.5">
                    <div className="font-medium text-gray-900 dark:text-white text-sm">
                      {row.label}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {row.subLabel}
                    </div>
                  </td>
                  {days.map((day) => {
                    const dateStr = toDateStr(day);
                    const hrs = row.dayHours[dateStr] || 0;
                    const isToday = dateStr === toDateStr(new Date());
                    return (
                      <td
                        key={dateStr}
                        className={`text-center px-2 py-2.5 tabular-nums text-sm ${
                          isToday ? "bg-brand-50/50 dark:bg-tt-gran-lys" : ""
                        } ${hrs > 0 ? "text-gray-900 dark:text-white" : "text-gray-300 dark:text-gray-600"}`}
                      >
                        {hrs > 0 ? formatTime(hrs.toString()) : "–"}
                      </td>
                    );
                  })}
                  <td className="text-center px-3 py-2.5 tabular-nums text-sm font-semibold text-gray-900 dark:text-white">
                    {formatTime(row.total.toString())}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {/* Footer totals */}
          {rows.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-800/50">
                <td className="px-4 py-2.5 font-semibold text-gray-900 dark:text-white text-sm">
                  {t("weekly.total")}
                </td>
                {days.map((day) => {
                  const dateStr = toDateStr(day);
                  const total = dayTotals[dateStr] || 0;
                  const isToday = dateStr === toDateStr(new Date());
                  return (
                    <td
                      key={dateStr}
                      className={`text-center px-2 py-2.5 tabular-nums text-sm font-semibold ${
                        isToday
                          ? "text-brand-600 dark:text-brand-400 bg-brand-50 dark:bg-tt-gran-lys"
                          : "text-gray-900 dark:text-white"
                      }`}
                    >
                      {total > 0 ? formatTime(total.toString()) : "–"}
                    </td>
                  );
                })}
                <td className="text-center px-3 py-2.5 tabular-nums text-sm font-bold text-brand-600 dark:text-brand-400">
                  {formatTime(grandTotal.toString())}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <ConfirmDialog
        isOpen={showCopyConfirm}
        onClose={() => setShowCopyConfirm(false)}
        onConfirm={() => {
          copyWeekMutation.mutate({ targetWeekStart: toDateStr(start) });
          setShowCopyConfirm(false);
        }}
        title={t("weekly.copyDialogTitle")}
        description={t("weekly.copyDialogDescription", { week: weekLabel })}
        confirmLabel={t("weekly.copyConfirm")}
        isLoading={copyWeekMutation.isPending}
      />
    </div>
  );
}
