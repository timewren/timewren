import { toIntlLocale } from "@/i18n/format-locale";
import { type CSVColumn, convertToCSV } from "@/lib/utils/csv-export";
import { sanitizeForSpreadsheet } from "@/lib/utils/spreadsheet";

export interface ExportUsage {
  id: string;
  date: Date | string;
  description: string;
  hoursUsed: string | number;
  valueUsed?: string | number | null;
}

export function usageExportRows(
  usage: ExportUsage[],
  showValue: boolean,
  locale = "da",
) {
  const intlLocale = toIntlLocale(locale);
  const includeValue = showValue && usage.every((u) => u.valueUsed != null);
  return [...usage]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((u) => ({
      id: u.id,
      date: new Date(u.date).toLocaleDateString(intlLocale, {
        timeZone: "Europe/Copenhagen",
      }),
      description: u.description,
      hours: Number(u.hoursUsed),
      ...(includeValue ? { value: Number(u.valueUsed) } : {}),
    }));
}

export function usageCSV(
  usage: ExportUsage[],
  showValue: boolean,
  labels?: {
    locale: string;
    date: string;
    description: string;
    hours: string;
    value: string;
  },
): string {
  const rows = usageExportRows(usage, showValue, labels?.locale);
  const columns: CSVColumn[] = [
    { key: "date", header: labels?.date ?? "Dato" },
    { key: "description", header: labels?.description ?? "Beskrivelse" },
    { key: "hours", header: labels?.hours ?? "Timer", format: "number" },
  ];
  if (rows[0]?.value !== undefined)
    columns.push({
      key: "value",
      header: labels?.value ?? "Værdi",
      format: "number",
    });
  return convertToCSV(
    rows.map((r) => ({
      ...r,
      description: sanitizeForSpreadsheet(r.description),
    })),
    columns,
  );
}
