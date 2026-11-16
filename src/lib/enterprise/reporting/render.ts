/**
 * Ét kolonne-mapping → tabel (UI/JSON), CSV (lib/enterprise/csv.ts: semikolon,
 * decimalkomma, BOM) og XLSX. PDF ligger i pdf.tsx oven på samme tabel.
 */
import { sharedT } from "@/i18n/shared-text";
import { buildCsv } from "../csv";
import type { AggregatedRow, AggregateResult, CellValue } from "./aggregate";
import {
  type ColumnFormat,
  columnDef,
  ENTERPRISE_COLUMNS,
  type EnterpriseColumnKey,
  enterpriseColumnLabel,
  enterprisePivotLabel,
  formatCellValue,
} from "./columns";
import type { ReportDimension } from "./config";

export type ReportTableColumn = {
  /** Unik nøgle — pivot-kolonner får "absenceDaysByType:Sygdom" */
  id: string;
  key: EnterpriseColumnKey;
  label: string;
  format: ColumnFormat;
  pivotName?: string;
};

export type ReportTableRow = {
  cells: CellValue[];
  /** Subtotal for første dimension (vises fremhævet) */
  subtotal?: boolean;
  /** Antal rækker under subtotalen */
  groupSize?: number;
};

export type ReportTable = {
  columns: ReportTableColumn[];
  rows: ReportTableRow[];
  totals: CellValue[];
};

const DIMENSION_KEYS = new Set<EnterpriseColumnKey>([
  "employee",
  "department",
  "project",
  "activityType",
  "absenceType",
  "day",
  "week",
  "month",
  "vacationYear",
]);

/** Udfold config-kolonner til konkrete tabelkolonner (pivots pr. typenavn). */
export function resolveTableColumns(
  columns: readonly EnterpriseColumnKey[],
  pivotNames: AggregateResult["pivotNames"],
): ReportTableColumn[] {
  const out: ReportTableColumn[] = [];
  for (const key of columns) {
    const def = columnDef(key);
    if (def.kind === "pivot") {
      const names =
        key === "hoursByActivity"
          ? pivotNames.activities
          : key === "quantityByWageType"
            ? pivotNames.wageTypes
            : pivotNames.absenceTypes;
      for (const name of names) {
        out.push({
          id: `${key}:${name}`,
          key,
          label: enterprisePivotLabel(key, name),
          format: def.format,
          pivotName: name,
        });
      }
      continue;
    }
    out.push({
      id: key,
      key,
      label: enterpriseColumnLabel(key),
      format: def.format,
    });
  }
  return out;
}

export function cellFor(row: AggregatedRow, col: ReportTableColumn): CellValue {
  const def = ENTERPRISE_COLUMNS[col.key];
  if (def.kind === "pivot" && col.pivotName) {
    const map =
      col.key === "hoursByActivity"
        ? row.pivots.hoursByActivity
        : col.key === "absenceDaysByType"
          ? row.pivots.absenceDaysByType
          : col.key === "quantityByWageType"
            ? row.pivots.quantityByWageType
            : row.pivots.absenceHoursByType;
    return map[col.pivotName] ?? 0;
  }
  if (DIMENSION_KEYS.has(col.key)) {
    return row.labels[col.key as ReportDimension] ?? "";
  }
  if (def.kind === "attribute") {
    return row.attributes[col.key as keyof AggregatedRow["attributes"]] ?? "";
  }
  return row.values[col.key] ?? null;
}

/** Har rækken data i mindst én valgt mål-/pivot-kolonne? */
export function rowHasData(row: AggregatedRow, columns: ReportTableColumn[]) {
  return columns.some((col) => {
    const def = ENTERPRISE_COLUMNS[col.key];
    if (def.kind !== "measure" && def.kind !== "pivot") return false;
    const v = cellFor(row, col);
    if (v == null || v === false || v === "") return false;
    if (typeof v === "number") return v !== 0;
    return true;
  });
}

/**
 * Byg tabellen: rækker (uden tomme), subtotaler pr. første dimension når
 * der er ≥ 2 dimensioner (aggregeret separat — procenter er ikke additive),
 * og totalrække.
 */
