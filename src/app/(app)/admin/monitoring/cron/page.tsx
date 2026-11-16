"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  RefreshCw,
  XCircle,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { EXPECTED_JOB_NAMES } from "@/lib/cron/expected-schedule";
import { trpc } from "@/providers/trpc-provider";

const REFRESH_INTERVAL = 30_000;

// ─── duration formatting ──────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms === null) return "-";
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

// ─── relative time formatting ─────────────────────────────────────────────────

function relativeTime(
  date: Date | null,
  locale: string,
  neverLabel: string,
): string {
  const rtf = new Intl.RelativeTimeFormat(toIntlLocale(locale), {
    numeric: "auto",
  });
  if (!date) return neverLabel;
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  if (Math.abs(diffSec) < 60) return rtf.format(diffSec, "second");
  if (Math.abs(diffMin) < 60) return rtf.format(diffMin, "minute");
  if (Math.abs(diffHr) < 24) return rtf.format(diffHr, "hour");
  return rtf.format(diffDay, "day");
}

// ─── status badge ─────────────────────────────────────────────────────────────

type JobStatus = "success" | "partial" | "error" | "running" | null;

function StatusBadge({
  status,
  isSilent,
  isEverRun,
}: {
  status: JobStatus;
  isSilent: boolean;
  isEverRun: boolean;
}) {
  const t = useTranslations("adminMonitoring");
  if (!isEverRun) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
        {t("cron.badge.neverRun")}
      </span>
    );
  }
  if (isSilent) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <AlertTriangle className="h-3 w-3" />
        {t("cron.badge.silent")}
      </span>
    );
  }
  if (status === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700 dark:bg-red-900/30 dark:text-red-400">
        <XCircle className="h-3 w-3" />
        {t("cron.badge.error")}
      </span>
    );
  }
  if (status === "partial") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        {t("cron.badge.partial")}
      </span>
    );
  }
  if (status === "running") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-400">
        <Clock className="h-3 w-3 animate-spin" />
        {t("cron.badge.running")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
      <CheckCircle2 className="h-3 w-3" />
      {t("cron.badge.ok")}
    </span>
  );
}

// ─── run-detail row ───────────────────────────────────────────────────────────

