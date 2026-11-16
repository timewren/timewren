import { type CSVColumn, convertToCSV } from "@/lib/utils/csv-export";
import { sanitizeForSpreadsheet } from "@/lib/utils/spreadsheet";

export interface ExportUsage {
  id: string;
  date: Date | string;
  description: string;
  hoursUsed: string | number;
  valueUsed?: string | number | null;
}

export function usageExportRows(usage: ExportUsage[], showValue: boolean) {
  const includeValue = showValue && usage.every((u) => u.valueUsed != null);
  return [...usage]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .map((u) => ({
      id: u.id,
      date: new Date(u.date).toLocaleDateString("da-DK", {
        timeZone: "Europe/Copenhagen",
      }),
      description: u.description,
      hours: Number(u.hoursUsed),
      ...(includeValue ? { value: Number(u.valueUsed) } : {}),
    }));
}

export function usageCSV(usage: ExportUsage[], showValue: boolean): string {
  const rows = usageExportRows(usage, showValue);
  const columns: CSVColumn[] = [
    { key: "date", header: "Dato" },
    { key: "description", header: "Beskrivelse" },
    { key: "hours", header: "Timer", format: "number" },
  ];
  if (rows[0]?.value !== undefined)
    columns.push({ key: "value", header: "Værdi", format: "number" });
  return convertToCSV(
    rows.map((r) => ({
      ...r,
      description: sanitizeForSpreadsheet(r.description),
    })),
    columns,
  );
}
