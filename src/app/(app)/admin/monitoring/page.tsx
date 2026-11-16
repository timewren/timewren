"use client";

import {
  AlertTriangle,
  CheckCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Mail,
  Server,
  Timer,
  TrendingUp,
  Users,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { RefreshIndicator } from "@/components/admin";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

const REFRESH_INTERVAL = 30_000;

type Section = "health" | "cron" | "email";

export default function MonitoringPage() {
  const t = useTranslations("adminMonitoring");
  const locale = useLocale();
  const [activeSection, setActiveSection] = useState<Section>("health");
  const [cronPage, setCronPage] = useState(0);
  const [selectedJob, setSelectedJob] = useState<string | undefined>(undefined);
  const [selectedCronStatus, setSelectedCronStatus] = useState<
    "success" | "error" | "partial" | undefined
  >(undefined);
  const [emailPage, setEmailPage] = useState(0);
  const [selectedTemplate, setSelectedTemplate] = useState<string | undefined>(
    undefined,
  );
  const [selectedEmailStatus, setSelectedEmailStatus] = useState<
    "sent" | "delivered" | "bounced" | "failed" | undefined
  >(undefined);
  const [daysBack, setDaysBack] = useState(7);
  const cronLimit = 20;
  const emailLimit = 20;

  const utils = trpc.useUtils();

  // System health queries
  const {
    data: activeSessions,
    isLoading: loadingSessions,
    dataUpdatedAt,
  } = trpc.admin.getActiveSessions.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
  });
  const { data: systemHealth } = trpc.admin.getSystemHealth.useQuery(
    undefined,
    { refetchInterval: REFRESH_INTERVAL },
  );
  const { data: cronHealth } = trpc.admin.getCronJobHealth.useQuery(undefined, {
    refetchInterval: REFRESH_INTERVAL,
  });
  const { data: errorSummary } = trpc.admin.getErrorSummary.useQuery(
    { daysBack: 7 },
    { refetchInterval: REFRESH_INTERVAL },
  );

  // Cron job queries
  const { data: cronLogs, isLoading: loadingCron } =
    trpc.admin.getCronJobLogs.useQuery(
      {
        limit: cronLimit,
        offset: cronPage * cronLimit,
        jobName: selectedJob,
        status: selectedCronStatus,
      },
      {
        refetchInterval: REFRESH_INTERVAL,
        enabled: activeSection === "cron" || activeSection === "health",
      },
    );

  // Email queries
  const { data: emailStats, isLoading: loadingEmail } =
    trpc.admin.getEmailDeliveryStats.useQuery(
      {
        limit: emailLimit,
        offset: emailPage * emailLimit,
        templateType: selectedTemplate,
        status: selectedEmailStatus,
        daysBack,
      },
      {
        refetchInterval: 60_000,
        enabled: activeSection === "email" || activeSection === "health",
      },
    );

  const handleRefresh = () => {
    utils.admin.getActiveSessions.invalidate();
    utils.admin.getCronJobLogs.invalidate();
    utils.admin.getEmailDeliveryStats.invalidate();
    utils.admin.getSystemHealth.invalidate();
    utils.admin.getCronJobHealth.invalidate();
    utils.admin.getErrorSummary.invalidate();
  };

  const healthColor =
    systemHealth?.status === "healthy"
      ? "green"
      : systemHealth?.status === "degraded"
        ? "amber"
        : "red";
  const allErrors = [
    ...(errorSummary?.cronErrors ?? []),
    ...(errorSummary?.emailErrors ?? []),
  ].sort(
    (a, b) =>
      new Date(b.lastOccurrence).getTime() -
      new Date(a.lastOccurrence).getTime(),
  );

  const formatDate = (date: Date | string | null) => {
    if (!date) return "-";
    return new Date(date).toLocaleString(toIntlLocale(locale), {
      dateStyle: "short",
      timeStyle: "short",
    });
  };

  const sections: {
    key: Section;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
  }[] = [
    { key: "health", label: t("page.sections.health"), icon: Server },
    { key: "cron", label: t("page.sections.cron"), icon: Clock },
    { key: "email", label: t("page.sections.email"), icon: Mail },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-semibold text-gray-900">
            {t("page.title")}
          </h1>
          {systemHealth && (
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium ${
                healthColor === "green"
                  ? "bg-green-100 text-green-700"
                  : healthColor === "amber"
                    ? "bg-amber-100 text-amber-700"
                    : "bg-red-100 text-red-700"
              }`}
            >
              {healthColor === "green" && <CheckCircle2 className="h-4 w-4" />}
              {healthColor === "amber" && <AlertTriangle className="h-4 w-4" />}
              {healthColor === "red" && <XCircle className="h-4 w-4" />}
              {t("page.healthy", { score: systemHealth.overallScore })}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/admin/monitoring/cron"
            className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            <Clock className="h-4 w-4" />
            {t("page.cronDashboard")}
            <ExternalLink className="h-3 w-3 text-gray-400" />
          </Link>
          <RefreshIndicator
            lastUpdated={dataUpdatedAt ? new Date(dataUpdatedAt) : undefined}
            onRefresh={handleRefresh}
            intervalMs={REFRESH_INTERVAL}
          />
        </div>
      </div>

      {/* Section tabs */}
      <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
        {sections.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => setActiveSection(s.key)}
            className={`flex items-center gap-2 rounded-md px-4 py-2 text-sm font-medium transition-colors ${
              activeSection === s.key
                ? "bg-white text-gray-900 shadow"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            <s.icon className="h-4 w-4" /> {s.label}
          </button>
        ))}
      </div>

      {/* System Health Section */}
      {activeSection === "health" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {[
              {
                icon: Users,
                color: "green",
                label: t("page.tiles.activeSessions"),
                value: activeSessions?.activeSessions ?? 0,
                loading: loadingSessions,
              },
              {
                icon: TrendingUp,
                color: "blue",
                label: t("page.tiles.sessions24h"),
                value: activeSessions?.sessionsLast24Hours ?? 0,
                loading: loadingSessions,
              },
              {
                icon: Timer,
                color: "amber",
                label: t("page.tiles.activeTimers"),
                value: activeSessions?.activeTimers ?? 0,
                loading: loadingSessions,
              },
              {
                icon: Mail,
                color: "purple",
                label: t("page.tiles.emailsSent7d"),
                value: emailStats?.total ?? 0,
                loading: loadingEmail,
              },
            ].map(({ icon: Icon, color, label, value, loading }) => (
              <div
                key={label}
                className="rounded-lg border border-gray-200 bg-white p-6"
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`flex h-10 w-10 items-center justify-center rounded-full bg-${color}-100`}
                  >
                    <Icon className={`h-5 w-5 text-${color}-600`} />
                  </div>
                  <div>
                    <p className="text-sm text-gray-600">{label}</p>
                    <p className="text-2xl font-bold text-gray-900">
                      {loading ? "..." : value}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Cron Job Health Grid */}
          {cronHealth && cronHealth.length > 0 && (
            <div className="rounded-lg border border-gray-200 bg-white">
              <div className="flex items-center gap-2 border-b border-gray-200 p-4">
                <Server className="h-5 w-5 text-gray-500" />
                <h2 className="font-semibold text-gray-900">
                  {t("page.cronHealth.title")}
                </h2>
              </div>
              <div className="grid gap-4 p-4 md:grid-cols-2 lg:grid-cols-3">
                {cronHealth.map((job) => {
                  const isHealthy = job.successRate >= 90;
                  const isDegraded =
                    job.successRate >= 70 && job.successRate < 90;
                  return (
                    <div
                      key={job.jobName}
                      className="rounded-lg border border-gray-200 p-4"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-sm font-medium text-gray-900">
                          {job.jobName}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${isHealthy ? "bg-green-100 text-green-700" : isDegraded ? "bg-amber-100 text-amber-700" : "bg-red-100 text-red-700"}`}
                        >
                          {job.successRate}%
                        </span>
                      </div>
                      <div className="space-y-1 text-xs text-gray-500">
                        <div className="flex justify-between">
                          <span>{t("page.cronHealth.runs")}</span>
                          <span>
                            {job.successes}
                            <span className="text-green-500">
                              {" "}
                              {t("page.cronHealth.ok")}
                            </span>{" "}
                            / {job.errors}
                            <span className="text-red-500">
                              {" "}
                              {t("page.cronHealth.errors")}
                            </span>
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span>{t("page.cronHealth.avgDuration")}</span>
                          <span>{job.avgDurationMs}ms</span>
                        </div>
                        <div className="flex justify-between">
                          <span>{t("page.cronHealth.lastRun")}</span>
                          <span>{formatDate(job.lastRun)}</span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Error Summary */}
          {allErrors.length > 0 && (
            <div className="rounded-lg border border-red-200 bg-white">
              <div className="flex items-center gap-2 border-b border-red-200 p-4">
                <AlertTriangle className="h-5 w-5 text-red-500" />
                <h2 className="font-semibold text-gray-900">
                  {t("page.errors.title")}
                </h2>
              </div>
              <div className="divide-y divide-gray-200">
                {allErrors.map((error) => (
                  <div
                    key={`${error.source}-${error.message}`}
                    className="flex items-center justify-between p-4"
                  >
                    <div>
                      <p className="text-sm font-medium text-gray-900">
                        {error.source}
                      </p>
                      <p className="text-xs text-gray-500">{error.message}</p>
                    </div>
                    <div className="text-right">
                      <span className="inline-flex rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800">
                        {t("page.errors.count", { count: error.count })}
                      </span>
                      <p className="mt-1 text-xs text-gray-400">
                        {formatDate(error.lastOccurrence)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cron Jobs Section */}
      {activeSection === "cron" && (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-4">
            <select
              value={selectedJob ?? ""}
              onChange={(e) => setSelectedJob(e.target.value || undefined)}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("page.cron.allJobs")}</option>
              {cronLogs?.jobNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
            <select
              value={selectedCronStatus ?? ""}
              onChange={(e) =>
                setSelectedCronStatus(
                  (e.target.value as "success" | "error" | "partial") ||
                    undefined,
                )
              }
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("page.cron.allStatuses")}</option>
              <option value="success">{t("page.cron.filter.success")}</option>
              <option value="error">{t("page.cron.filter.error")}</option>
              <option value="partial">{t("page.cron.filter.partial")}</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {loadingCron ? (
              <div className="flex items-center justify-center py-12">
                <InlineSpinner className="h-8 w-8" />
              </div>
            ) : cronLogs?.logs.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Server className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2">{t("page.cron.empty")}</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.job")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.status")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.started")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.duration")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.items")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.cron.columns.errors")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {cronLogs?.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4">
                        <div className="flex items-center gap-2">
                          <Server className="h-4 w-4 text-gray-400" />
                          <span className="font-medium text-gray-900">
                            {log.jobName}
                          </span>
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${log.status === "success" ? "bg-green-100 text-green-800" : log.status === "error" ? "bg-red-100 text-red-800" : "bg-amber-100 text-amber-800"}`}
                        >
                          {log.status === "success" ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {t.has(`page.cron.status.${log.status}`)
                            ? t(`page.cron.status.${log.status}`)
                            : log.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(log.startedAt)}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {log.durationMs ? `${log.durationMs}ms` : "-"}
                        </div>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm">
                        <span className="text-green-600">
                          {log.itemsSucceeded ?? 0}
                        </span>
                        <span className="text-gray-400"> / </span>
                        <span className="text-gray-600">
                          {log.itemsProcessed ?? 0}
                        </span>
                      </td>
                      <td className="max-w-xs truncate px-6 py-4 text-sm text-red-600">
                        {log.errorMessage || "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {cronLogs && cronLogs.total > cronLimit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {t("page.showing", {
                  from: cronPage * cronLimit + 1,
                  to: Math.min((cronPage + 1) * cronLimit, cronLogs.total),
                  total: cronLogs.total,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setCronPage(cronPage - 1)}
                  disabled={cronPage === 0}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("page.previous")}
                </button>
                <button
                  type="button"
                  onClick={() => setCronPage(cronPage + 1)}
                  disabled={(cronPage + 1) * cronLimit >= cronLogs.total}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("page.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Email Delivery Section */}
      {activeSection === "email" && (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[
              {
                label: t("page.email.sent"),
                value: emailStats?.stats.sent ?? 0,
                color: "green",
              },
              {
                label: t("page.email.delivered"),
                value: emailStats?.stats.delivered ?? 0,
                color: "blue",
              },
              {
                label: t("page.email.bounced"),
                value: emailStats?.stats.bounced ?? 0,
                color: "red",
              },
              {
                label: t("page.email.failed"),
                value: emailStats?.stats.failed ?? 0,
                color: "amber",
              },
            ].map(({ label, value, color }) => (
              <div key={label} className={`rounded-lg bg-${color}-50 p-4`}>
                <p className={`text-3xl font-bold text-${color}-600`}>
                  {value}
                </p>
                <p className={`text-sm text-${color}-700`}>{label}</p>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap gap-4">
            <select
              value={daysBack}
              onChange={(e) => {
                setDaysBack(Number(e.target.value));
                setEmailPage(0);
              }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value={1}>{t("page.email.last24h")}</option>
              <option value={7}>{t("page.email.last7d")}</option>
              <option value={30}>{t("page.email.last30d")}</option>
              <option value={90}>{t("page.email.last90d")}</option>
            </select>
            <select
              value={selectedTemplate ?? ""}
              onChange={(e) => {
                setSelectedTemplate(e.target.value || undefined);
                setEmailPage(0);
              }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("page.email.allTemplates")}</option>
              {emailStats?.templateTypes.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
            <select
              value={selectedEmailStatus ?? ""}
              onChange={(e) => {
                setSelectedEmailStatus(
                  (e.target.value as
                    | "sent"
                    | "delivered"
                    | "bounced"
                    | "failed") || undefined,
                );
                setEmailPage(0);
              }}
              className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm"
            >
              <option value="">{t("page.cron.allStatuses")}</option>
              <option value="sent">{t("page.email.sent")}</option>
              <option value="delivered">{t("page.email.delivered")}</option>
              <option value="bounced">{t("page.email.bounced")}</option>
              <option value="failed">{t("page.email.failed")}</option>
            </select>
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
            {loadingEmail ? (
              <div className="flex items-center justify-center py-12">
                <InlineSpinner className="h-8 w-8" />
              </div>
            ) : emailStats?.logs.length === 0 ? (
              <div className="py-12 text-center text-gray-500">
                <Mail className="mx-auto h-12 w-12 text-gray-400" />
                <p className="mt-2">{t("page.email.empty")}</p>
              </div>
            ) : (
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.email.columns.recipient")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.email.columns.subject")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.email.columns.template")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.email.columns.status")}
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                      {t("page.email.columns.sentAt")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {emailStats?.logs.map((log) => (
                    <tr key={log.id} className="hover:bg-gray-50">
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-900">
                        {log.to}
                      </td>
                      <td className="max-w-xs truncate px-6 py-4 text-sm text-gray-600">
                        {log.subject}
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span className="inline-flex rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-800">
                          {log.templateType}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4">
                        <span
                          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            log.status === "delivered"
                              ? "bg-green-100 text-green-800"
                              : log.status === "sent"
                                ? "bg-brand-100 text-brand-800"
                                : log.status === "bounced"
                                  ? "bg-red-100 text-red-800"
                                  : "bg-amber-100 text-amber-800"
                          }`}
                        >
                          {log.status === "delivered" ||
                          log.status === "sent" ? (
                            <CheckCircle className="h-3 w-3" />
                          ) : (
                            <XCircle className="h-3 w-3" />
                          )}
                          {t.has(`page.email.status.${log.status}`)
                            ? t(`page.email.status.${log.status}`)
                            : log.status}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-6 py-4 text-sm text-gray-500">
                        {formatDate(log.sentAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {emailStats && emailStats.total > emailLimit && (
            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-600">
                {t("page.showing", {
                  from: emailPage * emailLimit + 1,
                  to: Math.min((emailPage + 1) * emailLimit, emailStats.total),
                  total: emailStats.total,
                })}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEmailPage(emailPage - 1)}
                  disabled={emailPage === 0}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("page.previous")}
                </button>
                <button
                  type="button"
                  onClick={() => setEmailPage(emailPage + 1)}
                  disabled={(emailPage + 1) * emailLimit >= emailStats.total}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  {t("page.next")}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
