"use client";

import {
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Download,
  Printer,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import {
  type CellChange,
  ResourcePlanGrid,
} from "@/components/resource-plan/ResourcePlanGrid";
import { EmptyState } from "@/components/ui/EmptyState";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import {
  formatHours,
  memberWeekTotals,
  type ResourcePlanPreset,
  resourcePlanCsv,
} from "@/lib/resource-plan/export";
import {
  bookingStatus,
  sumValues,
  toWeekStart,
  weekEnd,
} from "@/lib/resource-plan/plan";
import { addDaysToDateStr, copenhagenToday } from "@/lib/time/copenhagen";
import { trpc } from "@/providers/trpc-provider";

// Ressourceplan (#508): planlagte timer pr. medarbejder × projekt pr. uge,
// holdt op mod registreret tid og kapacitet. Lederen planlægger; et medlem
// ser sin egen plan. Kun Team og Virksomhed (serveren håndhæver).

const WEEK_OPTIONS = [4, 8, 12] as const;

function formatDay(dateStr: string, intlLocale: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(intlLocale, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

function downloadCsv(csv: string, filename: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function ResourcePlanPage() {
  const t = useTranslations("resourcePlan");
  const intlLocale = toIntlLocale(useLocale());
  const presetLabels: Record<ResourcePlanPreset, string> = {
    grid: t("presetGrid"),
    opgaveoversigt: t("presetTasks"),
  };
  const currentWeek = toWeekStart(copenhagenToday());
  const [weekStart, setWeekStart] = useState(currentWeek);
  const [weeks, setWeeks] = useState<number>(8);
  const [userId, setUserId] = useState("");

  const [resetKey, setResetKey] = useState(0);
  const utils = trpc.useUtils();
  const query = trpc.resourcePlan.grid.useQuery(
    { weekStart, weeks, userId: userId || undefined },
    {
      // Registreret tid ændres andre steder i appen — hent altid frisk
      staleTime: 0,
      refetchOnWindowFocus: true,
      placeholderData: (prev) => prev,
      retry: (count, err) =>
        err.data?.code !== "FORBIDDEN" &&
        err.data?.code !== "BAD_REQUEST" &&
        count < 2,
    },
  );
  const { data, isLoading, error } = query;

  const setCells = trpc.resourcePlan.setCells.useMutation({
    onSuccess: () => {
      utils.resourcePlan.grid.invalidate();
      // Budget-baren på projektsiden viser planlagt fremover
      utils.projects.getStats.invalidate();
    },
    onError: (err) => {
      toast.error(err.message || t("saveFailed"));
      setResetKey((k) => k + 1);
      utils.resourcePlan.grid.invalidate();
    },
  });

  const onChange = (cells: CellChange[]) => {
    if (cells.length === 0) return;
    setCells.mutate({ cells });
  };

  const summary = useMemo(() => {
    if (!data) return null;
    let planned = 0;
    let registered = 0;
    let capacity = 0;
    let over = 0;
    let under = 0;
    for (const m of data.members) {
      const totals = memberWeekTotals(data.rows, m.userId, data.weeks);
      planned += sumValues(totals.planned);
      registered += sumValues(totals.registered);
      for (const w of data.weeks) {
        const cap = m.capacity[w]?.capacity ?? 0;
        capacity += cap;
        const status = bookingStatus(totals.planned[w], cap);
        if (status === "over") over++;
        if (status === "under") under++;
      }
    }
    return { planned, registered, capacity, over, under };
  }, [data]);

  const exportCsv = (preset: ResourcePlanPreset) => {
    if (!data) return;
    const csv = resourcePlanCsv(data, preset);
    const name =
      preset === "opgaveoversigt" ? "opgaveoversigt" : "ressourceplan";
    downloadCsv(csv, `${name}-${data.weeks[0]}.csv`);
  };

  const printHref = (preset: ResourcePlanPreset) => {
    const params = new URLSearchParams({
      week: weekStart,
      weeks: String(weeks),
      preset,
    });
    if (userId) params.set("user", userId);
    return `/dashboard/resource-plan/print?${params.toString()}`;
  };

  const lastWeek = data?.weeks[data.weeks.length - 1];
  // Medarbejdervalget skal kende alle, også mens der er filtreret på én
  const [allMembers, setAllMembers] = useState<
    Array<{ userId: string; name: string }>
  >([]);
  useEffect(() => {
    if (data && !userId && data.scope !== "self") {
      setAllMembers(
        data.members.map((m) => ({ userId: m.userId, name: m.name })),
      );
    }
  }, [data, userId]);
  const memberOptions = allMembers;

  return (
    <div className="space-y-5">
      <PageHeader
        title={t("title")}
        description={
          data?.scope === "self" ? t("descriptionSelf") : t("descriptionTeam")
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-lg border border-gray-300 dark:border-gray-700">
          <button
            type="button"
            onClick={() =>
              setWeekStart(addDaysToDateStr(weekStart, -7 * weeks))
            }
            aria-label={t("prevPeriod")}
            className="flex h-9 w-9 items-center justify-center rounded-l-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="min-w-[10rem] px-2 text-center text-sm tabular-nums text-gray-800 dark:text-gray-200">
            {formatDay(weekStart, intlLocale)} –{" "}
            {formatDay(
              weekEnd(lastWeek ?? addDaysToDateStr(weekStart, 7 * (weeks - 1))),
              intlLocale,
            )}
          </span>
          <button
            type="button"
            onClick={() => setWeekStart(addDaysToDateStr(weekStart, 7 * weeks))}
            aria-label={t("nextPeriod")}
            className="flex h-9 w-9 items-center justify-center rounded-r-lg text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        {weekStart !== currentWeek && (
          <button
            type="button"
            onClick={() => setWeekStart(currentWeek)}
            className="h-9 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            {t("thisWeek")}
          </button>
        )}
        <select
          value={weeks}
          onChange={(e) => setWeeks(Number(e.target.value))}
          aria-label={t("weekCount")}
          className="h-9 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
        >
          {WEEK_OPTIONS.map((n) => (
            <option key={n} value={n}>
              {t("weeksOption", { count: n })}
            </option>
          ))}
        </select>
        {memberOptions.length > 1 || userId ? (
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            aria-label={t("employee")}
            className="h-9 rounded-lg border border-gray-300 px-2 text-sm dark:border-gray-700 dark:bg-gray-800 dark:text-white"
          >
            <option value="">{t("allEmployees")}</option>
            {memberOptions.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
              </option>
            ))}
          </select>
        ) : null}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {(["grid", "opgaveoversigt"] as const).map((preset) => (
            <button
              key={preset}
              type="button"
              disabled={!data}
              onClick={() => exportCsv(preset)}
              title={t("csvTitle", { label: presetLabels[preset] })}
              className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
            >
              <Download className="h-4 w-4" />
              {preset === "grid" ? t("csv") : t("taskOverviewCsv")}
            </button>
          ))}
          <Link
            href={printHref("opgaveoversigt")}
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Printer className="h-4 w-4" />
            {t("taskOverviewPdf")}
          </Link>
          <Link
            href={printHref("grid")}
            target="_blank"
            className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            <Printer className="h-4 w-4" />
            {t("printPdf")}
          </Link>
        </div>
      </div>

      {error && !data ? (
        <EmptyState
          icon={CalendarRange}
          title={
            error.data?.code === "FORBIDDEN"
              ? t("unavailable")
              : t("loadFailed")
          }
          description={error.message}
        />
      ) : isLoading || !data ? (
        <div className="flex h-64 items-center justify-center">
          <InlineSpinner className="h-6 w-6" />
        </div>
      ) : (
        <>
          {error && (
            <p
              role="alert"
              className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-300"
            >
              {t("refreshFailed", { message: error.message })}
            </p>
          )}
          {summary && (
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                [
                  t("summary.capacity"),
                  t("summary.hours", { hours: formatHours(summary.capacity) }),
                ],
                [
                  t("summary.planned"),
                  t("summary.hours", { hours: formatHours(summary.planned) }),
                ],
                [
                  t("summary.registered"),
                  t("summary.hours", {
                    hours: formatHours(summary.registered),
                  }),
                ],
                [
                  t("summary.booking"),
                  summary.over + summary.under === 0
                    ? t("summary.noDeviations")
                    : t("summary.overUnder", {
                        over: summary.over,
                        under: summary.under,
                      }),
                ],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="rounded-xl border border-gray-200 bg-white px-4 py-3 dark:border-gray-800 dark:bg-gray-900"
                >
                  <dt className="text-xs text-gray-500 dark:text-gray-400">
                    {label}
                  </dt>
                  <dd className="mt-0.5 text-base tabular-nums text-gray-900 dark:text-white">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-600 dark:text-gray-400">
            <span>
              {t.rich("legend.memberRow", {
                strong: (chunks) => <strong>{chunks}</strong>,
              })}
            </span>
            <span className="rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/40 dark:text-red-300">
              {t("legend.over")}
            </span>
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
              {t("legend.under")}
            </span>
            <span className="text-red-600 dark:text-red-400">
              {t("legend.moreThanPlanned")}
            </span>
            <span className="text-amber-700 dark:text-amber-400">
              {t("legend.lessThanPlanned")}
            </span>
            {setCells.isPending && (
              <span className="inline-flex items-center gap-1 text-gray-500">
                <InlineSpinner className="h-3 w-3" /> {t("saving")}
              </span>
            )}
          </div>

          {data.members.length === 0 ? (
            <EmptyState
              icon={CalendarRange}
              title={t("noMembers")}
              description={t("noMembersHint")}
            />
          ) : (
            <ResourcePlanGrid
              data={data}
              resetKey={resetKey}
              onChange={onChange}
            />
          )}
        </>
      )}
    </div>
  );
}
