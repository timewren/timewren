"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  FileSpreadsheet,
  FileWarning,
  Upload,
  X,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { useFocusTrap } from "@/hooks/useFocusTrap";
import {
  type ColumnMapping,
  type CSVRow,
  detectFormat,
  mapRowsToTimeEntries,
  type ParsedTimeEntry,
  parseCSV,
} from "@/lib/utils/csv-import";
import { trpc } from "@/providers/trpc-provider";

interface CSVImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

type ImportStep = "upload" | "mapping" | "preview" | "importing" | "complete";

export function CSVImportModal({
  isOpen,
  onClose,
  onSuccess,
}: CSVImportModalProps) {
  const fid = useId();
  const t = useTranslations("time");
  const tc = useTranslations("common");
  const [step, setStep] = useState<ImportStep>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<CSVRow[]>([]);
  const [mapping, setMapping] = useState<ColumnMapping | null>(null);
  const [detectedFormat, setDetectedFormat] = useState<"effihub" | "unknown">(
    "unknown",
  );
  const [entries, setEntries] = useState<ParsedTimeEntry[]>([]);
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [defaultProjectId, setDefaultProjectId] = useState<string>("");
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: Array<{ row: number; error: string }>;
  } | null>(null);

  // Get projects for default project selection
  const { data: projects } = trpc.projects.list.useQuery();

  const bulkImportMutation = trpc.time.bulkImport.useMutation({
    onSuccess: (result) => {
      setImportResult(result);
      setStep("complete");
    },
    onError: (error) => {
      setStep("preview");
      toast.error(error.message || t("csv.importFailed"));
    },
  });

  const validEntries = useMemo(
    () => entries.filter((e) => e.isValid),
    [entries],
  );
  const invalidEntries = useMemo(
    () => entries.filter((e) => !e.isValid),
    [entries],
  );

  const handleFileUpload = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) return;

      const reader = new FileReader();
      reader.onload = (e) => {
        const content = e.target?.result as string;
        const { headers: parsedHeaders, rows: parsedRows } = parseCSV(content);

        if (parsedHeaders.length === 0 || parsedRows.length === 0) {
          alert(t("csv.readFailed"));
          return;
        }

        setHeaders(parsedHeaders);
        setRows(parsedRows);

        // Try to auto-detect format
        const { format, mapping: autoMapping } = detectFormat(parsedHeaders);
        setDetectedFormat(format);

        if (autoMapping) {
          setMapping(autoMapping);
          // Auto-parse entries with detected mapping
          const parsed = mapRowsToTimeEntries(parsedRows, autoMapping);
          setEntries(parsed);
          setStep("preview"); // Skip mapping step for known formats
        } else {
          setStep("mapping");
        }
      };
      reader.readAsText(file);
    },
    [t],
  );

  const handleMappingChange = useCallback(
    (field: keyof ColumnMapping, value: string) => {
      setMapping((prev) => {
        const newMapping = {
          date: prev?.date || "",
          hours: prev?.hours || "",
          description: prev?.description || "",
          projectName: prev?.projectName,
          clientName: prev?.clientName,
          [field]: value || undefined,
        };

        // Re-parse entries when mapping changes
        if (newMapping.date && newMapping.hours && newMapping.description) {
          const parsed = mapRowsToTimeEntries(
            rows,
            newMapping as ColumnMapping,
          );
          setEntries(parsed);
        }

        return newMapping as ColumnMapping;
      });
    },
    [rows],
  );

  const handleImport = useCallback(() => {
    if (validEntries.length === 0) return;

    setStep("importing");

    bulkImportMutation.mutate({
      entries: validEntries.map((e) => ({
        date: e.date,
        hours: e.hours,
        description: e.description,
        projectName: e.projectName,
        clientName: e.clientName,
      })),
      defaultProjectId: defaultProjectId || undefined,
      skipDuplicates,
    });
  }, [validEntries, defaultProjectId, skipDuplicates, bulkImportMutation]);

  const handleClose = useCallback(() => {
    setStep("upload");
    setHeaders([]);
    setRows([]);
    setMapping(null);
    setEntries([]);
    setImportResult(null);
    setDefaultProjectId("");
    onClose();
  }, [onClose]);

  const handleComplete = useCallback(() => {
    handleClose();
    onSuccess();
  }, [handleClose, onSuccess]);

  const dialogRef = useRef<HTMLDivElement>(null);
  useFocusTrap(dialogRef, isOpen, step);

  // Escape-luk + scroll-lock mens modalen er åben (ikke under import)
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && step !== "importing") handleClose();
    };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isOpen, step, handleClose]);

  if (!isOpen) return null;

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: klik udenfor lukker dialogen som musegenvej; tastaturvejen er Escape og dialogens egen luk-knap
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="presentation"
      onClick={(e) => {
        if (e.target === e.currentTarget && step !== "importing") handleClose();
      }}
    >
      <div
        ref={dialogRef}
        className="relative max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-lg bg-white shadow-xl dark:bg-gray-800"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 px-6 py-4 dark:border-gray-700">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-6 w-6 text-brand-500 dark:text-brand-400" />
            <div>
              <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                {t("csv.title")}
              </h2>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {step === "upload" && t("csv.stepUpload")}
                {step === "mapping" && t("csv.stepMapping")}
                {step === "preview" && t("csv.stepPreview")}
                {step === "importing" && t("csv.stepImporting")}
                {step === "complete" && t("csv.stepComplete")}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label={tc("close")}
            className="rounded p-1 hover:bg-gray-100 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Content */}
        <div className="max-h-[calc(90vh-140px)] overflow-y-auto p-6">
          {/* Step: Upload */}
          {step === "upload" && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="mb-6 rounded-full bg-brand-50 p-4 dark:bg-tt-gran-lys">
                <Upload className="h-12 w-12 text-brand-500 dark:text-brand-400" />
              </div>
              <h3 className="mb-2 text-lg font-medium text-gray-900 dark:text-gray-100">
                {t("csv.uploadTitle")}
              </h3>
              <p className="mb-6 text-center text-sm text-gray-500 dark:text-gray-400">
                {t("csv.uploadDescription")}
              </p>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept=".csv"
                  onChange={handleFileUpload}
                  className="hidden"
                />
                <span className="inline-flex items-center gap-2 rounded-lg bg-tt-gran px-6 py-3 font-medium text-tt-paa-gran hover:bg-tt-gran-moerk">
                  <Upload className="h-5 w-5" />
                  {t("csv.chooseFile")}
                </span>
              </label>
              <p className="mt-4 text-xs text-gray-400 dark:text-gray-500">
                {t("csv.effihubAuto")}
              </p>
            </div>
          )}

          {/* Step: Mapping */}
          {step === "mapping" && (
            <div className="space-y-6">
              <div className="rounded-lg bg-yellow-50 p-4 dark:bg-yellow-900/20">
                <div className="flex items-start gap-3">
                  <FileWarning className="h-5 w-5 text-yellow-600 dark:text-yellow-500" />
                  <div>
                    <p className="font-medium text-yellow-800 dark:text-yellow-200">
                      {t("csv.unknownFormat")}
                    </p>
                    <p className="text-sm text-yellow-700 dark:text-yellow-300">
                      {t("csv.unknownFormatHint")}
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label
                    htmlFor={`${fid}-f1`}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.dateColumn")}
                  </label>
                  <select
                    id={`${fid}-f1`}
                    value={mapping?.date || ""}
                    onChange={(e) =>
                      handleMappingChange("date", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.chooseColumn")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${fid}-f2`}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.hoursColumn")}
                  </label>
                  <select
                    id={`${fid}-f2`}
                    value={mapping?.hours || ""}
                    onChange={(e) =>
                      handleMappingChange("hours", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.chooseColumn")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${fid}-f3`}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.descriptionColumn")}
                  </label>
                  <select
                    id={`${fid}-f3`}
                    value={mapping?.description || ""}
                    onChange={(e) =>
                      handleMappingChange("description", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.chooseColumn")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${fid}-f4`}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.projectColumn")}
                  </label>
                  <select
                    id={`${fid}-f4`}
                    value={mapping?.projectName || ""}
                    onChange={(e) =>
                      handleMappingChange("projectName", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.none")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label
                    htmlFor={`${fid}-f5`}
                    className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.clientColumn")}
                  </label>
                  <select
                    id={`${fid}-f5`}
                    value={mapping?.clientName || ""}
                    onChange={(e) =>
                      handleMappingChange("clientName", e.target.value)
                    }
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.none")}</option>
                    {headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview first row */}
              {rows.length > 0 && (
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="mb-2 text-sm font-medium text-gray-700 dark:text-gray-300">
                    {t("csv.firstRow")}
                  </p>
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm">
                      <thead>
                        <tr>
                          {headers.map((h) => (
                            <th
                              key={h}
                              className="px-2 py-1 text-left font-medium text-gray-500"
                            >
                              {h}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        <tr>
                          {headers.map((h) => (
                            <td
                              key={h}
                              className="px-2 py-1 text-gray-900 dark:text-gray-100"
                            >
                              {rows[0][h]}
                            </td>
                          ))}
                        </tr>
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Step: Preview */}
          {step === "preview" && (
            <div className="space-y-6">
              {/* Stats */}
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-gray-50 p-4 dark:bg-gray-700/50">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    {t("csv.totalRows")}
                  </p>
                  <p className="text-2xl font-semibold text-gray-900 dark:text-gray-100">
                    {entries.length}
                  </p>
                </div>
                <div className="rounded-lg bg-green-50 p-4 dark:bg-green-900/20">
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {t("csv.valid")}
                  </p>
                  <p className="text-2xl font-semibold text-green-700 dark:text-green-300">
                    {validEntries.length}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 p-4 dark:bg-red-900/20">
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {t("csv.invalid")}
                  </p>
                  <p className="text-2xl font-semibold text-red-700 dark:text-red-300">
                    {invalidEntries.length}
                  </p>
                </div>
              </div>

              {/* Format detected badge */}
              {detectedFormat === "effihub" && (
                <div className="flex items-center gap-2 rounded-lg bg-brand-50 p-3 dark:bg-tt-gran-lys">
                  <CheckCircle2 className="h-5 w-5 text-brand-500 dark:text-brand-400" />
                  <span className="text-sm text-brand-700 dark:text-brand-300">
                    {t("csv.effihubDetected")}
                  </span>
                </div>
              )}

              {/* Options */}
              <div className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                <h4 className="font-medium text-gray-900 dark:text-gray-100">
                  {t("csv.options")}
                </h4>

                <label className="flex items-center gap-3">
                  <input
                    type="checkbox"
                    checked={skipDuplicates}
                    onChange={(e) => setSkipDuplicates(e.target.checked)}
                    className="h-4 w-4 rounded border-gray-300"
                  />
                  <span className="text-sm text-gray-700 dark:text-gray-300">
                    {t("csv.skipDuplicates")}
                  </span>
                </label>

                <div>
                  <label
                    htmlFor={`${fid}-f6`}
                    className="mb-1 block text-sm text-gray-700 dark:text-gray-300"
                  >
                    {t("csv.defaultProject")}
                  </label>
                  <select
                    id={`${fid}-f6`}
                    value={defaultProjectId}
                    onChange={(e) => setDefaultProjectId(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 dark:border-gray-600 dark:bg-gray-700"
                  >
                    <option value="">{t("csv.noneRequiresMatch")}</option>
                    {projects?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Preview table */}
              <div className="rounded-lg border border-gray-200 dark:border-gray-700">
                <div className="max-h-64 overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          {t("csv.thStatus")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          {t("csv.thDate")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          {t("csv.thHours")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          {t("csv.thDescription")}
                        </th>
                        <th className="px-3 py-2 text-left font-medium text-gray-500">
                          {t("csv.thProject")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                      {entries.slice(0, 50).map((entry, idx) => (
                        <tr
                          // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                          key={idx}
                          className={
                            entry.isValid ? "" : "bg-red-50 dark:bg-red-900/10"
                          }
                        >
                          <td className="px-3 py-2">
                            {entry.isValid ? (
                              <CheckCircle2 className="h-4 w-4 text-green-500" />
                            ) : (
                              <AlertCircle className="h-4 w-4 text-red-500" />
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                            {entry.date || "-"}
                          </td>
                          <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                            {entry.hours}
                          </td>
                          <td className="max-w-xs truncate px-3 py-2 text-gray-900 dark:text-gray-100">
                            {entry.description || "-"}
                          </td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                            {entry.projectName || "-"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {entries.length > 50 && (
                  <div className="border-t border-gray-200 px-3 py-2 text-center text-sm text-gray-500 dark:border-gray-700">
                    {t("csv.showing", { total: entries.length })}
                  </div>
                )}
              </div>

              {/* Invalid entries errors */}
              {invalidEntries.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                  <h4 className="mb-2 font-medium text-red-800 dark:text-red-200">
                    {t("csv.invalidSkipped")}
                  </h4>
                  <ul className="list-inside list-disc text-sm text-red-700 dark:text-red-300">
                    {invalidEntries.slice(0, 5).map((entry, idx) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      <li key={idx}>{entry.errors.join(", ")}</li>
                    ))}
                    {invalidEntries.length > 5 && (
                      <li>
                        {t("csv.andMore", { count: invalidEntries.length - 5 })}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          )}

          {/* Step: Importing */}
          {step === "importing" && (
            <div className="flex flex-col items-center justify-center py-12">
              <div className="mb-6">
                <InlineSpinner className="h-12 w-12" />
              </div>
              <p className="text-lg font-medium text-gray-900 dark:text-gray-100">
                {t("csv.importingCount", { count: validEntries.length })}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {t("csv.importingWait")}
              </p>
            </div>
          )}

          {/* Step: Complete */}
          {step === "complete" && importResult && (
            <div className="space-y-6">
              <div className="flex flex-col items-center justify-center py-8">
                <div className="mb-4 rounded-full bg-green-100 p-3 dark:bg-green-900/30">
                  <Check className="h-8 w-8 text-green-600 dark:text-green-400" />
                </div>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                  {t("csv.completeTitle")}
                </h3>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-lg bg-green-50 p-4 text-center dark:bg-green-900/20">
                  <p className="text-3xl font-bold text-green-700 dark:text-green-300">
                    {importResult.imported}
                  </p>
                  <p className="text-sm text-green-600 dark:text-green-400">
                    {t("csv.imported")}
                  </p>
                </div>
                <div className="rounded-lg bg-yellow-50 p-4 text-center dark:bg-yellow-900/20">
                  <p className="text-3xl font-bold text-yellow-700 dark:text-yellow-300">
                    {importResult.skipped}
                  </p>
                  <p className="text-sm text-yellow-600 dark:text-yellow-400">
                    {t("csv.skippedDuplicates")}
                  </p>
                </div>
                <div className="rounded-lg bg-red-50 p-4 text-center dark:bg-red-900/20">
                  <p className="text-3xl font-bold text-red-700 dark:text-red-300">
                    {importResult.errors.length}
                  </p>
                  <p className="text-sm text-red-600 dark:text-red-400">
                    {t("csv.errors")}
                  </p>
                </div>
              </div>

              {importResult.errors.length > 0 && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
                  <h4 className="mb-2 font-medium text-red-800 dark:text-red-200">
                    {t("csv.importErrors")}
                  </h4>
                  <ul className="max-h-32 list-inside list-disc overflow-y-auto text-sm text-red-700 dark:text-red-300">
                    {importResult.errors.map((err, idx) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      <li key={idx}>
                        {t("csv.rowError", { row: err.row, error: err.error })}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between border-t border-gray-200 px-6 py-4 dark:border-gray-700">
          <div>
            {step === "mapping" && (
              <Button variant="ghost" onClick={() => setStep("upload")}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                {tc("back")}
              </Button>
            )}
            {step === "preview" && mapping && (
              <Button variant="ghost" onClick={() => setStep("mapping")}>
                <ChevronLeft className="mr-1 h-4 w-4" />
                {t("csv.editMapping")}
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={handleClose}>
              {step === "complete" ? tc("close") : tc("cancel")}
            </Button>

            {step === "mapping" &&
              mapping?.date &&
              mapping?.hours &&
              mapping?.description && (
                <Button onClick={() => setStep("preview")}>
                  {tc("next")}
                  <ChevronRight className="ml-1 h-4 w-4" />
                </Button>
              )}

            {step === "preview" && validEntries.length > 0 && (
              <Button onClick={handleImport}>
                {t("csv.importEntries", { count: validEntries.length })}
              </Button>
            )}

            {step === "complete" && (
              <Button onClick={handleComplete}>{t("csv.viewEntries")}</Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
