/**
 * CSV Export Utilities
 * Helper functions for exporting data to CSV format
 */

import daExport from "@/i18n/messages/da/sharedExport.json";
import { sharedT } from "@/i18n/shared-text";
import { toLocalDateStr } from "@/lib/format";
import { escapeCsv } from "@/lib/utils/spreadsheet";

export interface CSVColumn {
  key: string;
  header: string;
  format?: "text" | "number" | "currency" | "date" | "time" | "boolean";
}

// Delimiter options for different regions
export type CSVDelimiter = "," | ";" | "\t";

interface ExportOptions {
  delimiter?: CSVDelimiter;
  includeHeaders?: boolean;
  dateFormat?: "iso" | "danish" | "us";
  currencySymbol?: string;
  decimalSeparator?: "." | ",";
}

// Default options optimized for Danish Excel
const DEFAULT_OPTIONS: ExportOptions = {
  delimiter: ";", // Danish Excel uses semicolon
  includeHeaders: true,
  dateFormat: "danish",
  currencySymbol: "kr",
  decimalSeparator: ",",
};

/**
 * Convert data to CSV format with configurable options
 * @param data Array of objects to convert
 * @param columns Column definitions
 * @param options Export options
 * @returns CSV string
 */
export function convertToCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: CSVColumn[],
  options: ExportOptions = {},
): string {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const delimiter: CSVDelimiter = opts.delimiter ?? ";";

  if (data.length === 0) {
    return "";
  }

  // Create header row
  const headers = columns.map((col) =>
    escapeCSVValue(translateHeader(col.header), delimiter),
  );
  const headerRow = headers.join(delimiter);

  // Create data rows
  const dataRows = data.map((row) => {
    const values = columns.map((col) => {
      const value = row[col.key];
      const numeric =
        (typeof value === "number" ||
          col.format === "number" ||
          col.format === "currency" ||
          col.format === "time") &&
        !Number.isNaN(Number.parseFloat(String(value)));
      return escapeCSVValue(
        formatValue(value, col.format, opts),
        delimiter,
        numeric,
      );
    });
    return values.join(delimiter);
  });

  if (opts.includeHeaders) {
    return [headerRow, ...dataRows].join("\n");
  }
  return dataRows.join("\n");
}

/**
 * Convert data to Excel-compatible format (semicolon-separated for Danish)
 */
export function convertToExcelCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: CSVColumn[],
): string {
  return convertToCSV(data, columns, {
    delimiter: ";",
    dateFormat: "danish",
    decimalSeparator: ",",
  });
}

/**
 * Convert data to standard CSV format (comma-separated)
 */
export function convertToStandardCSV<T extends Record<string, unknown>>(
  data: T[],
  columns: CSVColumn[],
): string {
  return convertToCSV(data, columns, {
    delimiter: ",",
    dateFormat: "iso",
    decimalSeparator: ".",
  });
}

/**
 * Kolonneoverskrifterne er skrevet på dansk i kolonnedefinitionerne; ved eksport slås de op
 * på kaldets sprog. Ukendte overskrifter (fx importskabelonernes) bliver stående uændret.
 */
export function headerSlug(header: string): string {
  const parts = header
    .toLowerCase()
    .replace(/æ/g, "ae")
    .replace(/ø/g, "oe")
    .replace(/å/g, "aa")
    .split(/[^a-z]+/)
    .filter(Boolean);
  return (
    parts[0] +
    parts
      .slice(1)
      .map((p) => p[0].toUpperCase() + p.slice(1))
      .join("")
  );
}

export function translateHeader(
  header: string,
  locale?: string | null,
): string {
  const slug = headerSlug(header);
  if (!(slug in daExport.headers)) return header;
  return sharedT("sharedExport", `headers.${slug}`, undefined, locale);
}

/**
 * Escape CSV value to handle delimiters, quotes, and newlines
 */
function escapeCSVValue(
  value: string,
  delimiter: CSVDelimiter,
  numeric = false,
): string {
  return escapeCsv(value, { delimiter, numeric });
}

/**
 * Format value for CSV export based on column type and options
 */
