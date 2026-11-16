"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Info,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { RoleGuard } from "@/components/RoleGuard";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  addDays,
  isoWeekNumber,
  startOfISOWeek,
  toDateStr,
} from "@/lib/enterprise/week";
import { formatPause } from "@/lib/format";
import { trpc } from "@/providers/trpc-provider";

type Period = "week" | "month";
type TFn = (key: string, values?: Record<string, string | number>) => string;

const MIN_GAP_OPTIONS = [5, 15, 30] as const;

/** "3 t 25 min" — spildtid vises altid som timer+minutter, aldrig decimaler. */
function formatDuration(minutes: number, t: TFn): string {
  if (minutes <= 0) return t("waste.durationMin", { minutes: 0 });
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return t("waste.durationMin", { minutes: m });
  return m === 0
    ? t("waste.durationHour", { hours: h })
    : t("waste.durationHourMin", { hours: h, minutes: m });
}

function formatClock(iso: string | null): string {
  if (!iso) return "–";
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function formatDayLabel(dateStr: string, intlLocale: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(intlLocale, {
    weekday: "long",
    day: "numeric",
    month: "short",
  });
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function rangeFor(period: Period, anchor: Date): { from: Date; to: Date } {
  if (period === "week") {
    const from = startOfISOWeek(anchor);
    return { from, to: addDays(from, 6) };
  }
  return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
}

function rangeLabel(
  period: Period,
  from: Date,
  to: Date,
  intlLocale: string,
  t: TFn,
): string {
  if (period === "week") {
    return t("waste.weekLabel", {
      week: isoWeekNumber(from),
      from: from.toLocaleDateString(intlLocale, {
        day: "numeric",
        month: "short",
      }),
      to: to.toLocaleDateString(intlLocale, {
        day: "numeric",
        month: "short",
        year: "numeric",
      }),
    });
  }
  const label = from.toLocaleDateString(intlLocale, {
    month: "long",
    year: "numeric",
  });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export default function WasteLogPage() {
  return (
    <RoleGuard minRole="admin">
      <WasteLogContent />
    </RoleGuard>
  );
}

function WasteLogContent() {
  const t = useTranslations("logbook");
  const intlLocale = toIntlLocale(useLocale());
  const [period, setPeriod] = useState<Period>("week");
  const [anchor, setAnchor] = useState(() => new Date());
  const [minGapMinutes, setMinGapMinutes] = useState<number>(15);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const { from, to } = useMemo(
    () => rangeFor(period, anchor),
    [period, anchor],
  );

  const { data, isLoading, error } = trpc.logbook.wasteLog.useQuery(
    { from: toDateStr(from), to: toDateStr(to), minGapMinutes },
    { staleTime: 30_000 },
  );

  const step = (dir: -1 | 1) => {
    setAnchor((a) =>
      period === "week"
        ? addDays(a, dir * 7)
        : new Date(a.getFullYear(), a.getMonth() + dir, 1),
    );
  };

  // Pauserne kommer flade fra serveren; her grupperes de på (bruger, dag) så
  // den udfoldede dagliste kan vise dem uden ekstra kald.
  const gapsByUserAndDay = useMemo(() => {
    const rows = data?.rows ?? [];
    const map = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = `${row.userId}|${row.date}`;
      const list = map.get(key) ?? [];
      list.push(row);
      map.set(key, list);
    }
    return map;
  }, [data?.rows]);

  const totals = data?.totals ?? {
    gapMinutes: 0,
    gapCount: 0,
    untimedEntries: 0,
  };
  const membersWithWaste = (data?.byUser ?? []).filter(
    (u) => u.gapMinutes > 0 || u.untimedEntries > 0,
  );

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("waste.title")}
        description={t("waste.description")}
        actions={
          <Link
            href="/dashboard/logbook"
            className="rounded-lg border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            {t("waste.toLogbook")}
          </Link>
        }
      />

      {/* Periode + tærskel */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            {(["week", "month"] as const).map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setPeriod(p)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  period === p
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                }`}
              >
                {p === "week" ? t("waste.week") : t("waste.month")}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => step(-1)}
            aria-label={
              period === "week" ? t("waste.prevWeek") : t("waste.prevMonth")
            }
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[200px] text-center text-sm font-medium text-gray-900 dark:text-white">
            {rangeLabel(period, from, to, intlLocale, t)}
          </span>
          <button
            type="button"
            onClick={() => step(1)}
            aria-label={
              period === "week" ? t("waste.nextWeek") : t("waste.nextMonth")
            }
            className="rounded-lg border border-gray-200 p-2 text-gray-600 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("waste.countsFrom")}
          </span>
          <div className="flex gap-1">
            {MIN_GAP_OPTIONS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMinGapMinutes(m)}
                className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                  minGapMinutes === m
                    ? "bg-white text-gray-900 shadow-sm dark:bg-gray-700 dark:text-white"
                    : "text-gray-500 hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-300"
                }`}
              >
                {t("waste.durationMin", { minutes: m })}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Nøgletal */}
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-gray-200 lg:grid-cols-4 dark:bg-gray-800">
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("waste.totalWaste")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
            {formatDuration(totals.gapMinutes, t)}
          </div>
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("waste.gapCount")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {totals.gapCount}
          </div>
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("waste.membersWithWaste")}
          </div>
          <div className="mt-1 text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
            {membersWithWaste.filter((u) => u.gapMinutes > 0).length}
          </div>
        </div>
        <div className="bg-white p-4 dark:bg-gray-900">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("waste.untimed")}
          </div>
          <div
            className={`mt-1 text-2xl font-bold tabular-nums ${
              totals.untimedEntries > 0
                ? "text-amber-600 dark:text-amber-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {totals.untimedEntries}
          </div>
          <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
            {t("waste.untimedHint")}
          </div>
        </div>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-gray-500 dark:text-gray-400">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        <span>{t("waste.explainer", { minutes: minGapMinutes })}</span>
      </p>

      {error ? (
        <p className="rounded-xl border border-gray-200 px-4 py-8 text-center text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          {error.data?.code === "FORBIDDEN"
            ? t("waste.noAccess")
            : t("waste.loadError")}
        </p>
      ) : isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-12 animate-pulse rounded-xl bg-gray-100 dark:bg-gray-800"
            />
          ))}
        </div>
      ) : membersWithWaste.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 py-16 text-center dark:border-gray-800">
          <p className="text-sm font-medium text-gray-900 dark:text-white">
            {t("waste.emptyTitle")}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {t("waste.emptyHint")}
          </p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-gray-200/80 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
            <div className="flex-[2.5]">{t("waste.colEmployee")}</div>
            <div className="hidden flex-1 text-right sm:block">
              {t("waste.colBreaks")}
            </div>
            <div className="hidden flex-1 text-right sm:block">
              {t("waste.colUntimed")}
            </div>
            <div className="flex-1 text-right">{t("waste.colWaste")}</div>
            <div className="w-8" />
          </div>
          {membersWithWaste.map((user) => {
            const isExpanded = expandedUserId === user.userId;
            const daysWithGaps = user.days.filter((d) => d.gapMinutes > 0);
            return (
              <div
                key={user.userId}
                className="border-b border-gray-100 last:border-b-0 dark:border-gray-800/50"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpandedUserId(isExpanded ? null : user.userId)
                  }
                  aria-expanded={isExpanded}
                  className="flex w-full items-center px-4 py-3 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className="min-w-0 flex-[2.5] truncate text-sm font-medium text-gray-900 dark:text-white">
                    {user.userName}
                  </div>
                  <div className="hidden flex-1 text-right text-sm tabular-nums text-gray-600 sm:block dark:text-gray-300">
                    {user.gapCount}
                  </div>
                  <div
                    className={`hidden flex-1 text-right text-sm tabular-nums sm:block ${
                      user.untimedEntries > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-gray-400 dark:text-gray-500"
                    }`}
                  >
                    {user.untimedEntries}
                  </div>
                  <div className="flex-1 text-right text-sm font-semibold tabular-nums text-gray-900 dark:text-white">
                    {formatDuration(user.gapMinutes, t)}
                  </div>
                  <div className="flex w-8 justify-end text-gray-400 dark:text-gray-500">
                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4" />
                    ) : (
                      <ChevronDown className="h-4 w-4" />
                    )}
                  </div>
                </button>

                {isExpanded && (
                  <div className="space-y-3 border-t border-gray-100 bg-gray-50/60 px-4 py-3 dark:border-gray-800/50 dark:bg-gray-800/20">
                    {daysWithGaps.length === 0 ? (
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        {user.untimedEntries > 0
                          ? t("waste.noGapsUntimed", {
                              count: user.untimedEntries,
                            })
                          : t("waste.noGaps")}
                      </p>
                    ) : (
                      daysWithGaps.map((day) => (
                        <div key={day.date}>
                          <div className="flex items-baseline gap-2">
                            <span className="text-xs font-semibold text-gray-900 dark:text-white">
                              {formatDayLabel(day.date, intlLocale)}
                            </span>
                            <span className="text-xs tabular-nums text-amber-600 dark:text-amber-400">
                              {formatDuration(day.gapMinutes, t)}
                            </span>
                            <span className="text-xs text-gray-400 dark:text-gray-500">
                              {t("waste.ofPresent", {
                                duration: formatDuration(day.spanMinutes, t),
                              })}
                            </span>
                          </div>
                          <ul className="mt-1 space-y-0.5">
                            {(
                              gapsByUserAndDay.get(
                                `${user.userId}|${day.date}`,
                              ) ?? []
                            ).map((gap) => (
                              <li
                                key={`${gap.date}-${gap.afterEntry?.end ?? ""}-${gap.gapMinutes}`}
                                className="flex flex-wrap items-baseline gap-x-2 text-xs text-gray-600 dark:text-gray-300"
                              >
                                <span className="tabular-nums text-gray-900 dark:text-white">
                                  {formatClock(gap.afterEntry?.end ?? null)}–
                                  {formatClock(gap.beforeEntry?.start ?? null)}
                                </span>
                                <span className="italic text-gray-400 dark:text-gray-500">
                                  {formatPause(gap.gapMinutes)}
                                </span>
                                <span className="text-gray-500 dark:text-gray-400">
                                  {t("waste.afterWhat", {
                                    what:
                                      gap.afterEntry?.projectName ||
                                      gap.afterEntry?.clientName ||
                                      gap.afterEntry?.description ||
                                      t("waste.entryFallback"),
                                  })}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
