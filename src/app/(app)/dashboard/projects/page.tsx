"use client";

import { keepPreviousData } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Download,
  FolderKanban,
  Plus,
  Search,
  Tags,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";
import { PageHeader } from "@/components/dashboard-nav";
import { ModuleGuard } from "@/components/ModuleGuard";
import { BulkProjectActivityTypesBar } from "@/components/projects/BulkProjectActivityTypesBar";
import { BulkProjectTagsBar } from "@/components/projects/BulkProjectTagsBar";
import { ModuleDisabledState } from "@/components/ui";
import { useModules } from "@/hooks/useModules";
import { useOrgRole } from "@/hooks/useOrgRole";
import { useRememberedState } from "@/hooks/useRememberedState";
import { toIntlLocale } from "@/i18n/format-locale";
import { isModuleDisabledError } from "@/lib/modules/forbidden-error";
import {
  PERIOD_KEYS,
  PERIOD_OPTIONS,
  type PeriodKey,
  percentChange,
} from "@/lib/periods";
import { trpc } from "@/providers/trpc-provider";

const FILTER_TABS: { id: string; labelKey: string }[] = [
  { id: "", labelKey: "list.tabAll" },
  { id: "active", labelKey: "list.tabActive" },
  { id: "on_hold", labelKey: "list.tabOnHold" },
  { id: "completed", labelKey: "list.tabCompleted" },
  { id: "archived", labelKey: "list.tabArchived" },
];

const STATUS_KEYS = ["active", "completed", "on_hold", "archived"];

const STATUS_STYLES: Record<string, string> = {
  active:
    "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  on_hold:
    "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  archived: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400",
};

const HEALTH_STYLES: Record<string, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};

/** Tekstfarve til månedsbudgettet — samme 80/100-tærskler som baren. */
const MONTHLY_TEXT_STYLES: Record<string, string> = {
  green: "text-gray-900 dark:text-white",
  yellow: "text-amber-700 dark:text-amber-300",
  red: "text-red-700 dark:text-red-300",
};

type SortKey = "hours" | "name" | "client" | "total";

const SORT_OPTIONS: { key: SortKey; labelKey: string }[] = [
  { key: "hours", labelKey: "list.sortHours" },
  { key: "total", labelKey: "list.sortTotal" },
  { key: "name", labelKey: "list.sortName" },
  { key: "client", labelKey: "list.sortClient" },
];

const STATUS_FILTER_IDS = FILTER_TABS.map((t) => t.id);
const SORT_KEYS = SORT_OPTIONS.map((o) => o.key);

/** Celler Excel ellers ville tolke som formel. */
const FORMULA_PREFIX = /^[=+\-@\t\r]/;

/** "12,5" — sprogets talformat med højst én decimal. */
function formatHoursNumber(n: number, locale: string): string {
  return n.toLocaleString(toIntlLocale(locale), { maximumFractionDigits: 1 });
}

