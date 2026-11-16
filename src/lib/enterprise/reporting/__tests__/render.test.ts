import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { AggregatedRow, AggregateResult } from "../aggregate";
import {
  COLUMN_GROUPS,
  ENTERPRISE_COLUMN_KEYS,
  ENTERPRISE_COLUMNS,
  formatCellValue,
} from "../columns";
import { REPORT_TYPE_DEFINITIONS } from "../config";
import {
  buildReportTable,
  reportTableToCsv,
  reportTableToXlsx,
  resolveTableColumns,
} from "../render";

function row(
  over: Partial<AggregatedRow> & { values?: Partial<AggregatedRow["values"]> },
): AggregatedRow {
  return {
    keys: {},
    labels: {},
    attributes: {
      email: "",
      employmentType: "",
      weeklyHours: null,
      dailyNorm: null,
      employeeNumber: "",
      payrollCode: "",
    },
    pivots: {
      hoursByActivity: {},
      absenceDaysByType: {},
      absenceHoursByType: {},
      quantityByWageType: {},
    },
    ...over,
    values: { hours: 0, absenceDays: 0, sickPct: null, ...(over.values ?? {}) },
  };
}

const result = (
  rows: AggregatedRow[],
  totals: AggregatedRow,
): AggregateResult => ({
  rows,
  totals,
  pivotNames: {
    activities: ["Undervisning"],
    absenceTypes: ["Ferie", "Sygdom"],
    wageTypes: [],
  },
  employeeCount: rows.length,
});

describe("kolonnekatalog", () => {
  it("har dansk label og format for alle nøgler, og grupperne dækker kataloget", () => {
    for (const key of ENTERPRISE_COLUMN_KEYS) {
      expect(ENTERPRISE_COLUMNS[key].label.length).toBeGreaterThan(0);
    }
    const grouped = new Set(COLUMN_GROUPS.flatMap((g) => g.keys));
    expect([...grouped].sort()).toEqual([...ENTERPRISE_COLUMN_KEYS].sort());
  });

  it("alle rapporttypers default-kolonner findes i kataloget", () => {
    for (const def of Object.values(REPORT_TYPE_DEFINITIONS)) {
      for (const key of [...def.defaultColumns, ...def.suggestedColumns]) {
        expect(ENTERPRISE_COLUMNS[key]).toBeDefined();
      }
    }
  });

  it("formaterer med dansk decimalkomma", () => {
    expect(formatCellValue(7.4, "hours")).toBe("7,40");
    expect(formatCellValue(5.66, "percent")).toBe("5,7 %");
    expect(formatCellValue(3, "integer")).toBe("3");
    expect(formatCellValue(true, "boolean")).toBe("Ja");
    expect(formatCellValue(null, "hours")).toBe("");
  });
});

describe("resolveTableColumns + buildReportTable", () => {
  it("udfolder pivot-kolonner til én kolonne pr. type", () => {
    const cols = resolveTableColumns(
      ["employee", "absenceDaysByType", "hoursByActivity"],
      {
        activities: ["Undervisning"],
        absenceTypes: ["Ferie", "Sygdom"],
        wageTypes: [],
      },
    );
    expect(cols.map((c) => c.label)).toEqual([
      "Medarbejder",
      "Ferie (dage)",
      "Sygdom (dage)",
      "Undervisning (timer)",
    ]);
  });

  it("fjerner tomme rækker, laver subtotaler pr. første dimension og totalrække", () => {
    const rows = [
      row({
        keys: { department: "d1", employee: "u1" },
        labels: { department: "Produktion", employee: "Anna" },
        values: { hours: 4, absenceDays: 1 },
      }),
      row({
        keys: { department: "d1", employee: "u2" },
        labels: { department: "Produktion", employee: "Bo" },
        values: { hours: 2 },
      }),
      row({
        keys: { department: "d1", employee: "u3" },
        labels: { department: "Produktion", employee: "Tom" },
        values: { hours: 0 },
      }),
      row({
        keys: { department: "d2", employee: "u4" },
        labels: { department: "Køkken", employee: "Eva" },
        values: { hours: 3 },
      }),
    ];
    const subtotals = [
      row({
        keys: { department: "d1" },
        labels: { department: "Produktion" },
        values: { hours: 6, absenceDays: 1 },
      }),
      row({
        keys: { department: "d2" },
        labels: { department: "Køkken" },
        values: { hours: 3 },
      }),
    ];
    const totals = row({ values: { hours: 9, absenceDays: 1 } });
    const table = buildReportTable({
      result: result(rows, totals),
      subtotals: result(subtotals, totals),
      columns: ["department", "employee", "hours", "absenceDays"],
      dimensions: ["department", "employee"],
    });
    expect(table.rows.map((r) => r.cells)).toEqual([
      ["Produktion", "Anna", 4, 1],
      ["Produktion", "Bo", 2, 0],
      ["Subtotal Produktion", "", 6, 1],
      ["Køkken", "Eva", 3, 0],
    ]);
    expect(table.rows[2].subtotal).toBe(true);
    expect(table.totals).toEqual(["Total", "", 9, 1]);
  });

  it("CSV bruger semikolon, decimalkomma og BOM", () => {
    const rows = [
      row({
        keys: { employee: "u1" },
        labels: { employee: "Anna; A/S" },
        values: { hours: 7.4, sickPct: 5.5 },
      }),
    ];
    const table = buildReportTable({
      result: result(rows, row({ values: { hours: 7.4, sickPct: 5.5 } })),
      subtotals: null,
      columns: ["employee", "hours", "sickPct"],
      dimensions: ["employee"],
    });
    const csv = reportTableToCsv(table);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines[0]).toBe("Medarbejder;Registrerede timer;Sygefravær %");
    expect(lines[1]).toBe('"Anna; A/S";7,40;5,5 %');
    expect(lines[2]).toBe("Total;7,40;5,5 %");
  });

  it("XLSX skriver formel-lignende tekst som almindelig tekst uden apostrof", async () => {
    const table = buildReportTable({
      result: result(
        [
          row({
            keys: { employee: "u1" },
            labels: { employee: "=1+1" },
            values: { hours: 7.4 },
          }),
        ],
        row({ values: { hours: 7.4 } }),
      ),
      subtotals: null,
      columns: ["employee", "hours"],
      dimensions: ["employee"],
    });
    const buf = await reportTableToXlsx(table, {
      title: "Rapport",
      period: "2026",
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const cell = wb.getWorksheet(1)?.getCell("A5");
    expect(cell?.value).toBe("=1+1");
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
  });
});
