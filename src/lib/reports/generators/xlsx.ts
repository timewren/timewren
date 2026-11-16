// src/lib/reports/generators/xlsx.ts
import { sharedT } from "@/i18n/shared-text";
import type { ReportEntry } from "../columns";
import { entryColumns, REPORT_COLUMNS, reportColumnLabel } from "../columns";
import type { ReportColumnKey } from "../config-schema";
import type { ReportAggregates } from "../query";

const COLUMN_WIDTHS: Partial<Record<ReportColumnKey, number>> = {
  date: 12,
  client: 24,
  project: 24,
  description: 40,
  hours: 10,
  roundedHours: 14,
  rate: 12,
  value: 14,
  billed: 12,
  prepaid: 12,
  prepaidPackage: 24,
  tags: 20,
  member: 20,
  fromTemplate: 14,
};

export async function generateXLSX(
  entries: ReportEntry[],
  opts: {
    columns: readonly ReportColumnKey[];
    /** Gruppe-niveau data (budget) på et eget ark — kun når den er valgt */
    groups?: ReportAggregates["groups"];
    groupingNote?: string | null;
  },
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sharedT("sharedReports", "sheetReport"));

  const cols = entryColumns(opts.columns);

  ws.columns = cols.map((k) => ({
    header: reportColumnLabel(k),
    key: k,
    width: COLUMN_WIDTHS[k] ?? 15,
  }));

  ws.getRow(1).font = { bold: true };

  for (const entry of entries) {
    const row: Record<string, string | number | boolean> = {};
    for (const k of cols) {
      const col = REPORT_COLUMNS[k];
      // Plain values become typed cells; ExcelJS only writes a formula for
      // { formula } objects, so text like "=1+1" is never evaluated.
      row[k] = col.getValue(entry);
    }
    ws.addRow(row);
  }

  ws.views = [{ state: "frozen", ySplit: 1 }];

  if (opts.groups && opts.groups.length > 0) {
    const gs = wb.addWorksheet(sharedT("sharedReports", "sheetGroups"));
    gs.columns = [
      { header: sharedT("sharedReports", "group"), key: "label", width: 36 },
      {
        header: sharedT("sharedReports", "columns.hours"),
        key: "hours",
        width: 12,
      },
      {
        header: sharedT("sharedReports", "revenue"),
        key: "revenue",
        width: 14,
      },
      {
        header: sharedT("sharedReports", "monthlyBudget"),
        key: "budgetHours",
        width: 16,
      },
      {
        header: sharedT("sharedReports", "usedInMonth"),
        key: "usedHours",
        width: 16,
      },
      {
        header: sharedT("sharedReports", "usedPct"),
        key: "percentage",
        width: 12,
      },
    ];
    gs.getRow(1).font = { bold: true };
    for (const g of opts.groups) {
      gs.addRow({
        label: g.label,
        hours: g.hours,
        revenue: g.revenue,
        budgetHours: g.budget?.budgetHours ?? "",
        usedHours: g.budget?.usedHours ?? "",
        percentage: g.budget?.percentage ?? "",
      });
    }
    if (opts.groupingNote) {
      gs.addRow({});
      gs.addRow({ label: opts.groupingNote });
    }
    gs.views = [{ state: "frozen", ySplit: 1 }];
  }

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
