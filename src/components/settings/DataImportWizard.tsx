"use client";

import {
  AlertCircle,
  Check,
  CheckCircle2,
  ChevronRight,
  FileWarning,
  Upload,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { InlineSpinner } from "@/components/ui/LoadingScreen";
import { Modal } from "@/components/ui/Modal";
import { parseCSV } from "@/lib/utils/csv-import";
import { trpc } from "@/providers/trpc-provider";

type ImportDataType =
  | "clients"
  | "projects"
  | "tasks"
  | "invoices"
  | "prepaidPackages";

interface DataImportWizardProps {
  file: File;
  dataType: ImportDataType;
  onClose: () => void;
}

type WizardStep = "parsing" | "preview" | "importing" | "complete";

const TYPE_REQUIRED_FIELDS: Record<ImportDataType, string[]> = {
  clients: ["name"],
  projects: ["name", "clientName"],
  tasks: ["title"],
  invoices: ["invoiceNumber", "clientName", "amount", "issueDate"],
  prepaidPackages: [
    "name",
    "clientName",
    "totalHours",
    "hourlyRate",
    "purchaseDate",
  ],
};

const FIELD_KEYS = [
  "name",
  "email",
  "phone",
  "company",
  "address",
  "city",
  "postalCode",
  "country",
  "cvrNumber",
  "notes",
  "defaultHourlyRate",
  "description",
  "clientName",
  "hourlyRate",
  "fixedPrice",
  "status",
  "title",
  "projectName",
  "priority",
  "deadline",
  "estimatedMinutes",
  "invoiceNumber",
  "amount",
  "issueDate",
  "dueDate",
  "paidDate",
  "totalHours",
  "usedHours",
  "purchaseDate",
  "expiryDate",
];

// Known header aliases for auto-mapping
const HEADER_ALIASES: Record<string, string[]> = {
  name: ["Navn", "Name", "navn"],
  email: ["Email", "E-mail", "email"],
  phone: ["Telefon", "Phone", "telefon", "Tlf"],
  company: ["Virksomhed", "Company", "Firma", "virksomhed"],
  cvrNumber: ["CVR", "cvr", "CVR-nummer", "cvr_number"],
  address: ["Adresse", "Address", "adresse"],
  city: ["By", "City", "by"],
  postalCode: ["Postnr", "Postal Code", "postnr", "postal_code"],
  country: ["Land", "Country", "land"],
  notes: ["Noter", "Notes", "noter"],
  defaultHourlyRate: ["Timepris", "Standard timepris", "Rate", "hourly_rate"],
  title: ["Titel", "Title", "titel"],
  description: ["Beskrivelse", "Description", "beskrivelse"],
  clientName: ["Klient", "Client", "Kunde", "klient"],
  projectName: ["Projekt", "Project", "projekt"],
  hourlyRate: ["Timepris", "Hourly Rate", "hourly_rate"],
  fixedPrice: ["Fast pris", "Fixed Price", "fixed_price"],
  status: ["Status", "status"],
  priority: ["Prioritet", "Priority", "prioritet"],
  deadline: ["Deadline", "deadline"],
  invoiceNumber: ["Fakturanummer", "Invoice Number", "invoice_number"],
  amount: ["Beløb", "Amount", "beløb"],
  issueDate: ["Udstedelsesdato", "Issue Date", "issue_date"],
  dueDate: ["Forfaldsdato", "Due Date", "due_date"],
  paidDate: ["Betalt dato", "Paid Date", "paid_date"],
  totalHours: ["Total timer", "Total Hours", "total_hours"],
  usedHours: ["Brugt timer", "Used Hours", "used_hours"],
  purchaseDate: ["Købsdato", "Purchase Date", "purchase_date"],
  expiryDate: ["Udløbsdato", "Expiry Date", "expiry_date"],
};

function autoMapHeaders(
  csvHeaders: string[],
  dataType: ImportDataType,
): Record<string, string> {
  const mapping: Record<string, string> = {};
  const allFields = [...TYPE_REQUIRED_FIELDS[dataType], ...FIELD_KEYS];

  for (const field of new Set(allFields)) {
    const aliases = HEADER_ALIASES[field] || [field];
    const matchedHeader = csvHeaders.find((h) =>
      aliases.some(
        (alias) =>
          h.toLowerCase().trim() === alias.toLowerCase() ||
          h.toLowerCase().includes(alias.toLowerCase()),
      ),
    );
    if (matchedHeader) {
      mapping[field] = matchedHeader;
    }
  }

  return mapping;
}

export function DataImportWizard({
  file,
  dataType,
  onClose,
}: DataImportWizardProps) {
  const t = useTranslations("settingsData.wizard");
  const fieldLabel = useCallback(
    (field: string) =>
      FIELD_KEYS.includes(field) ? t(`fields.${field}`) : field,
    [t],
  );
  const [step, setStep] = useState<WizardStep>("parsing");
  const [csvHeaders, setCsvHeaders] = useState<string[]>([]);
  const [csvRows, setCsvRows] = useState<Record<string, string>[]>([]);
  const [columnMapping, setColumnMapping] = useState<Record<string, string>>(
    {},
  );
  const [skipDuplicates, setSkipDuplicates] = useState(true);
  const [isJson, setIsJson] = useState(false);
  const [jsonData, setJsonData] = useState<Record<string, unknown>[]>([]);
  const [importResult, setImportResult] = useState<{
    imported: number;
    skipped: number;
    errors: string[];
  } | null>(null);

  const utils = trpc.useUtils();

  const clientsMutation = trpc.dataExport.bulkImportClients.useMutation();
  const projectsMutation = trpc.dataExport.bulkImportProjects.useMutation();
  const tasksMutation = trpc.dataExport.bulkImportTasks.useMutation();
  const invoicesMutation = trpc.dataExport.bulkImportInvoices.useMutation();
  const prepaidMutation =
    trpc.dataExport.bulkImportPrepaidPackages.useMutation();

  // Parse file on mount
  useEffect(() => {
    const readFile = async () => {
      const text = await file.text();

      if (file.name.endsWith(".json")) {
        try {
          const parsed = JSON.parse(text);
          const dataArray = Array.isArray(parsed)
            ? parsed
            : parsed[dataType] || parsed.data || [];

          if (!Array.isArray(dataArray) || dataArray.length === 0) {
            toast.error(t("jsonEmpty"));
            onClose();
            return;
          }

          setIsJson(true);
          setJsonData(dataArray as Record<string, unknown>[]);
          setStep("preview");
          return;
        } catch {
          toast.error(t("jsonInvalid"));
          onClose();
          return;
        }
      }

      // CSV parsing
      const { headers, rows } = parseCSV(text);
      if (headers.length === 0 || rows.length === 0) {
        toast.error(t("csvEmpty"));
        onClose();
        return;
      }

      setCsvHeaders(headers);
      setCsvRows(rows);

      // Auto-map
      const mapping = autoMapHeaders(headers, dataType);
      setColumnMapping(mapping);

      setStep("preview");
    };

    readFile();
  }, [file, dataType, onClose, t]);

  // Parse and validate rows for CSV
  const validatedRows = useMemo(() => {
    if (isJson) {
      return jsonData.map((row) => {
        const errors: string[] = [];
        const required = TYPE_REQUIRED_FIELDS[dataType];
        for (const field of required) {
          if (!row[field] && row[field] !== 0) {
            errors.push(t("fieldMissing", { field: fieldLabel(field) }));
          }
        }
        return {
          data: Object.fromEntries(
            Object.entries(row).map(([k, v]) => [k, String(v ?? "")]),
          ),
          isValid: errors.length === 0,
          errors,
        };
      });
    }

    return csvRows.map((row) => {
      const errors: string[] = [];
      const required = TYPE_REQUIRED_FIELDS[dataType];
      for (const field of required) {
        const header = columnMapping[field];
        if (!header || !row[header]?.trim()) {
          errors.push(t("fieldMissing", { field: fieldLabel(field) }));
        }
      }
      return {
        data: Object.fromEntries(
          Object.entries(columnMapping).map(([field, header]) => [
            field,
            row[header]?.trim() || "",
          ]),
        ),
        isValid: errors.length === 0,
        errors,
      };
    });
  }, [csvRows, columnMapping, isJson, jsonData, dataType, t, fieldLabel]);

  const validCount = validatedRows.filter((r) => r.isValid).length;
  const invalidCount = validatedRows.filter((r) => !r.isValid).length;

  const handleImport = useCallback(async () => {
    setStep("importing");

    const validEntries = validatedRows
      .filter((r) => r.isValid)
      .map((r) => r.data);

    try {
      let result: { imported: number; skipped: number; errors: string[] };

      switch (dataType) {
        case "clients":
          result = await clientsMutation.mutateAsync({
            entries: validEntries.map((e) => ({
              name: e.name || "",
              email: e.email,
              phone: e.phone,
              company: e.company,
              address: e.address,
              city: e.city,
              postalCode: e.postalCode,
              country: e.country,
              cvrNumber: e.cvrNumber,
              notes: e.notes,
              defaultHourlyRate: e.defaultHourlyRate,
            })),
            skipDuplicates,
          });
          break;

        case "projects":
          result = await projectsMutation.mutateAsync({
            entries: validEntries.map((e) => ({
              name: e.name || "",
              description: e.description,
              clientName: e.clientName,
              hourlyRate: e.hourlyRate,
              fixedPrice: e.fixedPrice,
              status: e.status,
            })),
            skipDuplicates,
          });
          break;

        case "tasks":
          result = await tasksMutation.mutateAsync({
            entries: validEntries.map((e) => ({
              title: e.title || "",
              description: e.description,
              projectName: e.projectName,
              clientName: e.clientName,
              status: e.status,
              priority: e.priority,
              deadline: e.deadline,
              estimatedMinutes: e.estimatedMinutes
                ? parseInt(e.estimatedMinutes, 10)
                : undefined,
            })),
            skipDuplicates,
          });
          break;

        case "invoices":
          result = await invoicesMutation.mutateAsync({
            entries: validEntries.map((e) => ({
              invoiceNumber: e.invoiceNumber || "",
              clientName: e.clientName || "",
              amount: e.amount || "0",
              status: e.status,
              issueDate: e.issueDate || "",
              dueDate: e.dueDate,
              paidDate: e.paidDate,
              notes: e.notes,
            })),
            skipDuplicates,
          });
          break;

        case "prepaidPackages":
          result = await prepaidMutation.mutateAsync({
            entries: validEntries.map((e) => ({
              name: e.name || "",
              clientName: e.clientName || "",
              totalHours: e.totalHours || "0",
              usedHours: e.usedHours,
              hourlyRate: e.hourlyRate || "0",
              purchaseDate: e.purchaseDate || "",
              expiryDate: e.expiryDate,
            })),
            skipDuplicates,
          });
          break;
      }

      setImportResult(result);
      setStep("complete");

      // Invalidate relevant queries
      utils.invalidate();
    } catch (err) {
      toast.error(t("importFailed", { message: (err as Error).message }));
      setStep("preview");
    }
  }, [
    validatedRows,
    dataType,
    skipDuplicates,
    clientsMutation,
    projectsMutation,
    tasksMutation,
    invoicesMutation,
    prepaidMutation,
    utils,
    t,
  ]);

  const typeLabel =
    dataType === "prepaidPackages"
      ? t("typePrepaid")
      : dataType === "clients"
        ? t("typeClients")
        : dataType === "projects"
          ? t("typeProjects")
          : dataType === "tasks"
            ? t("typeTasks")
            : t("typeInvoices");

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={t("title", { type: typeLabel })}
      size="lg"
    >
      <div className="space-y-4">
        {/* Step Indicator */}
        <div className="flex items-center justify-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span
            className={
              step === "parsing"
                ? "font-bold text-brand-600 dark:text-brand-400"
                : ""
            }
          >
            {t("stepAnalysis")}
          </span>
          <ChevronRight className="h-3 w-3" />
          <span
            className={
              step === "preview"
                ? "font-bold text-brand-600 dark:text-brand-400"
                : ""
            }
          >
            {t("stepPreview")}
          </span>
          <ChevronRight className="h-3 w-3" />
          <span
            className={
              step === "importing" || step === "complete"
                ? "font-bold text-brand-600 dark:text-brand-400"
                : ""
            }
          >
            {t("stepResult")}
          </span>
        </div>

        {/* Parsing Step */}
        {step === "parsing" && (
          <div className="flex flex-col items-center justify-center py-12">
            <InlineSpinner className="h-8 w-8" />
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              {t("analysing")}
            </p>
          </div>
        )}

        {/* Preview Step */}
        {step === "preview" && (
          <>
            {/* Stats */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 rounded-lg bg-green-50 dark:bg-green-900/20 px-3 py-2">
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span className="text-sm font-medium text-green-800 dark:text-green-300">
                  {t("valid", { count: validCount })}
                </span>
              </div>
              {invalidCount > 0 && (
                <div className="flex items-center gap-2 rounded-lg bg-red-50 dark:bg-red-900/20 px-3 py-2">
                  <FileWarning className="h-4 w-4 text-red-600 dark:text-red-400" />
                  <span className="text-sm font-medium text-red-800 dark:text-red-300">
                    {t("invalid", { count: invalidCount })}
                  </span>
                </div>
              )}
              <div className="text-sm text-gray-500 dark:text-gray-400">
                {t("totalRows", { count: validatedRows.length })}
              </div>
            </div>

            {/* Column Mapping (CSV only) */}
            {!isJson && csvHeaders.length > 0 && (
              <div className="rounded-lg border border-gray-200 dark:border-gray-700 p-4">
                <h3 className="mb-3 text-sm font-medium text-gray-700 dark:text-gray-300">
                  {t("mapping")}
                </h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {TYPE_REQUIRED_FIELDS[dataType].map((field) => (
                    <div key={field} className="flex items-center gap-2">
                      <label
                        htmlFor={`mapping-${field}`}
                        className="text-xs font-medium text-gray-600 dark:text-gray-400 w-28"
                      >
                        {fieldLabel(field)}
                        <span className="text-red-500">*</span>
                      </label>
                      <select
                        id={`mapping-${field}`}
                        value={columnMapping[field] || ""}
                        onChange={(e) =>
                          setColumnMapping((prev) => ({
                            ...prev,
                            [field]: e.target.value,
                          }))
                        }
                        className="flex-1 rounded border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 text-gray-900 dark:text-white px-2 py-1 text-xs"
                      >
                        <option value="">{t("choose")}</option>
                        {csvHeaders.map((h) => (
                          <option key={h} value={h}>
                            {h}
                          </option>
                        ))}
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Options */}
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                <input
                  type="checkbox"
                  checked={skipDuplicates}
                  onChange={(e) => setSkipDuplicates(e.target.checked)}
                  className="rounded border-gray-300 dark:border-gray-600"
                />
                {t("skipDuplicates")}
              </label>
            </div>

            {/* Preview Table */}
            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200 dark:border-gray-700">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 dark:bg-gray-700">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      #
                    </th>
                    {TYPE_REQUIRED_FIELDS[dataType].map((field) => (
                      <th
                        key={field}
                        className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400"
                      >
                        {fieldLabel(field)}
                      </th>
                    ))}
                    <th className="px-3 py-2 text-left font-medium text-gray-500 dark:text-gray-400">
                      {t("colStatus")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {validatedRows.slice(0, 50).map((row, i) => (
                    <tr
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      key={`row-${i}-${row.data.name || row.data.title || i}`}
                      className={`border-t border-gray-100 dark:border-gray-700/50 ${
                        row.isValid ? "" : "bg-red-50/50 dark:bg-red-900/10"
                      }`}
                    >
                      <td className="px-3 py-1.5 text-gray-500 dark:text-gray-400">
                        {i + 1}
                      </td>
                      {TYPE_REQUIRED_FIELDS[dataType].map((field) => (
                        <td
                          key={field}
                          className="px-3 py-1.5 text-gray-900 dark:text-white max-w-32 truncate"
                        >
                          {row.data[field] || (
                            <span className="text-gray-400 italic">-</span>
                          )}
                        </td>
                      ))}
                      <td className="px-3 py-1.5">
                        {row.isValid ? (
                          <Check className="h-3.5 w-3.5 text-green-600 dark:text-green-400" />
                        ) : (
                          <span
                            className="text-red-600 dark:text-red-400"
                            title={row.errors.join(", ")}
                          >
                            <AlertCircle className="h-3.5 w-3.5" />
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {validatedRows.length > 50 && (
                <p className="px-3 py-2 text-xs text-gray-500 dark:text-gray-400 text-center border-t border-gray-100 dark:border-gray-700/50">
                  {t("showing", { count: validatedRows.length })}
                </p>
              )}
            </div>

            {/* Actions */}
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700"
              >
                {t("cancel")}
              </button>
              <button
                type="button"
                onClick={handleImport}
                disabled={validCount === 0}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Upload className="h-4 w-4" />
                {t("importRows", { count: validCount })}
              </button>
            </div>
          </>
        )}

        {/* Importing Step */}
        {step === "importing" && (
          <div className="flex flex-col items-center justify-center py-12">
            <InlineSpinner className="h-8 w-8" />
            <p className="mt-4 text-sm text-gray-600 dark:text-gray-400">
              {t("importing")}
            </p>
          </div>
        )}

        {/* Complete Step */}
        {step === "complete" && importResult && (
          <>
            <div className="flex flex-col items-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-600 dark:text-green-400" />
              <h3 className="mt-4 text-lg font-semibold text-gray-900 dark:text-white">
                {t("complete")}
              </h3>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="rounded-lg bg-green-50 dark:bg-green-900/20 p-4 text-center">
                <p className="text-2xl font-bold text-green-700 dark:text-green-400">
                  {importResult.imported}
                </p>
                <p className="text-xs text-green-600 dark:text-green-400">
                  {t("imported")}
                </p>
              </div>
              <div className="rounded-lg bg-yellow-50 dark:bg-yellow-900/20 p-4 text-center">
                <p className="text-2xl font-bold text-yellow-700 dark:text-yellow-400">
                  {importResult.skipped}
                </p>
                <p className="text-xs text-yellow-600 dark:text-yellow-400">
                  {t("skipped")}
                </p>
              </div>
              <div className="rounded-lg bg-red-50 dark:bg-red-900/20 p-4 text-center">
                <p className="text-2xl font-bold text-red-700 dark:text-red-400">
                  {importResult.errors.length}
                </p>
                <p className="text-xs text-red-600 dark:text-red-400">
                  {t("errors")}
                </p>
              </div>
            </div>

            {importResult.errors.length > 0 && (
              <div className="max-h-32 overflow-auto rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
                <p className="text-xs font-medium text-red-800 dark:text-red-300 mb-1">
                  {t("errorsLabel")}
                </p>
                {importResult.errors.map((err) => (
                  <p
                    key={err}
                    className="text-xs text-red-700 dark:text-red-400"
                  >
                    {err}
                  </p>
                ))}
              </div>
            )}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-sm font-medium text-tt-paa-gran bg-tt-gran rounded-lg hover:bg-tt-gran-moerk"
              >
                {t("close")}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
