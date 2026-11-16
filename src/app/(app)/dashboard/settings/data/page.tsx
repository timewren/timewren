"use client";

import {
  Download,
  FileArchive,
  FileDown,
  FileJson,
  FileSpreadsheet,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useRef, useState } from "react";
import { toast } from "sonner";
import { useBrand } from "@/components/BrandContext";
import { PageHeader } from "@/components/dashboard-nav";
import { DataImportWizard } from "@/components/settings/DataImportWizard";
import { OrgExportCard } from "@/components/settings/OrgExportCard";
import { UserExportCard } from "@/components/settings/UserExportCard";
import { useOrgRole } from "@/hooks/useOrgRole";
import {
  CLIENT_COLUMNS,
  type CSVColumn,
  convertToExcelCSV,
  downloadCSV,
  downloadExport,
  generateAllImportTemplatesZip,
  generateCSVFilename,
  generateImportTemplate,
  type ImportTemplateType,
  INVOICE_COLUMNS,
  INVOICE_LINE_COLUMNS,
  PREPAID_COLUMNS,
  PREPAID_USAGE_COLUMNS,
  PROJECT_COLUMNS,
  RATE_HISTORY_COLUMNS,
  TASK_COLUMNS,
  TIME_ENTRY_COLUMNS,
} from "@/lib/utils/csv-export";
import { trpc } from "@/providers/trpc-provider";

type DataType =
  | "clients"
  | "projects"
  | "timeEntries"
  | "tasks"
  | "invoices"
  | "invoiceLines"
  | "prepaidPackages"
  | "prepaidUsage"
  | "rateHistory";

type ExportFormat = "csv" | "json";

type ImportType =
  | "clients"
  | "projects"
  | "tasks"
  | "invoices"
  | "prepaidPackages"
  | "timeEntries";

const DATA_TYPES: DataType[] = [
  "clients",
  "projects",
  "timeEntries",
  "tasks",
  "invoices",
  "invoiceLines",
  "prepaidPackages",
  "prepaidUsage",
  "rateHistory",
];

const IMPORT_TYPES: ImportType[] = [
  "clients",
  "projects",
  "timeEntries",
  "tasks",
  "invoices",
  "prepaidPackages",
];

const COLUMNS_MAP: Record<DataType, CSVColumn[]> = {
  clients: CLIENT_COLUMNS,
  projects: PROJECT_COLUMNS,
  timeEntries: TIME_ENTRY_COLUMNS,
  tasks: TASK_COLUMNS,
  invoices: INVOICE_COLUMNS,
  invoiceLines: INVOICE_LINE_COLUMNS,
  prepaidPackages: PREPAID_COLUMNS,
  prepaidUsage: PREPAID_USAGE_COLUMNS,
  rateHistory: RATE_HISTORY_COLUMNS,
};