function ProjectsPageContent() {
  const t = useTranslations("projects");
  const locale = useLocale();
  const hours = (n: number) => formatHoursNumber(n, locale);
  const statusLabel = (status: string) =>
    STATUS_KEYS.includes(status) ? t(`status.${status}`) : status;
  const [search, setSearch] = useState("");
  // Status, periode og sortering huskes mellem besøg
  const [statusFilter, setStatusFilter] = useRememberedState(
    "projects-status-filter",
    STATUS_FILTER_IDS,
    "",
  );
  const [period, setPeriod] = useRememberedState<PeriodKey>(
    "projects-period",
    PERIOD_KEYS,
    "month",
  );
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [sortKey, setSortKey] = useRememberedState<SortKey>(
    "projects-sort",
    SORT_KEYS,
    "hours",
  );

  // Enterprise-admin (#475): vælg flere projekter → bulk "Tilladte aktiviteter"
  const { orgProfile, isPlaceholder } = useModules();
  const { canManage } = useOrgRole();
  const canBulkActivities =
    orgProfile === "enterprise" && !isPlaceholder && canManage;
  const [selecting, setSelecting] = useState<null | "tags" | "activities">(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const toggleSelected = (id: string) =>
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelecting(null);
  };

  // Et valg må ikke overleve et filterskift: ellers kunne man bulk-tagge
  // projekter der ikke længere er synlige.
  // biome-ignore lint/correctness/useExhaustiveDependencies: filtrene er udløsere: markeringen nulstilles, når et filter skifter
  useEffect(() => {
    setSelectedIds(new Set());
  }, [statusFilter, tagFilter, search, period]);

  const { data, isLoading, isError, error, refetch, isFetching } =
    trpc.projects.listWithStats.useQuery(
      { period },
      // Periodeskift må ikke blanke en liste med 100+ projekter
      { placeholderData: keepPreviousData },
    );
  const projects = data?.projects;

  const periodLabel = t(`periodShort.${period}`);

  const stats = useMemo(() => {
    const list = projects ?? [];
    const nonArchived = list.filter((p) => p.status !== "archived");
    return {
      activeCount: list.filter((p) => p.status === "active").length,
      onHoldCount: list.filter((p) => p.status === "on_hold").length,
      periodHours: nonArchived.reduce(
        (sum, p) => sum + (Number(p.stats.periodHours) || 0),
        0,
      ),
      previousHours: nonArchived.reduce(
        (sum, p) => sum + (Number(p.stats.previousPeriodHours) || 0),
        0,
      ),
      overBudget: nonArchived.filter(
        (p) =>
          p.stats.healthStatus === "red" ||
          p.stats.monthly?.healthStatus === "red",
      ).length,
    };
  }, [projects]);

  const filterCounts = useMemo(() => {
    const list = projects ?? [];
    return {
      "": list.filter((p) => p.status !== "archived").length,
      active: stats.activeCount,
      on_hold: stats.onHoldCount,
      completed: list.filter((p) => p.status === "completed").length,
      archived: list.filter((p) => p.status === "archived").length,
    } as Record<string, number>;
  }, [projects, stats]);

  /**
   * Tags i brug på de projekter status- og søgefiltret viser, med timer i
   * perioden pr. tag. Et projekt med to tags tæller i begge, så summen af
   * chips kan overstige totalen — derfor står tallet på chippen og ikke som
   * en "i alt"-linje.
   */
  const tagSummary = useMemo(() => {
    const byTag = new Map<
      string,
      { id: string; name: string; color: string | null; hours: number }
    >();
    const q = search.trim().toLowerCase();
    for (const p of projects ?? []) {
      if (statusFilter === "") {
        if (p.status === "archived") continue;
      } else if (p.status !== statusFilter) {
        continue;
      }
      if (
        q &&
        !p.name.toLowerCase().includes(q) &&
        !(p.client?.name || "").toLowerCase().includes(q)
      ) {
        continue;
      }
      for (const t of p.tags ?? []) {
        const row = byTag.get(t.id) ?? { ...t, hours: 0 };
        row.hours += Number(p.stats.periodHours) || 0;
        byTag.set(t.id, row);
      }
    }
    return [...byTag.values()].sort((a, b) => b.hours - a.hours);
  }, [projects, statusFilter, search]);

  const filtered = useMemo(() => {
    if (!projects) return [];
    const q = search.trim().toLowerCase();
    const list = projects.filter((p) => {
      if (statusFilter === "") {
        if (p.status === "archived") return false;
      } else if (p.status !== statusFilter) {
        return false;
      }
      if (tagFilter.length > 0) {
        // OR: "SEO" + "Ads" viser begge afdelinger, ikke kun projekter der
        // har begge tags
        const ids = (p.tags ?? []).map((t) => t.id);
        if (!tagFilter.some((id) => ids.includes(id))) return false;
      }
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.client?.name || "").toLowerCase().includes(q)
      );
    });
    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sortKey) {
        case "hours":
          return b.stats.periodHours - a.stats.periodHours;
        case "total":
          return b.stats.totalHours - a.stats.totalHours;
        case "client":
          return (a.client?.name || "").localeCompare(
            b.client?.name || "",
            locale,
          );
        default:
          return a.name.localeCompare(b.name, locale);
      }
    });
    return sorted;
  }, [projects, search, statusFilter, tagFilter, sortKey, locale]);

  const exportCsv = () => {
    const rows = [
      [
        t("list.csvProject"),
        t("list.csvClient"),
        t("list.csvTags"),
        t("list.csvHoursPeriod", { period: periodLabel }),
        t("list.csvHoursTotal"),
        t("list.csvStatus"),
      ],
      ...filtered.map((p) => [
        p.name,
        p.client?.name ?? "",
        (p.tags ?? []).map((t) => t.name).join(" / "),
        hours(p.stats.periodHours),
        hours(p.stats.totalHours),
        statusLabel(p.status || "active"),
      ]),
    ];
    // Semikolon + BOM: Excel i dansk locale åbner filen korrekt. Celler der
    // starter med =, +, - eller @ præfikses, så Excel ikke eksekverer et
    // projektnavn som formel.
    const csvCell = (value: unknown) => {
      const text = String(value ?? "");
      const safe = FORMULA_PREFIX.test(text) ? `'${text}` : text;
      return `"${safe.replace(/"/g, '""')}"`;
    };
    const csv = rows.map((r) => r.map(csvCell).join(";")).join("\r\n");
    const url = URL.createObjectURL(
      new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8;" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${t("list.csvFilePrefix")}-${period}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700" />
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 animate-pulse rounded-lg bg-gray-200 dark:bg-gray-700"
          />
        ))}
      </div>
    );
  }

  const totalTrend = percentChange(stats.periodHours, stats.previousHours);

  return (
    <div className="space-y-4">
      <PageHeader
        title={t("list.title")}
        description={t("list.description")}
        actions={
          <Link
            href="/dashboard/projects/new"
            title={t("list.shortcut")}
            aria-keyshortcuts="n"
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
          >
            <Plus className="h-4 w-4" />
            {t("list.newProject")}
          </Link>
        }
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-px bg-gray-200 dark:bg-gray-800 rounded-xl overflow-hidden">
        <div className="bg-white dark:bg-gray-900 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("list.statActive")}
          </div>
          <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
            {stats.activeCount}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t(`list.statHours.${period}`)}
          </div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white">
              {t("list.hoursShort", { value: hours(stats.periodHours) })}
            </span>
            {totalTrend !== null && (
              <span
                className={`text-xs font-medium ${
                  totalTrend > 0
                    ? "text-green-600 dark:text-green-400"
                    : totalTrend < 0
                      ? "text-gray-500 dark:text-gray-400"
                      : "text-gray-400"
                }`}
                title={t("list.previousPeriod", {
                  hours: hours(stats.previousHours),
                })}
              >
                {totalTrend > 0 ? "+" : ""}
                {totalTrend} %
              </span>
            )}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("list.statOverBudget")}
          </div>
          <div
            className={`text-2xl font-bold tabular-nums mt-1 ${
              stats.overBudget > 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {stats.overBudget}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-900 p-4">
          <div className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-gray-400">
            {t("list.statOnHold")}
          </div>
          <div className="text-2xl font-bold tabular-nums text-gray-900 dark:text-white mt-1">
            {stats.onHoldCount}
          </div>
        </div>
      </div>

      {/* Filter bar */}
      <div className="space-y-3">
        {/* Status til venstre, periode til højre — samme linje, så listen
            begynder højere oppe på en side med 100+ projekter */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex gap-1 flex-wrap">
            {FILTER_TABS.map((tab) => {
              const count = filterCounts[tab.id] ?? 0;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setStatusFilter(tab.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    statusFilter === tab.id
                      ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  }`}
                >
                  {t(tab.labelKey)}
                  {count > 0 && ` (${count})`}
                </button>
              );
            })}
          </div>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 dark:border-gray-700">
            {PERIOD_OPTIONS.map((opt) => (
              <button
                key={opt.key}
                type="button"
                onClick={() => setPeriod(opt.key)}
                aria-pressed={period === opt.key}
                className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                  period === opt.key
                    ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
                    : "text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                }`}
              >
                {t(`period.${opt.key}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Tags: filter + timer pr. tag i perioden */}
        {tagSummary.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {tagSummary.map((tag) => {
              const active = tagFilter.includes(tag.id);
              return (
                <button
                  key={tag.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setTagFilter((prev) =>
                      prev.includes(tag.id)
                        ? prev.filter((id) => id !== tag.id)
                        : [...prev, tag.id],
                    )
                  }
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "border-gray-900 bg-gray-900 text-white dark:border-white dark:bg-white dark:text-gray-900"
                      : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: tag.color ?? "#94a3b8" }}
                  />
                  {tag.name}
                  <span className="tabular-nums opacity-70">
                    {t("list.hoursShort", { value: hours(tag.hours) })}
                  </span>
                </button>
              );
            })}
            {tagFilter.length > 0 && (
              <button
                type="button"
                onClick={() => setTagFilter([])}
                className="ml-1 text-xs text-gray-500 underline-offset-2 hover:underline dark:text-gray-400"
              >
                {t("list.clearTags")}
              </button>
            )}
          </div>
        )}

        {/* Søg, sortér, eksport, bulk */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400 dark:text-gray-500" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={t("list.searchPlaceholder")}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 py-1.5 pl-9 pr-3 text-sm text-gray-900 dark:text-white placeholder:text-gray-400 dark:placeholder:text-gray-500 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
          <select
            value={sortKey}
            onChange={(e) => setSortKey(e.target.value as SortKey)}
            aria-label={t("list.sortAria")}
            className="appearance-none rounded-lg border border-gray-200 bg-white py-1.5 pl-3 pr-8 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300"
          >
            {SORT_OPTIONS.map((o) => (
              <option key={o.key} value={o.key}>
                {t(o.labelKey)}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={exportCsv}
            disabled={filtered.length === 0}
            className="inline-flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            <Download className="h-3.5 w-3.5" />
            CSV
          </button>
          {canManage && (
            <button
              type="button"
              onClick={() =>
                selecting === "tags" ? clearSelection() : setSelecting("tags")
              }
              aria-pressed={selecting === "tags"}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                selecting === "tags"
                  ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <Tags className="h-3.5 w-3.5" />
              {selecting === "tags"
                ? t("list.cancelSelection")
                : t("list.setTagsMulti")}
            </button>
          )}
          {canBulkActivities && (
            <button
              type="button"
              onClick={() =>
                selecting === "activities"
                  ? clearSelection()
                  : setSelecting("activities")
              }
              aria-pressed={selecting === "activities"}
              className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                selecting === "activities"
                  ? "border-brand-500 bg-brand-50 text-brand-800 dark:bg-tt-gran-lys dark:text-brand-200"
                  : "border-gray-200 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-300 dark:hover:bg-gray-800"
              }`}
            >
              <Tags className="h-3.5 w-3.5" />
              {selecting === "activities"
                ? t("list.cancelSelection")
                : t("list.allowedActivitiesMulti")}
            </button>
          )}
        </div>
        {selecting === "tags" && (
          <BulkProjectTagsBar
            projectIds={Array.from(selectedIds)}
            onClear={clearSelection}
          />
        )}
        {selecting === "activities" && (
          <BulkProjectActivityTypesBar
            projectIds={Array.from(selectedIds)}
            onClear={clearSelection}
          />
        )}
      </div>

      {isError ? (
        isModuleDisabledError(error) ? (
          <ModuleDisabledState />
        ) : (
          <div className="rounded-xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/50 dark:bg-red-900/10">
            <p className="text-sm font-medium text-red-800 dark:text-red-300">
              {t("list.loadError")}
            </p>
            <button
              type="button"
              onClick={() => void refetch()}
              className="mt-3 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              {t("list.retry")}
            </button>
          </div>
        )
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-200 dark:border-gray-800 p-12 text-center">
          <FolderKanban className="mx-auto h-8 w-8 text-gray-300 dark:text-gray-600" />
          <p className="mt-4 text-sm font-medium text-gray-900 dark:text-white">
            {projects && projects.length > 0
              ? t("list.emptyNoMatch")
              : t("list.emptyNone")}
          </p>
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
            {projects && projects.length > 0
              ? t("list.emptyNoMatchHint")
              : t("list.emptyNoneHint")}
          </p>
          {(!projects || projects.length === 0) && (
            <Link
              href="/dashboard/projects/new"
              className="mt-4 inline-flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran hover:bg-tt-gran-moerk"
            >
              <Plus className="h-4 w-4" />
              {t("list.createFirst")}
            </Link>
          )}
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 overflow-hidden">
          {/* Kolonneoverskrifter */}
          <div className="flex items-center border-b border-gray-200 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-gray-500 dark:border-gray-800 dark:text-gray-400">
            {selecting && <span className="w-8 shrink-0" />}
            <span className="min-w-0 flex-1">{t("list.colProject")}</span>
            <span className="hidden w-36 shrink-0 text-right lg:block">
              {t("list.colMonthBudget")}
            </span>
            <span className="hidden w-28 shrink-0 text-right sm:block">
              {periodLabel}
              {isFetching && !isLoading && (
                <span className="ml-1 font-normal normal-case text-gray-400">
                  {t("list.updating")}
                </span>
              )}
            </span>
            <span className="hidden w-24 shrink-0 text-right md:block">
              {t("list.colTotal")}
            </span>
            <span className="w-20 shrink-0 text-right">
              {t("list.colStatus")}
            </span>
          </div>

          <div className="divide-y divide-gray-100 dark:divide-gray-800/50">
            {filtered.map((project) => {
              const trend = percentChange(
                project.stats.periodHours,
                project.stats.previousPeriodHours,
              );
              return (
                <div key={project.id} className="flex items-center">
                  {selecting && (
                    <label className="flex w-8 shrink-0 items-center justify-center pl-4">
                      <input
                        type="checkbox"
                        checked={selectedIds.has(project.id)}
                        onChange={() => toggleSelected(project.id)}
                        aria-label={t("list.selectProject", {
                          name: project.name,
                        })}
                        className="h-4 w-4 rounded border-gray-300 text-brand-600 dark:text-brand-400 focus:ring-brand-500 dark:border-gray-600"
                      />
                    </label>
                  )}
                  <Link
                    href={`/dashboard/projects/${project.id}`}
                    className="flex min-w-0 flex-1 items-center px-4 py-3 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-900 dark:text-white">
                          {project.name}
                        </span>
                        {project.stats.healthStatus && (
                          <span
                            className={`h-2 w-2 shrink-0 rounded-full ${HEALTH_STYLES[project.stats.healthStatus]}`}
                            title={
                              project.stats.budgetPercentage !== null
                                ? t("list.budgetUsedTitle", {
                                    pct: project.stats.budgetPercentage,
                                    used: project.stats.totalHours,
                                    total:
                                      project.stats.estimatedBudgetHours ?? 0,
                                  })
                                : undefined
                            }
                          />
                        )}
                        {(project.tags ?? []).map((tag) => (
                          <span
                            key={tag.id}
                            className="hidden shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-medium lg:inline-flex"
                            style={{
                              backgroundColor: `${tag.color ?? "#94a3b8"}20`,
                              color: tag.color ?? undefined,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))}
                      </div>
                      <p className="truncate text-xs text-gray-600 dark:text-gray-400">
                        {project.client?.name || t("list.noClient")}
                      </p>
                    </div>

                    {/* Månedsbudget: mini-bar + "brugt/budget t denne måned" */}
                    <div className="hidden w-36 shrink-0 flex-col items-end gap-1 lg:flex">
                      {project.stats.monthly ? (
                        <>
                          <span
                            className={`text-xs tabular-nums ${MONTHLY_TEXT_STYLES[project.stats.monthly.healthStatus]}`}
                          >
                            {t("list.monthlyUsed", {
                              used: hours(project.stats.monthly.usedHours),
                              budget: hours(project.stats.monthly.budgetHours),
                            })}
                          </span>
                          <div
                            className="h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                            role="progressbar"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={Math.min(
                              100,
                              project.stats.monthly.percentage,
                            )}
                            aria-label={t("list.monthlyAria", {
                              pct: project.stats.monthly.percentage,
                            })}
                            title={t("list.monthlyTitle", {
                              used: hours(project.stats.monthly.usedHours),
                              budget: hours(project.stats.monthly.budgetHours),
                              pct: project.stats.monthly.percentage,
                            })}
                          >
                            <div
                              className={`h-full rounded-full ${HEALTH_STYLES[project.stats.monthly.healthStatus]}`}
                              style={{
                                width: `${Math.min(100, Math.max(0, project.stats.monthly.percentage))}%`,
                              }}
                            />
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-gray-300 dark:text-gray-600">
                          –
                        </span>
                      )}
                    </div>

                    {/* Timer i perioden + trend */}
                    <div className="hidden w-28 shrink-0 flex-col items-end sm:flex">
                      <span
                        className={`text-sm tabular-nums ${
                          project.stats.periodHours > 0
                            ? "text-gray-900 dark:text-white"
                            : "text-gray-300 dark:text-gray-600"
                        }`}
                      >
                        {t("list.hoursShort", {
                          value: hours(project.stats.periodHours),
                        })}
                      </span>
                      {trend !== null && trend !== 0 && (
                        <span
                          className={`flex items-center gap-0.5 text-[11px] ${
                            trend > 0
                              ? "text-green-600 dark:text-green-400"
                              : "text-gray-400 dark:text-gray-500"
                          }`}
                          title={t("list.previousPeriod", {
                            hours: hours(project.stats.previousPeriodHours),
                          })}
                        >
                          {trend > 0 ? (
                            <ArrowUp className="h-3 w-3" />
                          ) : (
                            <ArrowDown className="h-3 w-3" />
                          )}
                          {Math.abs(trend)} %
                        </span>
                      )}
                    </div>

                    {/* Timer i alt */}
                    <span className="hidden w-24 shrink-0 text-right text-sm tabular-nums text-gray-500 dark:text-gray-400 md:block">
                      {t("list.hoursShort", {
                        value: hours(project.stats.totalHours),
                      })}
                    </span>

                    <span className="flex w-20 shrink-0 justify-end">
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[project.status || "active"] || STATUS_STYLES.active}`}
                      >
                        {statusLabel(project.status || "active")}
                      </span>
                    </span>
                  </Link>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

export default function ProjectsPage() {
  return (
    <ModuleGuard module="projects">
      <ProjectsPageContent />
    </ModuleGuard>
  );
}
