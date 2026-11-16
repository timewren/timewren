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
import type { BillingFilter } from "@/components/import/ImportPage";
import { trpc } from "@/providers/trpc-provider";

interface FileUploadState {
  customers: File | null;
  users: File | null;
  tasks: File | null;
  prepaidPlans: File | null;
  planTemplates: File | null;
  labels: File | null;
}

export default function ImportEffihubPage() {
  const t = useTranslations("integrations.effihub");
  const tPage = useTranslations("importer.page");
  const router = useRouter();
  const searchParams = useSearchParams();
  const isOnboarding = searchParams.get("onboarding") === "true";

  const [files, setFiles] = useState<FileUploadState>({
    customers: null,
    users: null,
    tasks: null,
    prepaidPlans: null,
    planTemplates: null,
    labels: null,
  });
  const [billingFilter, setBillingFilter] = useState<BillingFilter>("all");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<{
    success: boolean;
    message: string;
    stats?: {
      clients: number;
      clientsEnriched: number;
      prepaidPackages: number;
      timeEntries: number;
      timeEntriesBilled: number;
      timeEntriesSkipped: number;
      timeEntriesFilteredOut: number;
      totalHoursImported: number;
    };
  } | null>(null);

  // Update onboarding progress mutation
  const updateOnboardingMutation =
    trpc.onboarding.updateImportInfo.useMutation();

  const importMutation = trpc.integrations.importEffihub.useMutation({
    onSuccess: async (data) => {
      setImportResult({
        success: true,
        message: tPage("success"),
        stats: data,
      });
      setIsImporting(false);

      // If coming from onboarding, update progress and redirect back
      if (isOnboarding) {
        try {
          await updateOnboardingMutation.mutateAsync({
            importSource: "effihub",
            clientsImported: data.clients,
            timeEntriesImported: data.timeEntries,
            prepaidPackagesImported: data.prepaidPackages,
          });

          // Wait a moment to show success message, then redirect
          setTimeout(() => {
            router.push("/dashboard/onboarding?step=complete");
          }, 2000);
        } catch (error) {
          console.error("Failed to update onboarding:", error);
          // Still redirect even if onboarding update fails
          setTimeout(() => {
            router.push("/dashboard/onboarding?step=complete");
          }, 2000);
        }
      }
    },
    onError: (error) => {
      setImportResult({
        success: false,
        message: error.message || tPage("failed"),
      });
      setIsImporting(false);
    },
  });

  const handleFileChange = (key: keyof FileUploadState, file: File | null) => {
    setFiles((prev) => ({ ...prev, [key]: file }));
    setImportResult(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!files.customers || !files.tasks) {
      alert(t("minFiles"));
      return;
    }

    setIsImporting(true);

    try {
      // Read all files as text
      const customersText = await files.customers.text();
      const usersText = files.users ? await files.users.text() : null;
      const tasksText = await files.tasks.text();
      const prepaidPlansText = files.prepaidPlans
        ? await files.prepaidPlans.text()
        : null;
      const planTemplatesText = files.planTemplates
        ? await files.planTemplates.text()
        : null;
      const labelsText = files.labels ? await files.labels.text() : null;

      await importMutation.mutateAsync({
        customersCSV: customersText,
        usersCSV: usersText,
        tasksCSV: tasksText,
        prepaidPlansCSV: prepaidPlansText,
        planTemplatesCSV: planTemplatesText,
        labelsCSV: labelsText,
        billingFilter,
      });
    } catch (error) {
      console.error("Import error:", error);
      setIsImporting(false);
    }
  };

  const canImport =
    (files.customers !== null || files.tasks !== null) && !isImporting;

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white">
            {t("title")}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-gray-400">
            {t("description")}
          </p>
        </div>
        <Link
          href={
            isOnboarding ? "/dashboard/onboarding" : "/dashboard/integrations"
          }
          className="text-sm text-brand-600 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          {isOnboarding
            ? tPage("backToOnboarding")
            : tPage("backToIntegrations")}
        </Link>
      </div>

      {/* Onboarding Info */}
      {isOnboarding && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-950">
          <div className="flex items-start gap-3">
            <Check className="h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
            <div className="text-sm text-gray-700 dark:text-gray-300">
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {tPage("onboardingMode")}
              </p>
              <p className="mt-1">{tPage("onboardingNote")}</p>
            </div>
          </div>
        </div>
      )}

      {/* Instructions */}
      <div className="rounded-lg border border-brand-200 bg-brand-50 p-6 dark:border-brand-600 dark:bg-tt-gran-lys">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-brand-600 dark:text-brand-400" />
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {t("instructionsTitle")}
            </p>
            <ol className="mt-2 list-inside list-decimal space-y-1">
              <li>{t("step1")}</li>
              <li>{t("step2")}</li>
              <li>{t("step3")}</li>
              <li>{t("step4")}</li>
            </ol>
            <p className="mt-3 text-gray-600 dark:text-gray-400">
              {t.rich("minimum", { b: (chunks) => <strong>{chunks}</strong> })}
            </p>
          </div>
        </div>
      </div>

      {/* Upload Form */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-gray-200/80 bg-white p-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <h2 className="mb-6 text-sm font-semibold text-gray-900 dark:text-white">
          {t("uploadCsv")}
        </h2>

        <div className="space-y-4">
          <FileUploadField
            id="customers-upload"
            label={t("field.customers")}
            required
            accept=".csv"
            fileName="effihub-customers.csv"
            file={files.customers}
            onChange={(file) => handleFileChange("customers", file)}
          />

          <FileUploadField
            id="tasks-upload"
            label={t("field.tasks")}
            required
            accept=".csv"
            fileName="effihub-tasks.csv"
            file={files.tasks}
            onChange={(file) => handleFileChange("tasks", file)}
          />

          <FileUploadField
            id="prepaid-upload"
            label={t("field.prepaid")}
            accept=".csv"
            fileName="effihub-prepaid-plans.csv"
            file={files.prepaidPlans}
            onChange={(file) => handleFileChange("prepaidPlans", file)}
          />

          <FileUploadField
            id="users-upload"
            label={t("field.users")}
            accept=".csv"
            fileName="effihub-users.csv"
            file={files.users}
            onChange={(file) => handleFileChange("users", file)}
          />

          <FileUploadField
            id="templates-upload"
            label={t("field.templates")}
            accept=".csv"
            fileName="effihub-plan-templates.csv"
            file={files.planTemplates}
            onChange={(file) => handleFileChange("planTemplates", file)}
          />

          <FileUploadField
            id="labels-upload"
            label={t("field.labels")}
            accept=".csv"
            fileName="effihub-labels.csv"
            file={files.labels}
            onChange={(file) => handleFileChange("labels", file)}
          />
        </div>

        {/* Billing filter */}
        <div className="mt-6 rounded-lg border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-800/50">
          <span className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
            <Receipt className="mr-1 inline h-4 w-4" />
            {tPage("billingFilter")}
          </span>
          <div className="flex flex-col gap-2">
            {(
              [
                ["all", tPage("filter.all")],
                ["unbilled", tPage("filter.unbilled")],
                ["billed", tPage("filter.billed")],
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
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            {t("filterNote")}
          </p>
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
            {importResult.stats && (
              <div className="mt-3 space-y-1 text-sm">
                <p>
                  {t("result.clients", { count: importResult.stats.clients })}
                  {importResult.stats.clientsEnriched > 0 && (
                    <span className="ml-1 text-xs opacity-75">
                      {t("result.enriched", {
                        count: importResult.stats.clientsEnriched,
                      })}
                    </span>
                  )}
                </p>
                <p>
                  {t("result.prepaid", {
                    count: importResult.stats.prepaidPackages,
                  })}
                </p>
                <p>
                  {tPage("result.timeEntries", {
                    count: importResult.stats.timeEntries,
                  })}
                  {importResult.stats.timeEntriesBilled > 0 && (
                    <span className="ml-1 text-xs opacity-75">
                      {t("result.billed", {
                        count: importResult.stats.timeEntriesBilled,
                      })}
                    </span>
                  )}
                </p>
                {importResult.stats.timeEntriesSkipped > 0 && (
                  <p className="opacity-75">
                    {t("result.skipped", {
                      count: importResult.stats.timeEntriesSkipped,
                    })}
                  </p>
                )}
                {importResult.stats.timeEntriesFilteredOut > 0 && (
                  <p className="opacity-75">
                    {t("result.filtered", {
                      count: importResult.stats.timeEntriesFilteredOut,
                    })}
                  </p>
                )}
                <p className="mt-2 font-medium">
                  {tPage("result.totalHours", {
                    hours: importResult.stats.totalHoursImported,
                  })}
                </p>
              </div>
            )}
          </div>
        )}

        {/* Submit Button */}
        <div className="mt-6 flex items-center gap-4">
          <button
            type="submit"
            disabled={!canImport}
            className="flex items-center gap-2 rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran transition-colors hover:bg-tt-gran-moerk disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isImporting ? (
              <>
                <Loader2 className="h-5 w-5 animate-spin" />
                {tPage("importing")}
              </>
            ) : (
              <>
                <Upload className="h-5 w-5" />
                {tPage("start")}
              </>
            )}
          </button>

          {isImporting && (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {tPage("mayTakeAWhile")}
            </p>
          )}
        </div>
      </form>

      {/* Warning */}
      <div className="rounded-lg border border-orange-200 bg-orange-50 p-4 dark:border-orange-800 dark:bg-orange-950">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 shrink-0 text-orange-600 dark:text-orange-400" />
          <div className="text-sm text-gray-700 dark:text-gray-300">
            <p className="font-medium text-gray-900 dark:text-gray-100">
              {tPage("warnTitle")}
            </p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>{tPage("warn1")}</li>
              <li>{tPage("warn2")}</li>
              <li>{tPage("warn3")}</li>
              <li>{t("warn4")}</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

interface FileUploadFieldProps {
  id: string;
  label: string;
  required?: boolean;
  accept: string;
  fileName: string;
  file: File | null;
  onChange: (file: File | null) => void;
}

function FileUploadField({
  id,
  label,
  required = false,
  accept,
  fileName,
  file,
  onChange,
}: FileUploadFieldProps) {
  const tPage = useTranslations("importer.page");
  return (
    <div>
      <label
        htmlFor={id}
        className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300"
      >
        {label}{" "}
        {required && <span className="text-red-600 dark:text-red-400">*</span>}
      </label>
      <div className="flex items-center gap-3">
        <label
          htmlFor={id}
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:bg-gray-800"
        >
          <FileUp className="h-4 w-4" />
          {tPage("chooseFile")}
          <input
            id={id}
            type="file"
            accept={accept}
            className="hidden"
            onChange={(e) => {
              const selectedFile = e.target.files?.[0] || null;
              onChange(selectedFile);
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
              onClick={() => onChange(null)}
              className="text-red-600 hover:text-red-700"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ) : (
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {fileName}
          </span>
        )}
      </div>
    </div>
  );
}