export default function DataPage() {
  const t = useTranslations("settingsData.page");
  // Hostens brand (TimeWren på timewren.com), ikke build-brandet.
  const brand = useBrand();
  const typeLabel = (type: DataType) => t(`types.${type}`);
  const { canManage, isResolved } = useOrgRole();
  const [exportType, setExportType] = useState<DataType>("clients");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [isExporting, setIsExporting] = useState(false);

  const [importType, setImportType] = useState<ImportType>("clients");
  const [showImportWizard, setShowImportWizard] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const exportQuery = trpc.dataExport.exportData.useQuery(
    {
      dataType: exportType,
      dateFrom: dateFrom || undefined,
      dateTo: dateTo || undefined,
    },
    { enabled: false },
  );

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportQuery.refetch();
      const data = result.data;

      if (!data || data.length === 0) {
        toast.error(t("noData"));
        return;
      }

      const label = typeLabel(exportType).toLowerCase().replace(/\s/g, "-");

      if (exportFormat === "json") {
        const jsonContent = JSON.stringify(data, null, 2);
        downloadExport(jsonContent, generateCSVFilename(label, "json"), "json");
      } else {
        const columns = COLUMNS_MAP[exportType];
        const csvContent = convertToExcelCSV(
          data as Record<string, unknown>[],
          columns,
        );
        downloadCSV(csvContent, generateCSVFilename(label));
      }

      toast.success(t("exported", { type: typeLabel(exportType) }));
    } catch {
      toast.error(t("exportFailed"));
    } finally {
      setIsExporting(false);
    }
  };

  const handleDownloadTemplate = () => {
    const label = typeLabel(importType).toLowerCase().replace(/\s/g, "-");
    const csv = generateImportTemplate(importType as ImportTemplateType);
    downloadCSV(csv, `import-skabelon-${label}.csv`);
    toast.success(t("templateDownloaded", { type: typeLabel(importType) }));
  };

  const handleDownloadAllTemplates = async () => {
    try {
      const blob = await generateAllImportTemplatesZip();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "timetrack-import-skabeloner.zip";
      link.click();
      URL.revokeObjectURL(url);
      toast.success(t("allTemplatesDownloaded"));
    } catch {
      toast.error(t("templatesFailed"));
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (importType === "timeEntries") {
        toast.info(t("useTimePageImport"));
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setImportFile(file);
      setShowImportWizard(true);
    }
    // Reset input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      {/* Header */}
      <PageHeader
        title={t("title")}
        description={t("description")}
        helpTopicId="import-export"
      />

      {/* Fuld eksport af alle organisationens data (ZIP) */}
      {/* Brugerens egne data (alle roller, GDPR art. 15 og 20). For
          medarbejdere står det først: organisationens kort er kun en note. */}
      {isResolved && !canManage && <UserExportCard />}
      <OrgExportCard />
      {(!isResolved || canManage) && <UserExportCard />}

      {/* Export Section */}
      <div
        id="eksport"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-green-100 dark:bg-green-900/30">
            <Download className="h-5 w-5 text-green-600 dark:text-green-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("exportTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("exportSub")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="export-type"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("dataType")}
            </label>
            <select
              id="export-type"
              value={exportType}
              onChange={(e) => setExportType(e.target.value as DataType)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              {DATA_TYPES.map((value) => (
                <option key={value} value={value}>
                  {typeLabel(value)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <span className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300">
              {t("format")}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setExportFormat("csv")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  exportFormat === "csv"
                    ? "border-green-600 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <FileSpreadsheet className="h-4 w-4" />
                CSV
              </button>
              <button
                type="button"
                onClick={() => setExportFormat("json")}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${
                  exportFormat === "json"
                    ? "border-green-600 bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-400"
                    : "border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700"
                }`}
              >
                <FileJson className="h-4 w-4" />
                JSON
              </button>
            </div>
          </div>

          <div>
            <label
              htmlFor="date-from"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("dateFrom")}
            </label>
            <input
              id="date-from"
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>

          <div>
            <label
              htmlFor="date-to"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("dateTo")}
            </label>
            <input
              id="date-to"
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            />
          </div>
        </div>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleExport}
            disabled={isExporting}
            className="inline-flex items-center gap-2 rounded-lg bg-green-600 px-6 py-2.5 font-medium text-white transition-colors hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExporting ? (
              <>
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                {t("exporting")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {t("downloadType", { type: typeLabel(exportType) })}
              </>
            )}
          </button>
        </div>
      </div>

      {/* Import Section */}
      <div
        id="import"
        className="rounded-xl border border-gray-200/80 dark:border-gray-800 bg-white dark:bg-gray-900 p-6"
      >
        <div className="flex items-center gap-3 mb-6">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-100 dark:bg-tt-gran-lys">
            <Upload className="h-5 w-5 text-brand-600 dark:text-brand-400" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-gray-900 dark:text-white">
              {t("importTitle")}
            </h2>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {t("importSub")}
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label
              htmlFor="import-type"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("dataType")}
            </label>
            <select
              id="import-type"
              value={importType}
              onChange={(e) => setImportType(e.target.value as ImportType)}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm focus:border-brand-500 focus:outline-none focus:ring-1 focus:ring-brand-500/20"
            >
              {IMPORT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {typeLabel(value)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="import-file"
              className="mb-1.5 block text-xs font-medium text-gray-700 dark:text-gray-300"
            >
              {t("file")}
            </label>
            <input
              id="import-file"
              ref={fileInputRef}
              type="file"
              accept=".csv,.json"
              onChange={handleFileSelect}
              className="w-full rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-3 py-1.5 text-sm file:mr-4 file:rounded-md file:border-0 file:bg-brand-50 dark:file:bg-tt-gran-lys file:px-4 file:py-1 file:text-sm file:font-medium file:text-brand-700 dark:file:text-brand-400 focus:outline-none"
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-4">
          <button
            type="button"
            onClick={handleDownloadTemplate}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
          >
            <FileDown className="h-4 w-4" />
            {t("downloadTemplate", { type: typeLabel(importType) })}
          </button>
          <span className="text-gray-300 dark:text-gray-600">|</span>
          <button
            type="button"
            onClick={handleDownloadAllTemplates}
            className="inline-flex items-center gap-2 text-sm font-medium text-brand-600 dark:text-brand-400 hover:text-brand-700 dark:hover:text-brand-300 transition-colors"
          >
            <FileArchive className="h-4 w-4" />
            {t("downloadAllTemplates")}
          </button>
        </div>

        <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
          {t("importNote", { brand: brand.name })}
        </p>
      </div>

      {/* Import Wizard Modal */}
      {showImportWizard && importFile && importType !== "timeEntries" && (
        <DataImportWizard
          file={importFile}
          dataType={importType}
          onClose={() => {
            setShowImportWizard(false);
            setImportFile(null);
          }}
        />
      )}
    </div>
  );
}
