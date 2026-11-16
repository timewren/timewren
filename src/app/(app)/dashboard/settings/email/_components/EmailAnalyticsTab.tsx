"use client";

import {
  BarChart3,
  CheckCircle,
  Filter,
  Mail,
  RefreshCw,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

function StatCard({
  label,
  value,
  icon: Icon,
  color = "blue",
}: {
  label: string;
  value: string | number;
  icon: React.ComponentType<{ className?: string }>;
  color?: "blue" | "green" | "yellow" | "red" | "purple";
}) {
  const colors = {
    blue: "bg-blue-50 text-blue-600 dark:bg-blue-950 dark:text-blue-400",
    green: "bg-green-50 text-green-600 dark:bg-green-950 dark:text-green-400",
    yellow:
      "bg-yellow-50 text-yellow-600 dark:bg-yellow-950 dark:text-yellow-400",
    red: "bg-red-50 text-red-600 dark:bg-red-950 dark:text-red-400",
    purple:
      "bg-purple-50 text-purple-600 dark:bg-purple-950 dark:text-purple-400",
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
      <div className="flex items-center gap-3">
        <div className={`rounded-lg p-2 ${colors[color]}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white">
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function SyncHealthIndicator({
  status,
  lastSyncedAt,
  lastHeartbeat,
  failures,
}: {
  status: string | null;
  lastSyncedAt: Date | string | null;
  lastHeartbeat: Date | string | null;
  failures: number;
}) {
  const t = useTranslations("settingsEmailAnalytics");
  const getStatusColor = () => {
    if (failures >= 5) return "red";
    if (failures >= 2) return "yellow";
    if (status === "success") return "green";
    if (status === "error") return "red";
    return "gray";
  };

  const color = getStatusColor();
  const colors = {
    green: "bg-green-500",
    yellow: "bg-yellow-500",
    red: "bg-red-500",
    gray: "bg-gray-400",
  };

  const formatTime = (date: Date | string | null) => {
    if (!date) return t("never");
    const d = new Date(date);
    const now = new Date();
    const diffMin = Math.round((now.getTime() - d.getTime()) / 60000);
    if (diffMin < 1) return t("now");
    if (diffMin < 60) return t("minAgo", { count: diffMin });
    const diffHours = Math.round(diffMin / 60);
    if (diffHours < 24) return t("hoursAgo", { count: diffHours });
    return t("daysAgo", { count: Math.round(diffHours / 24) });
  };

  return (
    <div className="flex items-center gap-3">
      <div className={`h-3 w-3 rounded-full ${colors[color]}`} />
      <div className="text-sm">
        <span className="font-medium text-gray-900 dark:text-white">
          {color === "green"
            ? t("healthy")
            : color === "yellow"
              ? t("unstable")
              : color === "red"
                ? t("error")
                : t("unknown")}
        </span>
        <span className="ml-2 text-gray-500 dark:text-gray-400">
          {t("lastSync", { time: formatTime(lastSyncedAt) })}
        </span>
        {lastHeartbeat && (
          <span className="ml-2 text-gray-400 dark:text-gray-500">
            {t("heartbeat", { time: formatTime(lastHeartbeat) })}
          </span>
        )}
      </div>
    </div>
  );
}

function HitRateChart({
  data,
}: {
  data: { date: string; total: number; withTask: number }[];
}) {
  const t = useTranslations("settingsEmailAnalytics");
  const locale = useLocale();
  if (!data.length) {
    return (
      <p className="py-8 text-center text-sm text-gray-500">{t("noData")}</p>
    );
  }

  const maxTotal = Math.max(...data.map((d) => d.total), 1);
  const barWidth = Math.max(8, Math.min(24, Math.floor(400 / data.length)));

  return (
    <div className="overflow-x-auto">
      <svg
        width={Math.max(400, data.length * (barWidth + 4) + 40)}
        height={200}
        className="mx-auto"
        role="img"
        aria-label={t("chartLabel")}
      >
        {data.map((day, i) => {
          const x = 30 + i * (barWidth + 4);
          const totalHeight = (day.total / maxTotal) * 150;
          const taskHeight = (day.withTask / maxTotal) * 150;

          return (
            <g key={day.date}>
              {/* Total emails bar */}
              <rect
                x={x}
                y={170 - totalHeight}
                width={barWidth}
                height={totalHeight}
                className="fill-gray-200 dark:fill-gray-600"
                rx={2}
              />
              {/* Tasks created bar (overlay) */}
              <rect
                x={x}
                y={170 - taskHeight}
                width={barWidth}
                height={taskHeight}
                className="fill-brand-500"
                rx={2}
              />
              {/* Day label */}
              {i % Math.max(1, Math.floor(data.length / 10)) === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={188}
                  textAnchor="middle"
                  className="fill-gray-400 text-[9px]"
                >
                  {new Date(day.date).toLocaleDateString(toIntlLocale(locale), {
                    day: "numeric",
                    month: "short",
                  })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div className="mt-2 flex items-center justify-center gap-4 text-xs text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded bg-gray-200 dark:bg-gray-600" />
          {t("legendEmails")}
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block h-2 w-3 rounded bg-brand-500" />
          {t("legendTasks")}
        </span>
      </div>
    </div>
  );
}

export function EmailAnalyticsTab() {
  const t = useTranslations("settingsEmailAnalytics");
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d");

  const { data: hitRate, isLoading: hitRateLoading } =
    trpc.emailAnalytics.getHitRate.useQuery({ period });
  const { data: topSenders } = trpc.emailAnalytics.getTopSenders.useQuery({
    limit: 10,
  });
  const { data: fpRate } = trpc.emailAnalytics.getFalsePositiveRate.useQuery();
  const { data: filterRules } =
    trpc.emailAnalytics.getFilterEffectiveness.useQuery();
  const { data: confidenceDist } =
    trpc.emailAnalytics.getConfidenceDistribution.useQuery();
  const { data: syncOverview } = trpc.emailAnalytics.getSyncOverview.useQuery();

  return (
    <div className="space-y-6">
      {/* Sync Health */}
      {syncOverview && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <RefreshCw className="h-4 w-4" />
            {t("syncHealth")}
          </h3>
          <SyncHealthIndicator
            status={syncOverview.lastSyncStatus}
            lastSyncedAt={syncOverview.lastSyncedAt}
            lastHeartbeat={syncOverview.lastHeartbeat}
            failures={syncOverview.consecutiveSyncFailures}
          />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {syncOverview.todayEmails}
              </p>
              <p className="text-xs text-gray-500">{t("emailsToday")}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {syncOverview.todayTasks}
              </p>
              <p className="text-xs text-gray-500">{t("tasksToday")}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {syncOverview.todayHighPriority}
              </p>
              <p className="text-xs text-gray-500">{t("fromClients")}</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-bold text-gray-900 dark:text-white">
                {syncOverview.totalProcessed}
              </p>
              <p className="text-xs text-gray-500">{t("totalProcessed")}</p>
            </div>
          </div>
          {syncOverview.uidValidity && (
            <p className="mt-2 text-xs text-gray-400">
              {t("uid", {
                validity: syncOverview.uidValidity,
                uid: syncOverview.highestProcessedUid ?? "–",
              })}
            </p>
          )}
        </div>
      )}

      {/* Period selector + stat cards */}
      <div className="flex items-center gap-2">
        <span className="text-sm text-gray-500">{t("period")}</span>
        {(["7d", "30d", "90d"] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-md px-3 py-1 text-sm ${
              period === p
                ? "bg-brand-100 font-medium text-brand-700 dark:bg-tt-gran-lys dark:text-brand-300"
                : "text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
            }`}
          >
            {p === "7d" ? t("days7") : p === "30d" ? t("days30") : t("days90")}
          </button>
        ))}
      </div>

      {hitRate && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            label={t("statReceived")}
            value={hitRate.totalEmails}
            icon={Mail}
            color="blue"
          />
          <StatCard
            label={t("statCreated")}
            value={hitRate.tasksCreated}
            icon={CheckCircle}
            color="green"
          />
          <StatCard
            label={t("statFiltered")}
            value={hitRate.emailsFiltered}
            icon={Filter}
            color="purple"
          />
        </div>
      )}

      {/* Hit Rate Chart */}
      <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
          <BarChart3 className="h-4 w-4" />
          {t("hitRate")}
        </h3>
        {hitRateLoading ? (
          <div className="flex justify-center py-8">
            <InlineSpinner className="h-6 w-6" />
          </div>
        ) : (
          <HitRateChart data={hitRate?.dailyBreakdown ?? []} />
        )}
      </div>

      {/* False Positive Rate */}
      {fpRate && fpRate.totalReviewed > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <ShieldCheck className="h-4 w-4" />
            {t("falsePositive")}
          </h3>
          <div className="flex items-center gap-4">
            <div className="flex-1">
              <div className="mb-1 flex justify-between text-sm">
                <span className="text-gray-500">
                  {t("markedIrrelevant", {
                    irrelevant: fpRate.irrelevantCount,
                    total: fpRate.totalReviewed,
                  })}
                </span>
                <span className="font-medium text-gray-900 dark:text-white">
                  {fpRate.falsePositiveRate}%
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-600">
                <div
                  className={`h-full rounded-full ${
                    fpRate.falsePositiveRate > 30
                      ? "bg-red-500"
                      : fpRate.falsePositiveRate > 15
                        ? "bg-yellow-500"
                        : "bg-green-500"
                  }`}
                  style={{
                    width: `${Math.min(100, fpRate.falsePositiveRate)}%`,
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Top Senders */}
      {topSenders && topSenders.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <Users className="h-4 w-4" />
            {t("topSenders")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 font-medium">{t("colSender")}</th>
                  <th className="pb-2 text-right font-medium">
                    {t("colEmails")}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("colTasks")}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("colHitRate")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {topSenders.map((sender) => (
                  <tr
                    key={sender.fromEmail}
                    className="border-t border-gray-100 dark:border-gray-700"
                  >
                    <td className="py-2 text-gray-900 dark:text-white">
                      {sender.fromEmail}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {sender.emailCount}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {sender.taskCount}
                    </td>
                    <td className="py-2 text-right font-medium text-gray-900 dark:text-white">
                      {sender.emailCount > 0
                        ? Math.round(
                            (sender.taskCount / sender.emailCount) * 100,
                          )
                        : 0}
                      %
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Filter Rules Effectiveness */}
      {filterRules && filterRules.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-white">
            <TrendingUp className="h-4 w-4" />
            {t("effectiveness")}
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 dark:text-gray-400">
                  <th className="pb-2 font-medium">{t("colRule")}</th>
                  <th className="pb-2 font-medium">{t("colPattern")}</th>
                  <th className="pb-2 text-right font-medium">
                    {t("colMatches")}
                  </th>
                  <th className="pb-2 text-right font-medium">
                    {t("colStatus")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filterRules.map((rule) => (
                  <tr
                    key={rule.id}
                    className="border-t border-gray-100 dark:border-gray-700"
                  >
                    <td className="py-2 text-gray-500">
                      {rule.ruleType === "sender_email"
                        ? t("ruleSender")
                        : rule.ruleType === "sender_domain"
                          ? t("ruleDomain")
                          : t("ruleSubject")}
                    </td>
                    <td className="py-2 font-mono text-xs text-gray-900 dark:text-white">
                      {rule.pattern}
                    </td>
                    <td className="py-2 text-right text-gray-500">
                      {rule.matchCount}
                    </td>
                    <td className="py-2 text-right">
                      {rule.isActive ? (
                        <span className="text-green-600">{t("active")}</span>
                      ) : (
                        <span className="text-gray-400">{t("inactive")}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Confidence Distribution */}
      {confidenceDist && confidenceDist.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-800">
          <h3 className="mb-3 text-sm font-semibold text-gray-900 dark:text-white">
            {t("confidence")}
          </h3>
          <div className="space-y-2">
            {confidenceDist
              .sort((a, b) => b.bucket.localeCompare(a.bucket))
              .map((bucket) => {
                const maxCount = Math.max(
                  ...confidenceDist.map((b) => b.count),
                );
                const width =
                  maxCount > 0 ? (bucket.count / maxCount) * 100 : 0;
                return (
                  <div key={bucket.bucket} className="flex items-center gap-3">
                    <span className="w-16 text-xs text-gray-500">
                      {bucket.bucket}
                    </span>
                    <div className="flex-1">
                      <div className="h-4 overflow-hidden rounded bg-gray-100 dark:bg-gray-700">
                        <div
                          className="h-full rounded bg-brand-500"
                          style={{ width: `${width}%` }}
                        />
                      </div>
                    </div>
                    <span className="w-10 text-right text-xs font-medium text-gray-900 dark:text-white">
                      {bucket.count}
                    </span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
