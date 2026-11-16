"use client";

import {
  AlertCircle,
  Check,
  FileUp,
  Loader2,
  Receipt,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { DateFormat } from "@/lib/import-parsers/date-parser";
import { trpc } from "@/providers/trpc-provider";

export type BillingFilter = "all" | "unbilled" | "billed";

interface ImportPageProps {
  title: string;
  description: string;
  instructions: { title: string; steps: string[] };
  fileAccept: string;
  fileLabel: string;
  /** Type of data: determines which stats are shown */
  importType: "time" | "tasks";
  /** Called when user submits the file */
  onImport: (
    fileContent: string,
    dateFormat?: DateFormat,
    billingFilter?: BillingFilter,
    markAllAsBilled?: boolean,
  ) => Promise<TimeImportResult | TaskImportResult>;
  /** Whether to show date format picker (for Clockify/Toggl) */
  showDateFormatPicker?: boolean;
  /** Whether to show billing filter (for sources that detect isBilled) */
  showBillingFilter?: boolean;
  /** Whether to show "mark all as billed" checkbox (for sources without billing info) */
  showMarkAllAsBilled?: boolean;
  /** Extra info shown in the warning section */
  extraWarnings?: string[];
  /** Import source name for onboarding tracking */
  importSource?: string;
}

export interface TimeImportResult {
  type: "time";
  clients: number;
  projects: number;
  timeEntries: number;
  timeEntriesBilled: number;
  timeEntriesSkipped: number;
  timeEntriesFilteredOut?: number;
  totalHoursImported: number;
}

export interface TaskImportResult {
  type: "tasks";
  projects: number;
  tasks: number;
  subtasks: number;
  tasksSkipped: number;
}

export function ImportPage({
  title,
  description,
  instructions,
  fileAccept,
  fileLabel,
  onImport,
  showDateFormatPicker = false,
  showBillingFilter = false,
  showMarkAllAsBilled = false,
  extraWarnings = [],
  importSource = "manual",
}: ImportPageProps) {
  const t = useTranslations("importer.page");
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "true";

  const [file, setFile] = useState<File | null>(null);
  const [dateFormat, setDateFormat] = useState<DateFormat | "">("");
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [markAllAsBilled, setMarkAllAsBilled] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
    data?: TimeImportResult | TaskImportResult;
  } | null>(null);

  const updateOnboardingMutation =
    trpc.onboarding.updateImportInfo.useMutation();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) return;

    if (showDateFormatPicker && !dateFormat) {
      setImportResult({
        success: false,
        message: t("pickDateFormat"),
      });
      return;
    }

    setIsImporting(true);
    setImportResult(null);

    try {
      const content = await file.text();
      const result = await onImport(
        content,
        dateFormat ? (dateFormat as DateFormat) : undefined,
        billingFilter,
        markAllAsBilled,
      );

      setImportResult({
        success: true,
        message: t("success"),
        data: result,
      });

      // If onboarding, update progress and redirect
      if (isOnboarding) {
        try {
          await updateOnboardingMutation.mutateAsync({
            importSource: importSource as "effihub",
            clientsImported: result.type === "time" ? result.clients : 0,
            projectsImported: result.projects,
            timeEntriesImported:
              result.type === "time" ? result.timeEntries : 0,
          });
        } catch {
          // Still redirect even if onboarding update fails
        }
        setTimeout(() => {
          router.push("/dashboard/onboarding?step=complete");
        }, 2000);
      }
    } catch (error) {
      setImportResult({
        success: false,
        message: error instanceof Error ? error.message : t("failed"),
      });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {title}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">{description}</p>
        </div>
        <Link
          href={
            isOnboarding ? "/dashboard/onboarding" : "/dashboard/integrations"
          }
          className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          {isOnboarding ? t("backToOnboarding") : t("backToIntegrations")}
        </Link>
      </div>

      {/* Onboarding Info */}
      {isOnboarding && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
          <div className="flex items-start gap-3">
            <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {t("onboardingMode")}
              </p>
              <p className="mt-1">{t("onboardingNote")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="rounded-xl border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {instructions.title}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              {instructions.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
          {t("uploadFile")}
        </h2>

        <div className="space-y-4">
          {/* File picker */}
          <div>
            <label
              htmlFor="import-file"
              className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              {fileLabel}{" "}
              <span className="text-red-600 dark:text-red-400">*</span>
            </label>
            <div className="flex items-center gap-3">
              <label
                htmlFor="import-file"
                className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <FileUp className="h-4 w-4" />
                {t("chooseFile")}
                <input
                  id="import-file"
                  type="file"
                  accept={fileAccept}
                  className="hidden"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null);
                    setImportResult(null);
                  }}
                />
              </label>
              {file ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {file.name}
                  </span>
                  <button
                    type="button"
                    onClick={() => setFile(null)}
                    className="text-red-600 hover:text-red-700"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-500 dark:text-gray-400">
                  {t("noFile")}
                </span>
              )}
            </div>
          </div>

          {/* Date format picker */}
          {showDateFormatPicker && (
            <div>
              <label
                htmlFor="date-format"
                className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
              >
                {t("dateFormat")}{" "}
                <span className="text-red-600 dark:text-red-400">*</span>
              </label>
              <select
                id="date-format"
                value={dateFormat}
                onChange={(e) =>
                  setDateFormat(e.target.value as DateFormat | "")
                }
                className="w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
              >
                <option value="">{t("chooseFormat")}</option>
                <option value="YYYY-MM-DD">YYYY-MM-DD (2024-01-31)</option>
                <option value="DD/MM/YYYY">DD/MM/YYYY (31/01/2024)</option>
                <option value="MM/DD/YYYY">MM/DD/YYYY (01/31/2024)</option>
                <option value="DD.MM.YYYY">DD.MM.YYYY (31.01.2024)</option>
              </select>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("dateFormatHint")}
              </p>
            </div>
          )}

          {/* Billing filter (for sources with billing info) */}
          {showBillingFilter && (
            <div>
              <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                <Receipt className="mr-1 inline h-4 w-4" />
                {t("billingFilter")}
              </span>
              <div className="flex flex-col gap-2">
                {(
                  [
                    ["all", t("filter.all")],
                    ["unbilled", t("filter.unbilled")],
                    ["billed", t("filter.billed")],
                  ] as const
                ).map(([value, label]) => (
                  <label
                    key={value}
                    className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    <input
                      type="radio"
                      name="billingFilter"
                      value={value}
                      checked={billingFilter === value}
                      onChange={() => setBillingFilter(value)}
                      className="text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                    />
                    {label}
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                {t("billingFilterHint")}
              </p>
            </div>
          )}

          {/* Mark all as billed checkbox (for sources without billing info) */}
          {showMarkAllAsBilled && (
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={markAllAsBilled}
                  onChange={(e) => setMarkAllAsBilled(e.target.checked)}
                  className="rounded text-brand-600 dark:text-brand-400 focus:ring-brand-500"
                />
                <Receipt className="h-4 w-4" />
                {t("markAllBilled")}
              </label>
              <p className="mt-1 ml-6 text-xs text-gray-500 dark:text-gray-400">
                {t("markAllBilledHint")}
              </p>
            </div>
          )}
        </div>

        {/* Import Result */}
        {importResult && (
          <div
            className={`mt-6 rounded-lg p-4 ${
              importResult.success
                ? "bg-green-50 text-green-800 dark:bg-green-950 dark:text-green-200"
                : "bg-red-50 text-red-800 dark:bg-red-950 dark:text-red-200"
            }`}
          >
            <div className="flex items-center gap-2">
              {importResult.success ? (
                <Check className="h-5 w-5" />
              ) : (
                <X className="h-5 w-5" />
              )}
              <p className="font-medium">{importResult.message}</p>
            </div>
            {importResult.data && importResult.data.type === "time" && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  {t("result.clients", { count: importResult.data.clients })}
                </p>
                <p>
                  {t("result.projects", { count: importResult.data.projects })}
                </p>
                <p>
                  {t("result.timeEntries", {
                    count: importResult.data.timeEntries,
                  })}
                  {importResult.data.timeEntriesBilled > 0 && (
                    <span className="ml-1 text-xs opacity-75">
                      {t("result.billedSplit", {
                        billed: importResult.data.timeEntriesBilled,
                        unbilled:
                          importResult.data.timeEntries -
                          importResult.data.timeEntriesBilled,
                      })}
                    </span>
                  )}
                </p>
                {importResult.data.timeEntriesSkipped > 0 && (
                  <p className="opacity-75">
                    {t("result.skippedRows", {
                      count: importResult.data.timeEntriesSkipped,
                    })}
                  </p>
                )}
                {(importResult.data.timeEntriesFilteredOut ?? 0) > 0 && (
                  <p className="opacity-75">
                    {t("result.filteredRows", {
                      count: importResult.data.timeEntriesFilteredOut ?? 0,
                    })}
                  </p>
                )}
                <p className="mt-2 font-medium">
                  {t("result.totalHours", {
                    hours: importResult.data.totalHoursImported,
                  })}
                </p>
              </div>
            )}
            {importResult.data && importResult.data.type === "tasks" && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  {t("result.projects", { count: importResult.data.projects })}
                </p>
                <p>{t("result.tasks", { count: importResult.data.tasks })}</p>
                {importResult.data.subtasks > 0 && (
                  <p>
                    {t("result.subtasks", {
                      count: importResult.data.subtasks,
                    })}
                  </p>
                )}
                {importResult.data.tasksSkipped > 0 && (
                  <p className="opacity-75">
                    {t("result.tasksSkipped", {
                      count: importResult.data.tasksSkipped,
                    })}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="mt-6 flex items-center gap-4">
          <button
            type="submit"
            disabled={!file || isImporting}
            className="flex items-center gap-2 rounded-lg bg-tt-gran px-4 py-2 text-sm font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {t("importing")}
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                {t("start")}
              </>
            )}
          </button>
          {isImporting && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t("mayTakeAWhile")}
            </p>
          )}
        </div>
      </form>

      {/* Warning */}
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-900/20">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {t("warnTitle")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{t("warn1")}</li>
              <li>{t("warn2")}</li>
              <li>{t("warn3")}</li>
              {extraWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
