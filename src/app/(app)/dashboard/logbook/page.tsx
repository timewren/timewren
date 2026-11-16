"use client";

import {
  BookOpen,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Info,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Fragment, useMemo, useState } from "react";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatPause } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

const WEEKDAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
// Medarbejder + 7 dage + "Uge i alt" — hold i sync med theaderen, ellers
// misaligner den udfoldede detaljerækkes colSpan.
const LOGBOOK_COLUMN_COUNT = 9;

function getMonday(d: Date): Date {
  const date = new Date(d);
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  date.setHours(0, 0, 0, 0);
  return date;
}

function addDays(d: Date, days: number): Date {
  const date = new Date(d);
  date.setDate(date.getDate() + days);
  return date;
}

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(iso: string, intlLocale: string): string {
  return new Date(iso).toLocaleTimeString(intlLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function useFormatHours(): (hours: number) => string {
  const t = useTranslations("logbook");
  const intlLocale = toIntlLocale(useLocale());
  return (hours: number) => {
    if (hours === 0) return "0";
    return t("hoursShort", {
      hours: hours.toLocaleString(intlLocale, { maximumFractionDigits: 1 }),
    });
  };
}

/**
 * Udfoldet detaljerække for én medarbejder: tidslinje pr. dag med
 * intervaller, pauser og markering af registreringer uden tidspunkter.
 */
function DayDetailRow({
  userId,
  weekStart,
  days,
}: {
  userId: string;
  weekStart: string;
  days: Date[];
}) {
  const t = useTranslations("logbook");
  const intlLocale = toIntlLocale(useLocale());
  const formatHours = useFormatHours();
  const { data, isLoading, error } = trpc.logbook.dayDetail.useQuery(
    { userId, weekStart },
    // Kort staleTime: et nyt expand må aldrig vise mere end 30 sek gammel
    // data, selv om komponenten mountes med en cached query.
    { staleTime: 30_000 },
  );

  if (isLoading) {
    return (
      <div className="space-y-2 py-1">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-5 w-2/3 animate-pulse rounded bg-gray-200 dark:bg-gray-800"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <p className="py-1 text-xs text-gray-500 dark:text-gray-400">
        {error.data?.code === "FORBIDDEN"
          ? t("detail.noAccess")
          : t("detail.loadError")}
      </p>
    );
  }

  const byDate = new Map((data?.days ?? []).map((d) => [d.date, d]));
  const visibleDays = days
    .map((day, i) => ({
      label: `${t(`weekdaysLong.${WEEKDAY_KEYS[i]}`)} ${day.getDate()}/${day.getMonth() + 1}`,
      detail: byDate.get(toDateStr(day)),
    }))
    .filter((d) => d.detail && d.detail.intervals.length > 0);

  if (visibleDays.length === 0) {
    return (
      <p className="py-1 text-xs text-gray-500 dark:text-gray-400">
        {t("detail.empty")}
      </p>
    );
  }

  const hasSyntheticIntervals = visibleDays.some((d) =>
    d.detail?.intervals.some((iv) => iv.synthetic),
  );

  return (
    <div className="space-y-3 py-1">
      {visibleDays.map(({ label, detail }) => {
        if (!detail) return null;
        const gapAfter = new Map(
          detail.gaps.map((g) => [g.afterIndex, g.minutes]),
        );
        return (
          <div key={detail.date}>
            <div className="flex items-baseline gap-2">
              <span className="text-xs font-semibold text-gray-900 dark:text-white">
                {label}
              </span>
              <span className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                {formatHours(detail.totalHours)}
              </span>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
              {detail.intervals.map((iv, i) => {
                const what = [
                  iv.projectName,
                  iv.clientName ? `(${iv.clientName})` : null,
                ]
                  .filter(Boolean)
                  .join(" ");
                return (
                  // biome-ignore lint/suspicious/noArrayIndexKey: intervallerne har ingen stabil nøgle og listen er statisk pr. fetch
                  <span key={i} className="inline-flex items-center gap-2">
                    {iv.hasTimestamps && iv.start && iv.end ? (
                      <span className="whitespace-nowrap text-gray-700 dark:text-gray-300">
                        <span className="tabular-nums text-gray-900 dark:text-white">
                          {formatTime(iv.start, intlLocale)}–
                          {formatTime(iv.end, intlLocale)}
                        </span>
                        {iv.synthetic && (
                          <span
                            className="cursor-help text-amber-500"
                            title={t("timerSyntheticNote")}
                          >
                            *
                          </span>
                        )}{" "}
                        {what || iv.description || t("detail.noProject")}
                        {" · "}
                        <span className="tabular-nums">
                          {formatHours(iv.hours)}
                        </span>
                      </span>
                    ) : (
                      <span className="whitespace-nowrap text-gray-500 dark:text-gray-400">
                        <span className="tabular-nums">
                          {formatHours(iv.hours)}
                        </span>{" "}
                        {t("detail.noTime")}
                        {(iv.description || what) &&
                          `: ${iv.description || what}`}
                      </span>
                    )}
                    {gapAfter.has(i) && (
                      <span className="whitespace-nowrap text-gray-400 dark:text-gray-500 italic">
                        · {formatPause(gapAfter.get(i) as number)} ·
                      </span>
                    )}
                  </span>
                );
              })}
            </div>
          </div>
        );
      })}
      {hasSyntheticIntervals && (
        <p className="text-[11px] text-gray-400 dark:text-gray-500">
          <span className="text-amber-500">*</span> {t("timerSyntheticNote")}.
        </p>
      )}
    </div>
  );
}

export default function LogbookPage() {
  const t = useTranslations("logbook");
  const intlLocale = toIntlLocale(useLocale());
  const formatHours = useFormatHours();
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const weekStartStr = toDateStr(weekStart);

  const { data, isLoading } = trpc.logbook.weekOverview.useQuery({
    weekStart: weekStartStr,
  });

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );

  const todayStr = toDateStr(new Date());
  const isCurrentWeek = toDateStr(getMonday(new Date())) === weekStartStr;

  const weekLabel = `${weekStart.toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
  })}–${addDays(weekStart, 6).toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="mt-1 text-sm text-gray-600 dark:text-gray-400">
            {data?.canSeeAll ? t("descriptionTeam") : t("descriptionSelf")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, -7))}
            aria-label={t("prevWeek")}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[180px] text-center text-sm font-medium text-gray-900 dark:text-white">
            {weekLabel}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart((w) => addDays(w, 7))}
            aria-label={t("nextWeek")}
            className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={() => setWeekStart(getMonday(new Date()))}
              className="rounded-lg border border-gray-200 dark:border-gray-700 px-3 py-1.5 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              {t("thisWeek")}
            </button>
          )}
          {data?.canSeeAll && (
            <Link
              href="/dashboard/logbook/spildtid"
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              {t("wasteLink")}
            </Link>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-14 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : !data || data.members.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <BookOpen className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            {t("noData")}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-gray-200 dark:border-gray-800 text-left">
                <th className="px-4 py-3 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("table.employee")}
                </th>
                {days.map((day, i) => {
                  const dStr = toDateStr(day);
                  return (
                    <th
                      key={dStr}
                      className={`px-3 py-3 text-center text-xs font-semibold uppercase tracking-wide ${
                        dStr === todayStr
                          ? "text-brand-600 dark:text-brand-400"
                          : "text-gray-500 dark:text-gray-400"
                      }`}
                    >
                      {t(`weekdaysShort.${WEEKDAY_KEYS[i]}`)}{" "}
                      <span className="font-normal">
                        {day.getDate()}/{day.getMonth() + 1}
                      </span>
                    </th>
                  );
                })}
                <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
                  {t("table.weekTotal")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800/50">
              {data.members.map((member) => {
                const weekTotal = Object.values(member.days).reduce(
                  (sum, d) => sum + d.totalHours,
                  0,
                );
                const isExpanded = expandedUserId === member.userId;
                return (
                  <Fragment key={member.userId}>
                    <tr className="group">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedUserId(isExpanded ? null : member.userId)
                          }
                          aria-expanded={isExpanded}
                          className="inline-flex items-center gap-1.5 font-medium text-gray-900 dark:text-white hover:text-brand-600 dark:hover:text-brand-400"
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 text-gray-400 transition-transform ${
                              isExpanded ? "" : "-rotate-90"
                            }`}
                          />
                          {member.name}
                        </button>
                      </td>
                      {days.map((day) => {
                        const dStr = toDateStr(day);
                        const cell = member.days[dStr];
                        if (!cell) {
                          return (
                            <td
                              key={dStr}
                              className="px-3 py-3 text-center text-gray-300 dark:text-gray-600"
                            >
                              –
                            </td>
                          );
                        }
                        const hasTimes = cell.firstStart && cell.lastEnd;
                        return (
                          <td key={dStr} className="px-3 py-3 text-center">
                            {hasTimes ? (
                              <div className="text-gray-900 dark:text-white tabular-nums whitespace-nowrap">
                                {formatTime(
                                  cell.firstStart as string,
                                  intlLocale,
                                )}
                                –
                                {formatTime(cell.lastEnd as string, intlLocale)}
                                {cell.timedCount < cell.entriesCount && (
                                  <span
                                    className="text-amber-500"
                                    title={t("table.partialTimes")}
                                  >
                                    *
                                  </span>
                                )}
                              </div>
                            ) : (
                              <div
                                className="text-gray-400 dark:text-gray-500"
                                title={t("table.noTimes")}
                              >
                                –
                              </div>
                            )}
                            <div className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
                              {formatHours(cell.totalHours)}
                            </div>
                            {/* Dagsdetaljen (hver registrering med tidsrum,
                                pauser, kørende timer) ligger i Teamoverblik —
                                Thomas fandt den ikke fra Logbogen. */}
                            {data.canSeeAll && (
                              <Link
                                href={`/dashboard/team/day?date=${dStr}&view=day&user=${member.userId}`}
                                className="mt-0.5 inline-block text-[11px] text-brand-600 transition-opacity hover:underline focus:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 dark:text-brand-400"
                              >
                                {t("table.viewDay")}
                              </Link>
                            )}
                          </td>
                        );
                      })}
                      <td className="px-4 py-3 text-right font-semibold text-gray-900 dark:text-white tabular-nums">
                        {formatHours(weekTotal)}
                      </td>
                    </tr>
                    {isExpanded && (
                      <tr className="bg-gray-50/60 dark:bg-gray-800/30">
                        <td
                          colSpan={LOGBOOK_COLUMN_COUNT}
                          className="px-4 py-3"
                        >
                          <DayDetailRow
                            userId={member.userId}
                            weekStart={weekStartStr}
                            days={days}
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-start gap-2 rounded-lg bg-brand-50 dark:bg-tt-gran-lys border border-brand-100 dark:border-brand-600 p-3 text-xs text-brand-800 dark:text-brand-300">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <p>{t("footnote")}</p>
      </div>
    </div>
  );
}
