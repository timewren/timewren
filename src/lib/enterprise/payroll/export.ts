/**
 * Lønperiode-eksport (E5, #463): flad fil pr. medarbejder × lønart som
 * danske lønsystemer kan importere. Layoutet dokumenteres i
 * docs/PAYROLL-EXPORT.md. Ren — CSV bygges med lib/enterprise/csv.ts
 * (semikolon, decimalkomma, CRLF, BOM).
 */
import { syncT } from "@/i18n/sync-text";
import { buildCsv } from "../csv";
import type { WageLineTotal } from "./mapping";

export const PAYROLL_SYSTEMS = [
  "generic",
  "sd",
  "kmd",
  "sls",
  "danloen",
  "dataloen",
] as const;
export type PayrollSystem = (typeof PAYROLL_SYSTEMS)[number];

export const PAYROLL_SYSTEM_LABELS: Record<PayrollSystem, string> = {
  generic: "Generisk (flad CSV)",
  sd: "SD Løn",
  kmd: "KMD Opus",
  sls: "SLS (Statens Lønsystem)",
  danloen: "Danløn",
  dataloen: "DataLøn",
};

export const PAYROLL_PERIOD_TYPES = ["month", "biweekly"] as const;
export type PayrollPeriodType = (typeof PAYROLL_PERIOD_TYPES)[number];

export const PAYROLL_PERIOD_TYPE_LABELS: Record<PayrollPeriodType, string> = {
  month: "Måned",
  biweekly: "14 dage",
};

export type PayrollExportLayout = "generic" | "sd";

/**
 * Hvilket layout et lønsystem bruger. SD har eget kolonnesæt; de øvrige
 * bruger det generiske layout indtil formatet er verificeret mod
 * lønkontorets importspecifikation (dokumenteret i docs/PAYROLL-EXPORT.md).
 */
export function layoutForSystem(system: PayrollSystem): PayrollExportLayout {
  return system === "sd" ? "sd" : "generic";
}

export type PayrollExportOptions = {
  system: PayrollSystem;
  from: string;
  to: string;
};

export type PayrollExportTable = {
  headers: string[];
  rows: Array<Array<string | number>>;
};

function ddmmyyyy(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}-${m}-${y}`;
}

const UNIT_CODE = { hours: "T", days: "D" } as const;

/**
 * Byg eksporttabellen. Rækkefølge = totals' (medarbejder, lønart).
 * Medarbejdere uden nummer eksporteres med tom kolonne — kalderen advarer.
 */
export function buildPayrollExport(
  totals: readonly WageLineTotal[],
  opts: PayrollExportOptions,
): PayrollExportTable {
  const layout = layoutForSystem(opts.system);
  if (layout === "sd") {
    return {
      headers: [
        "Tjenestenummer",
        "Lønart",
        "Antal",
        "Enhed",
        "Fra dato",
        "Til dato",
        "Navn",
      ],
      rows: totals.map((t) => [
        t.externalPayrollId || t.employeeNumber,
        t.code,
        t.quantity,
        UNIT_CODE[t.unit],
        ddmmyyyy(opts.from),
        ddmmyyyy(opts.to),
        t.employeeName,
      ]),
    };
  }
  return {
    headers: [
      "Medarbejdernr",
      "Lønart",
      "Antal",
      "Enhed",
      "PeriodeStart",
      "PeriodeSlut",
      "Navn",
      "Lønartnavn",
      "Afdeling",
      "EksterntId",
    ],
    rows: totals.map((t) => [
      t.employeeNumber,
      t.code,
      t.quantity,
      UNIT_CODE[t.unit],
      opts.from,
      opts.to,
      t.employeeName,
      t.name,
      t.departmentName,
      t.externalPayrollId,
    ]),
  };
}

export function payrollExportToCsv(table: PayrollExportTable): string {
  return buildCsv(table.headers, table.rows);
}

/** XLSX via exceljs — ét ark, samme kolonner som CSV'en. */
export async function payrollExportToXlsx(
  table: PayrollExportTable,
  opts: { title: string; period: string },
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(syncT("enterprise.payrollXlsx.sheet"));
  ws.addRow([opts.title]).font = { bold: true, size: 14 };
  ws.addRow([syncT("enterprise.payrollXlsx.period", { period: opts.period })]);
  ws.addRow([]);
  ws.addRow(table.headers).font = { bold: true };
  for (const row of table.rows) {
    // Typed string cells are never evaluated as formulas, so no prefix.
    const r = ws.addRow(row);
    row.forEach((v, i) => {
      if (typeof v === "number") r.getCell(i + 1).numFmt = "0.00";
    });
  }
  ws.columns.forEach((col, i) => {
    const label = table.headers[i] ?? "";
    col.width = Math.min(40, Math.max(12, label.length + 4));
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];
  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