export function buildReportTable(params: {
  result: AggregateResult;
  subtotals: AggregateResult | null;
  columns: readonly EnterpriseColumnKey[];
  dimensions: readonly ReportDimension[];
}): ReportTable {
  const { result, subtotals, columns, dimensions } = params;
  const tableColumns = resolveTableColumns(columns, result.pivotNames);
  const rows = result.rows.filter((r) => rowHasData(r, tableColumns));

  const out: ReportTableRow[] = [];
  const firstDim = dimensions[0];
  if (subtotals && firstDim && dimensions.length >= 2) {
    const subtotalByKey = new Map(
      subtotals.rows.map((r) => [r.keys[firstDim] ?? "", r]),
    );
    let groupKey: string | null = null;
    let groupRows: ReportTableRow[] = [];
    const flush = () => {
      if (groupKey === null) return;
      const sub = subtotalByKey.get(groupKey);
      out.push(...groupRows);
      if (sub && groupRows.length > 1) {
        out.push({
          cells: tableColumns.map((col) => {
            if (col.id === firstDim)
              return sharedT("sharedReports", "enterprise.subtotal", {
                name: sub.labels[firstDim] ?? "",
              });
            if (DIMENSION_KEYS.has(col.key)) return "";
            return cellFor(sub, col);
          }),
          subtotal: true,
          groupSize: groupRows.length,
        });
      }
      groupRows = [];
    };
    for (const r of rows) {
      const k = r.keys[firstDim] ?? "";
      if (k !== groupKey) {
        flush();
        groupKey = k;
      }
      groupRows.push({ cells: tableColumns.map((c) => cellFor(r, c)) });
    }
    flush();
  } else {
    for (const r of rows) {
      out.push({ cells: tableColumns.map((c) => cellFor(r, c)) });
    }
  }

  const totals = tableColumns.map((col, i) => {
    if (DIMENSION_KEYS.has(col.key))
      return i === 0 ? sharedT("sharedReports", "enterprise.total") : "";
    const def = ENTERPRISE_COLUMNS[col.key];
    if (def.kind === "attribute") return "";
    return cellFor(result.totals, col);
  });

  return { columns: tableColumns, rows: out, totals };
}

/** CSV i lønsystem-format (semikolon, decimalkomma, CRLF, BOM). */
export function reportTableToCsv(table: ReportTable): string {
  const toCell = (v: CellValue, format: ColumnFormat): string | number => {
    if (typeof v === "number" && format !== "percent" && format !== "integer") {
      return v; // buildCsv formaterer tal med decimalkomma
    }
    return formatCellValue(v, format);
  };
  return buildCsv(
    table.columns.map((c) => c.label),
    [
      ...table.rows.map((r) =>
        r.cells.map((v, i) => toCell(v, table.columns[i].format)),
      ),
      table.totals.map((v, i) => toCell(v, table.columns[i].format)),
    ],
  );
}

/** XLSX via exceljs (samme mønster som lib/reports/generators/xlsx.ts). */
export async function reportTableToXlsx(
  table: ReportTable,
  opts: { title: string; period: string },
): Promise<ArrayBuffer> {
  const ExcelJS = (await import("exceljs")).default;
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sharedT("sharedReports", "enterprise.sheet"));

  ws.addRow([opts.title]).font = { bold: true, size: 14 };
  ws.addRow([
    sharedT("sharedReports", "enterprise.periodLabel", { period: opts.period }),
  ]);
  ws.addRow([]);
  const headerRow = ws.addRow(table.columns.map((c) => c.label));
  headerRow.font = { bold: true };

  const writeRow = (row: CellValue[], bold: boolean) => {
    const values = row.map((v, i) => {
      const format = table.columns[i].format;
      if (typeof v === "number") return v;
      if (typeof v === "boolean") {
        return sharedT("sharedFormat", v ? "yes" : "no");
      }
      if (v == null) return "";
      // Typed string cells are never evaluated as formulas, so no prefix.
      return formatCellValue(v, format);
    });
    const r = ws.addRow(values);
    if (bold) r.font = { bold: true };
    row.forEach((v, i) => {
      if (typeof v !== "number") return;
      const cell = r.getCell(i + 1);
      const format = table.columns[i].format;
      cell.numFmt =
        format === "integer" ? "0" : format === "percent" ? '0.0" %"' : "0.00";
    });
  };
  for (const row of table.rows) writeRow(row.cells, !!row.subtotal);
  writeRow(table.totals, true);

  ws.columns.forEach((col, i) => {
    const label = table.columns[i]?.label ?? "";
    col.width = Math.min(40, Math.max(12, label.length + 4));
  });
  ws.views = [{ state: "frozen", ySplit: 4 }];

  const buf = await wb.xlsx.writeBuffer();
  return buf as ArrayBuffer;
}