function RunDetailPanel({ jobName }: { jobName: string }) {
  const t = useTranslations("adminMonitoring");
  const locale = useLocale();
  const { data, isLoading } = trpc.admin.getCronJobRuns.useQuery(
    { jobName, limit: 25 },
    { refetchInterval: REFRESH_INTERVAL },
  );

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-6">
        <InlineSpinner className="h-5 w-5" />
      </div>
    );
  }

  if (!data || data.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-gray-400">
        {t("cron.noRows")}
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full text-xs">
        <thead>
          <tr className="border-b border-gray-100 text-left text-gray-500 dark:border-gray-700 dark:text-gray-400">
            <th className="pb-2 pr-4 font-medium">
              {t("cron.runColumns.status")}
            </th>
            <th className="pb-2 pr-4 font-medium">
              {t("cron.runColumns.started")}
            </th>
            <th className="pb-2 pr-4 font-medium">
              {t("cron.runColumns.duration")}
            </th>
            <th className="pb-2 pr-4 font-medium">
              {t("cron.runColumns.items")}
            </th>
            <th className="pb-2 font-medium">
              {t("cron.runColumns.errorMessage")}
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
          {data.map((run) => (
            <tr
              key={run.id}
              className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
            >
              <td className="py-1.5 pr-4">
                <span
                  className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-medium ${
                    run.status === "success"
                      ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                      : run.status === "error"
                        ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                  }`}
                >
                  {t.has(`cron.runStatus.${run.status}`)
                    ? t(`cron.runStatus.${run.status}`)
                    : run.status}
                </span>
              </td>
              <td className="py-1.5 pr-4 text-gray-600 dark:text-gray-300">
                {new Date(run.startedAt).toLocaleString(toIntlLocale(locale), {
                  dateStyle: "short",
                  timeStyle: "medium",
                })}
              </td>
              <td className="py-1.5 pr-4 text-gray-600 dark:text-gray-300">
                {formatDuration(run.durationMs)}
              </td>
              <td className="py-1.5 pr-4 text-gray-600 dark:text-gray-300">
                {run.itemsProcessed != null
                  ? `${run.itemsSucceeded ?? 0}/${run.itemsProcessed}`
                  : "-"}
              </td>
              <td className="max-w-xs truncate py-1.5 text-red-600 dark:text-red-400">
                {run.errorMessage ?? "-"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── main page ────────────────────────────────────────────────────────────────

export default function CronMonitoringPage() {
  const t = useTranslations("adminMonitoring");
  const locale = useLocale();
  const cadenceLabel = (minutes: number): string => {
    if (minutes < 60) return t("cron.cadence.everyMinutes", { minutes });
    if (minutes === 60) return t("cron.cadence.hourly");
    if (minutes < 24 * 60)
      return t("cron.cadence.everyHours", { hours: Math.round(minutes / 60) });
    if (minutes === 24 * 60) return t("cron.cadence.daily");
    if (minutes === 7 * 24 * 60) return t("cron.cadence.weekly");
    if (minutes >= 30 * 24 * 60) return t("cron.cadence.monthly");
    return t("cron.cadence.everyDays", {
      days: Math.round(minutes / (24 * 60)),
    });
  };
  const [expandedJob, setExpandedJob] = useState<string | null>(null);
  const utils = trpc.useUtils();

  const { data: overview, isLoading } = trpc.admin.getCronJobsOverview.useQuery(
    undefined,
    {
      refetchInterval: REFRESH_INTERVAL,
    },
  );

  const handleRefresh = () => {
    utils.admin.getCronJobsOverview.invalidate();
    if (expandedJob)
      utils.admin.getCronJobRuns.invalidate({ jobName: expandedJob });
  };

  const toggleExpand = (jobName: string) => {
    setExpandedJob((prev) => (prev === jobName ? null : jobName));
  };

  // ── summary tiles ────────────────────────────────────────────────────────

  const totalExpected = EXPECTED_JOB_NAMES.length;
  const silentCount = overview?.filter((j) => j.isSilent).length ?? 0;
  const errorJobCount =
    overview?.filter((j) => j.errorsLast24h > 0).length ?? 0;
  const totalRuns24h =
    overview?.reduce((sum, j) => sum + j.runsLast24h, 0) ?? 0;

  // ── sort: silent first, then by last run desc ─────────────────────────────

  const sortedJobs = overview
    ? [...overview].sort((a, b) => {
        if (a.isSilent && !b.isSilent) return -1;
        if (!a.isSilent && b.isSilent) return 1;
        if (!a.lastRunAt && !b.lastRunAt) return 0;
        if (!a.lastRunAt) return 1;
        if (!b.lastRunAt) return -1;
        return b.lastRunAt.getTime() - a.lastRunAt.getTime();
      })
    : null;

  return (
    <div className="space-y-5">
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
          {t("cron.title")}
        </h1>
        <button
          type="button"
          onClick={handleRefresh}
          className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
        >
          <RefreshCw className="h-4 w-4" />
          {t("cron.refresh")}
        </button>
      </div>

      {/* ── Summary tiles ──────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("cron.tiles.expected")}
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
            {totalExpected}
          </p>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            silentCount > 0
              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          }`}
        >
          <p
            className={`text-sm ${
              silentCount > 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {t("cron.tiles.silent")}
          </p>
          <p
            className={`mt-1 text-3xl font-bold ${
              silentCount > 0
                ? "text-red-700 dark:text-red-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {isLoading ? "…" : silentCount}
          </p>
        </div>

        <div
          className={`rounded-lg border p-4 ${
            errorJobCount > 0
              ? "border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20"
              : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800"
          }`}
        >
          <p
            className={`text-sm ${
              errorJobCount > 0
                ? "text-red-600 dark:text-red-400"
                : "text-gray-500 dark:text-gray-400"
            }`}
          >
            {t("cron.tiles.withErrors")}
          </p>
          <p
            className={`mt-1 text-3xl font-bold ${
              errorJobCount > 0
                ? "text-red-700 dark:text-red-400"
                : "text-gray-900 dark:text-white"
            }`}
          >
            {isLoading ? "…" : errorJobCount}
          </p>
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t("cron.tiles.totalRuns")}
          </p>
          <p className="mt-1 text-3xl font-bold text-gray-900 dark:text-white">
            {isLoading ? "…" : totalRuns24h}
          </p>
        </div>
      </div>

      {/* ── Main table ─────────────────────────────────────────────────────── */}
      <div className="overflow-hidden rounded-lg border border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
        {isLoading ? (
          <div className="flex items-center justify-center py-16">
            <InlineSpinner className="h-8 w-8" />
          </div>
        ) : (
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-900/50">
              <tr>
                <th className="w-8 px-4 py-3" />
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.status")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.job")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.cadence")}
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.lastRun")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.runs24h")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.errors24h")}
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400">
                  {t("cron.columns.avgDuration")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {sortedJobs?.map((job) => {
                const isExpanded = expandedJob === job.jobName;
                const rowHighlight =
                  job.isSilent || job.errorsLast24h > 0
                    ? "bg-red-50/60 dark:bg-red-900/10"
                    : "";

                return (
                  <>
                    <tr
                      key={job.jobName}
                      className={`cursor-pointer transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/50 ${rowHighlight}`}
                      onClick={() => toggleExpand(job.jobName)}
                    >
                      {/* expand chevron */}
                      <td className="px-4 py-3 text-gray-400">
                        {isExpanded ? (
                          <ChevronDown className="h-4 w-4" />
                        ) : (
                          <ChevronRight className="h-4 w-4" />
                        )}
                      </td>

                      {/* status badge */}
                      <td className="px-4 py-3">
                        <StatusBadge
                          status={job.lastStatus as JobStatus}
                          isSilent={job.isSilent}
                          isEverRun={job.isEverRun}
                        />
                      </td>

                      {/* job name */}
                      <td className="px-4 py-3">
                        <span className="font-mono text-sm font-medium text-gray-900 dark:text-white">
                          {job.jobName}
                        </span>
                      </td>

                      {/* cadence */}
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
                        {cadenceLabel(job.expectedIntervalMinutes)}
                      </td>

                      {/* last run */}
                      <td className="px-4 py-3 text-sm text-gray-600 dark:text-gray-300">
                        {relativeTime(job.lastRunAt, locale, t("cron.never"))}
                      </td>

                      {/* runs 24h */}
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">
                        {job.runsLast24h}
                      </td>

                      {/* errors 24h */}
                      <td className="px-4 py-3 text-right text-sm">
                        {job.errorsLast24h > 0 ? (
                          <span className="font-medium text-red-600 dark:text-red-400">
                            {job.errorsLast24h}
                          </span>
                        ) : (
                          <span className="text-gray-400">0</span>
                        )}
                      </td>

                      {/* avg duration */}
                      <td className="px-4 py-3 text-right text-sm text-gray-600 dark:text-gray-300">
                        {formatDuration(job.avgDurationMs)}
                      </td>
                    </tr>

                    {/* expanded detail panel */}
                    {isExpanded && (
                      <tr key={`${job.jobName}-detail`}>
                        <td
                          colSpan={8}
                          className="bg-gray-50 px-6 py-4 dark:bg-gray-900/30"
                        >
                          {/* last error message if any */}
                          {job.lastErrorMessage && (
                            <div className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-400">
                              <span className="font-medium">
                                {t("cron.lastError")}
                              </span>{" "}
                              {job.lastErrorMessage}
                            </div>
                          )}
                          <RunDetailPanel jobName={job.jobName} />
                        </td>
                      </tr>
                    )}
                  </>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