function formatValue(
  value: unknown,
  format?: CSVColumn["format"],
  options?: ExportOptions,
): string {
  if (value === null || value === undefined) {
    return "";
  }

  // Handle boolean
  if (typeof value === "boolean" || format === "boolean") {
    return sharedT("sharedFormat", value ? "yes" : "no");
  }

  // Handle dates
  if (value instanceof Date || format === "date") {
    const date = value instanceof Date ? value : new Date(value as string);
    if (Number.isNaN(date.getTime())) return String(value);

    switch (options?.dateFormat) {
      case "danish":
        return date.toLocaleDateString("da-DK", {
          timeZone: "Europe/Copenhagen",
        }); // DD-MM-YYYY or DD/MM/YYYY
      case "us":
        return date.toLocaleDateString("en-US", {
          timeZone: "Europe/Copenhagen",
        }); // MM/DD/YYYY
      default:
        // Use local date components to avoid UTC shift
        return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    }
  }

  // Handle numbers
  if (typeof value === "number" || format === "number") {
    const num = typeof value === "number" ? value : parseFloat(value as string);
    if (Number.isNaN(num)) return String(value);

    // Use decimal separator from options
    const formatted = num.toFixed(2);
    if (options?.decimalSeparator === ",") {
      return formatted.replace(".", ",");
    }
    return formatted;
  }

  // Handle currency
  if (format === "currency") {
    const num = typeof value === "number" ? value : parseFloat(value as string);
    if (Number.isNaN(num)) return String(value);

    const formatted = num.toFixed(2);
    const withSeparator =
      options?.decimalSeparator === ","
        ? formatted.replace(".", ",")
        : formatted;

    return `${withSeparator} ${options?.currencySymbol || "kr"}`;
  }

  // Handle time (hours)
  if (format === "time") {
    const hours =
      typeof value === "number" ? value : parseFloat(value as string);
    if (Number.isNaN(hours)) return String(value);

    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}t ${m}m`;
  }

  return String(value);
}

/**
 * Download CSV file in browser
 */
export function downloadCSV(content: string, filename: string): void {
  // Add BOM for UTF-8 (helps Excel recognize Danish characters)
  const BOM = "\uFEFF";
  const csvContent = BOM + content;

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    // Create download link
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Generate filename with timestamp
 */
export function generateCSVFilename(prefix: string, extension = "csv"): string {
  const now = new Date();
  const dateStr = toLocalDateStr(now); // YYYY-MM-DD in local tz
  const timeStr = now.toTimeString().split(" ")[0].replace(/:/g, "-"); // HH-MM-SS
  return `${prefix}_${dateStr}_${timeStr}.${extension}`;
}

/**
 * Export types available to users
 */
export type ExportFormat = "csv" | "excel" | "json";

/**
 * Download data in specified format
 */
export function downloadExport(
  content: string,
  filename: string,
  format: ExportFormat = "csv",
): void {
  let mimeType: string;
  let finalContent = content;

  switch (format) {
    case "excel":
      // Add BOM for UTF-8 Excel compatibility
      mimeType = "application/vnd.ms-excel;charset=utf-8";
      finalContent = `\uFEFF${content}`;
      break;
    case "json":
      mimeType = "application/json;charset=utf-8";
      break;
    default:
      mimeType = "text/csv;charset=utf-8";
      finalContent = `\uFEFF${content}`; // Add BOM
  }

  const blob = new Blob([finalContent], { type: mimeType });
  const link = document.createElement("a");

  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }
}

/**
 * Convert data to JSON format (for API export)
 */
export function convertToJSON<T>(data: T[]): string {
  return JSON.stringify(data, null, 2);
}

/**
 * Common export column definitions for time entries
 */
export const TIME_ENTRY_COLUMNS: CSVColumn[] = [
  { key: "date", header: "Dato", format: "date" },
  { key: "clientName", header: "Klient" },
  { key: "projectName", header: "Projekt" },
  { key: "description", header: "Beskrivelse" },
  { key: "hours", header: "Timer", format: "number" },
  { key: "billableRate", header: "Timepris", format: "currency" },
  { key: "total", header: "Beløb", format: "currency" },
  { key: "isBilled", header: "Faktureret", format: "boolean" },
  { key: "isPrepaid", header: "Klippekort", format: "boolean" },
];

/**
 * Common export column definitions for invoices
 */
export const INVOICE_COLUMNS: CSVColumn[] = [
  { key: "invoiceNumber", header: "Fakturanummer" },
  { key: "clientName", header: "Klient" },
  { key: "issueDate", header: "Udstedelsesdato", format: "date" },
  { key: "dueDate", header: "Forfaldsdato", format: "date" },
  { key: "amount", header: "Beløb", format: "currency" },
  { key: "status", header: "Status" },
  { key: "paidDate", header: "Betalt dato", format: "date" },
];

/**
 * Common export column definitions for clients
 */
export const CLIENT_COLUMNS: CSVColumn[] = [
  { key: "name", header: "Navn" },
  { key: "email", header: "Email" },
  { key: "phone", header: "Telefon" },
  { key: "company", header: "Virksomhed" },
  { key: "cvrNumber", header: "CVR" },
  { key: "address", header: "Adresse" },
  { key: "city", header: "By" },
  { key: "postalCode", header: "Postnr" },
  { key: "defaultHourlyRate", header: "Standard timepris", format: "currency" },
  { key: "totalHours", header: "Total timer", format: "number" },
  { key: "totalRevenue", header: "Total omsætning", format: "currency" },
];

/**
 * Common export column definitions for projects
 */
export const PROJECT_COLUMNS: CSVColumn[] = [
  { key: "name", header: "Projektnavn" },
  { key: "clientName", header: "Klient" },
  { key: "status", header: "Status" },
  { key: "startDate", header: "Startdato", format: "date" },
  { key: "endDate", header: "Slutdato", format: "date" },
  { key: "hourlyRate", header: "Timepris", format: "currency" },
  { key: "fixedPrice", header: "Fast pris", format: "currency" },
  { key: "totalHours", header: "Total timer", format: "number" },
  { key: "totalRevenue", header: "Omsætning", format: "currency" },
];

/**
 * Common export column definitions for klippekort/prepaid packages
 */
export const PREPAID_COLUMNS: CSVColumn[] = [
  { key: "name", header: "Klippekort" },
  { key: "clientName", header: "Klient" },
  { key: "totalHours", header: "Total timer", format: "number" },
  { key: "usedHours", header: "Brugt timer", format: "number" },
  { key: "remainingHours", header: "Resterende timer", format: "number" },
  { key: "hourlyRate", header: "Timepris", format: "currency" },
  { key: "totalValue", header: "Total værdi", format: "currency" },
  { key: "purchaseDate", header: "Købt", format: "date" },
  { key: "expiryDate", header: "Udløber", format: "date" },
  { key: "isActive", header: "Aktiv", format: "boolean" },
];

/**
 * Common export column definitions for tasks
 */
export const TASK_COLUMNS: CSVColumn[] = [
  { key: "title", header: "Titel" },
  { key: "description", header: "Beskrivelse" },
  { key: "projectName", header: "Projekt" },
  { key: "clientName", header: "Klient" },
  { key: "status", header: "Status" },
  { key: "priority", header: "Prioritet" },
  { key: "deadline", header: "Deadline", format: "date" },
  { key: "completedAt", header: "Fuldført", format: "date" },
  { key: "estimatedMinutes", header: "Estimeret (min)", format: "number" },
  { key: "actualMinutes", header: "Faktisk (min)", format: "number" },
  { key: "sourceType", header: "Kilde" },
  { key: "createdAt", header: "Oprettet", format: "date" },
];

/**
 * Common export column definitions for invoice lines
 */
export const INVOICE_LINE_COLUMNS: CSVColumn[] = [
  { key: "invoiceNumber", header: "Fakturanummer" },
  { key: "description", header: "Beskrivelse" },
  { key: "quantity", header: "Antal", format: "number" },
  { key: "unitPrice", header: "Enhedspris", format: "currency" },
  { key: "amount", header: "Beløb", format: "currency" },
  { key: "sortOrder", header: "Rækkefølge", format: "number" },
];

/**
 * Common export column definitions for prepaid usage
 */
export const PREPAID_USAGE_COLUMNS: CSVColumn[] = [
  { key: "packageName", header: "Klippekort" },
  { key: "hoursUsed", header: "Timer brugt", format: "number" },
  { key: "valueUsed", header: "Værdi brugt", format: "currency" },
  { key: "description", header: "Beskrivelse" },
  { key: "createdAt", header: "Dato", format: "date" },
];

/**
 * Common export column definitions for rate history
 */
export const RATE_HISTORY_COLUMNS: CSVColumn[] = [
  { key: "clientName", header: "Klient" },
  { key: "projectName", header: "Projekt" },
  { key: "oldRate", header: "Gammel pris", format: "currency" },
  { key: "newRate", header: "Ny pris", format: "currency" },
  { key: "rateType", header: "Type" },
  { key: "effectiveDate", header: "Gældende fra", format: "date" },
  { key: "reason", header: "Årsag" },
];

/**
 * Import template definitions — columns and example rows for each importable data type.
 * Headers use Danish names that match the auto-mapping aliases in DataImportWizard.
 */
export type ImportTemplateType =
  | "clients"
  | "projects"
  | "tasks"
  | "invoices"
  | "prepaidPackages"
  | "timeEntries";

interface ImportTemplateColumn {
  header: string;
  example: string;
  required: boolean;
}

const IMPORT_TEMPLATES: Record<ImportTemplateType, ImportTemplateColumn[]> = {
  clients: [
    { header: "Navn", example: "Acme ApS", required: true },
    { header: "Email", example: "kontakt@acme.dk", required: false },
    { header: "Telefon", example: "12345678", required: false },
    { header: "Virksomhed", example: "Acme ApS", required: false },
    { header: "CVR", example: "12345678", required: false },
    { header: "Adresse", example: "Vestergade 10", required: false },
    { header: "By", example: "København", required: false },
    { header: "Postnr", example: "1000", required: false },
    { header: "Land", example: "Danmark", required: false },
    { header: "Noter", example: "", required: false },
    { header: "Timepris", example: "750", required: false },
  ],
  projects: [
    { header: "Navn", example: "Website redesign", required: true },
    { header: "Klient", example: "Acme ApS", required: true },
    { header: "Beskrivelse", example: "Nyt website design", required: false },
    { header: "Timepris", example: "750", required: false },
    { header: "Fast pris", example: "", required: false },
    { header: "Status", example: "active", required: false },
  ],
  tasks: [
    { header: "Titel", example: "Design mockups", required: true },
    {
      header: "Beskrivelse",
      example: "Lav wireframes for forsiden",
      required: false,
    },
    { header: "Projekt", example: "Website redesign", required: false },
    { header: "Klient", example: "Acme ApS", required: false },
    { header: "Status", example: "todo", required: false },
    { header: "Prioritet", example: "medium", required: false },
    { header: "Deadline", example: "2026-04-01", required: false },
    { header: "Estimeret (min)", example: "120", required: false },
  ],
  invoices: [
    { header: "Fakturanummer", example: "2026-001", required: true },
    { header: "Klient", example: "Acme ApS", required: true },
    { header: "Beløb", example: "15000", required: true },
    { header: "Udstedelsesdato", example: "2026-03-01", required: true },
    { header: "Forfaldsdato", example: "2026-03-15", required: false },
    { header: "Betalt dato", example: "", required: false },
    { header: "Status", example: "sent", required: false },
    { header: "Noter", example: "", required: false },
  ],
  prepaidPackages: [
    { header: "Navn", example: "Support Q2 2026", required: true },
    { header: "Klient", example: "Acme ApS", required: true },
    { header: "Total timer", example: "20", required: true },
    { header: "Timepris", example: "750", required: true },
    { header: "Købsdato", example: "2026-03-01", required: true },
    { header: "Brugt timer", example: "0", required: false },
    { header: "Udløbsdato", example: "2026-06-30", required: false },
  ],
  timeEntries: [
    { header: "Dato", example: "2026-03-11", required: true },
    { header: "Timer", example: "2,5", required: true },
    { header: "Beskrivelse", example: "Frontend udvikling", required: false },
    { header: "Projekt", example: "Website redesign", required: false },
    { header: "Klient", example: "Acme ApS", required: false },
  ],
};

const IMPORT_TEMPLATE_LABELS: Record<ImportTemplateType, string> = {
  clients: "Klienter",
  projects: "Projekter",
  timeEntries: "Tidsregistreringer",
  tasks: "Opgaver",
  invoices: "Fakturaer",
  prepaidPackages: "Klippekort",
};

/**
 * Generate an import template CSV with headers and one example row.
 * Required columns are marked with * in the header name.
 * The example row can be deleted before importing — it serves as a guide.
 */
export function generateImportTemplate(type: ImportTemplateType): string {
  const template = IMPORT_TEMPLATES[type];
  const delimiter = ";";

  // Mark required columns with * in the header
  const headers = template
    .map((col) => (col.required ? `${col.header} *` : col.header))
    .join(delimiter);
  const example = template
    .map((col) => escapeCSVValue(col.example, delimiter))
    .join(delimiter);

  return [headers, example].join("\n");
}

/**
 * Generate a ZIP file containing import template CSVs for all data types.
 * Each file is named after its Danish label.
 */
export async function generateAllImportTemplatesZip(): Promise<Blob> {
  const { zipSync, strToU8 } = await import("fflate");

  const BOM = "\uFEFF";
  const files: Record<string, Uint8Array> = {};

  for (const type of Object.keys(IMPORT_TEMPLATES) as ImportTemplateType[]) {
    const label = IMPORT_TEMPLATE_LABELS[type]
      .toLowerCase()
      .replace(/\s/g, "-");
    const csv = generateImportTemplate(type);
    files[`import-skabelon-${label}.csv`] = strToU8(BOM + csv);
  }

  const zipped = zipSync(files);
  return new Blob([zipped.buffer as ArrayBuffer], { type: "application/zip" });
}
