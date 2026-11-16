"use client";

import {
  CheckCircle,
  Clock,
  Database,
  Download,
  FileJson,
  FileSpreadsheet,
  ShieldCheck,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/dashboard-nav";
import { DpaCard } from "@/components/settings/DpaCard";
import { UserExportCard } from "@/components/settings/UserExportCard";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { useOrgRole } from "@/hooks/useOrgRole";
import { toIntlLocale } from "@/i18n/format-locale";
import { trpc } from "@/providers/trpc-provider";

type ExportFormat = "json" | "csv";

const STATUS_STYLES: Record<string, { key: string; color: string }> = {
  pending: {
    key: "statusPending",
    color:
      "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  },
  processing: {
    key: "statusProcessing",
    color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  },
  ready: {
    key: "statusReady",
    color:
      "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
  },
  downloaded: {
    key: "statusDownloaded",
    color: "bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300",
  },
  expired: {
    key: "statusExpired",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
  failed: {
    key: "statusFailed",
    color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400",
  },
};

export default function GDPRPage() {
  const t = useTranslations("settingsGdpr");
  const locale = useLocale();
  const [format, setFormat] = useState<ExportFormat>("json");

  const utils = trpc.useUtils();
  // Den gamle JSON/CSV-eksport og data-oversigten er kun for ejere og
  // administratorer (orgAdminProcedure). Alle roller får "Hent dine egne data".
  const { canManage, isResolved } = useOrgRole();
  const showLegacy = isResolved && canManage;

  const { data: dataCounts, isLoading: countsLoading } =
    trpc.dataExport.getDataCounts.useQuery(undefined, { enabled: showLegacy });

  const { data: exportRequests, isLoading: requestsLoading } =
    trpc.dataExport.listExportRequests.useQuery(undefined, {
      enabled: showLegacy,
    });

  const requestExportMutation = trpc.dataExport.requestFullExport.useMutation({
    onSuccess: () => {
      toast.success(t("exportRequested"));
      utils.dataExport.listExportRequests.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const cancelMutation = trpc.dataExport.cancelExportRequest.useMutation({
    onSuccess: () => {
      toast.success(t("requestCancelled"));
      utils.dataExport.listExportRequests.invalidate();
    },
    onError: (error) => {
      toast.error(error.message);
    },
  });

  const handleRequestExport = () => {
    requestExportMutation.mutate({ format });
  };

  const appUrl = typeof window !== "undefined" ? window.location.origin : "";

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <PageHeader title={t("title")} description={t("description")} />

      {/* Dine egne data: alle roller (GDPR art. 15 og 20) */}
      <UserExportCard />

      <DpaCard />

      {/* Section 1: Data Download (ejere og administratorer) */}
      {showLegacy && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-teal-100 dark:bg-teal-900/30">
              <Download className="h-5 w-5 text-teal-600 dark:text-teal-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("fullDownload")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("fullDownloadSub")}
              </p>
            </div>
          </div>

          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t("fullDownloadText")}
          </p>

          <div className="flex items-center gap-4 mb-4">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
              {t("format")}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setFormat("json")}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  format === "json"
                    ? "border-teal-600 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <FileJson className="h-4 w-4" />
                {t("jsonRecommended")}
              </button>
              <button
                type="button"
                onClick={() => setFormat("csv")}
                className={`flex items-center gap-2 rounded-lg border px-4 py-2 text-sm font-medium transition-colors ${
                  format === "csv"
                    ? "border-teal-600 bg-teal-50 dark:bg-teal-900/20 text-teal-700 dark:text-teal-400"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <FileSpreadsheet className="h-4 w-4" />
                {t("csv")}
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={handleRequestExport}
            disabled={requestExportMutation.isPending}
            className="inline-flex items-center gap-2 rounded-lg bg-teal-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-teal-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {requestExportMutation.isPending ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("requesting")}
              </>
            ) : (
              <>
                <ShieldCheck className="h-4 w-4" />
                {t("requestFull")}
              </>
            )}
          </button>

          {/* Export Requests Table */}
          {!requestsLoading && exportRequests && exportRequests.length > 0 && (
            <div className="mt-6">
              <h3 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
                {t("recent")}
              </h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">
                        {t("colDate")}
                      </th>
                      <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">
                        {t("colFormat")}
                      </th>
                      <th className="py-2 pr-4 text-left font-medium text-gray-500 dark:text-gray-400">
                        {t("colStatus")}
                      </th>
                      <th className="py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                        {t("colAction")}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {exportRequests.map((req) => {
                      const style = STATUS_STYLES[req.status];
                      const statusInfo = style
                        ? { label: t(style.key), color: style.color }
                        : {
                            label: req.status,
                            color: "bg-gray-100 text-gray-800",
                          };
                      return (
                        <tr
                          key={req.id}
                          className="border-b border-gray-100 dark:border-gray-700/50"
                        >
                          <td className="py-3 pr-4 text-gray-900 dark:text-white">
                            {new Date(req.createdAt).toLocaleDateString(
                              toIntlLocale(locale),
                              {
                                day: "numeric",
                                month: "short",
                                year: "numeric",
                                hour: "2-digit",
                                minute: "2-digit",
                              },
                            )}
                          </td>
                          <td className="py-3 pr-4 text-gray-600 dark:text-gray-400">
                            {req.format.toUpperCase()}
                          </td>
                          <td className="py-3 pr-4">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusInfo.color}`}
                            >
                              {req.status === "ready" && (
                                <CheckCircle className="h-3 w-3" />
                              )}
                              {req.status === "pending" && (
                                <Clock className="h-3 w-3" />
                              )}
                              {req.status === "failed" && (
                                <XCircle className="h-3 w-3" />
                              )}
                              {statusInfo.label}
                            </span>
                          </td>
                          <td className="py-3">
                            {req.status === "ready" && req.downloadToken && (
                              <a
                                href={`${appUrl}/api/data-export/${req.downloadToken}`}
                                className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
                              >
                                {t("download")}
                              </a>
                            )}
                            {req.status === "pending" && (
                              <button
                                type="button"
                                onClick={() =>
                                  cancelMutation.mutate({ id: req.id })
                                }
                                className="text-red-600 dark:text-red-400 hover:underline text-sm"
                              >
                                {t("cancel")}
                              </button>
                            )}
                            {req.status === "failed" && req.errorMessage && (
                              <span className="text-xs text-red-500 dark:text-red-400">
                                {req.errorMessage}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Section 2: Data Overview (ejere og administratorer) */}
      {showLegacy && (
        <div className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
              <Database className="h-5 w-5 text-brand-600 dark:text-brand-400" />
            </div>
            <div>
              <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
                {t("overview")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("overviewSub")}
              </p>
            </div>
          </div>

          {countsLoading ? (
            <div className="flex items-center justify-center py-8">
              <InlineSpinner className="h-6 w-6" />
            </div>
          ) : dataCounts ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
              {[
                { label: t("countClients"), count: dataCounts.clients },
                { label: t("countProjects"), count: dataCounts.projects },
                { label: t("countEntries"), count: dataCounts.timeEntries },
                { label: t("countTasks"), count: dataCounts.tasks },
                { label: t("countInvoices"), count: dataCounts.invoices },
                { label: t("countPrepaid"), count: dataCounts.prepaidPackages },
              ].map((item) => (
                <div
                  key={item.label}
                  className="rounded-lg border border-gray-100 dark:border-gray-700 p-4"
                >
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {item.label}
                  </p>
                  <p className="text-2xl font-bold text-gray-900 dark:text-white">
                    {item.count}
                  </p>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      {/* Section 3: Deletion Info */}
      <div
        id="sletning"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <h2 className="text-sm font-semibold text-gray-900 dark:text-white mb-4">
          {t("deletionTitle")}
        </h2>
        <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
          {t.rich("deletionText", {
            link: (chunks) => (
              <Link
                href="/dashboard/settings"
                className="text-teal-600 dark:text-teal-400 hover:underline font-medium"
              >
                {chunks}
              </Link>
            ),
          })}
        </p>

        <div className="rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-900/50 p-4">
          <p className="text-sm text-amber-800 dark:text-amber-300">
            {t.rich("retentionNote", {
              b: (chunks) => <strong>{chunks}</strong>,
            })}
          </p>
        </div>

        <div className="mt-4 text-sm text-gray-500 dark:text-gray-400 space-y-1">
          <p>{t("deletionHow")}</p>
          <ul className="list-disc list-inside space-y-1 ml-2">
            <li>{t("deletionProfile")}</li>
            <li>{t("deletionClients")}</li>
            <li>{t("deletionInvoices")}</li>
          </ul>
        </div>
      </div>

      {/* Link to public GDPR page */}
      <div className="text-center">
        <Link
          href="/gdpr"
          className="text-sm text-gray-500 dark:text-gray-400 hover:text-teal-600 dark:hover:text-teal-400"
        >
          {t("policyLink")}
        </Link>
      </div>
    </div>
  );
}
