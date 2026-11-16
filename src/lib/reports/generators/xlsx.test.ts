// src/lib/reports/generators/xlsx.test.ts
import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import type { ReportEntry } from "../columns";
import { generateXLSX } from "./xlsx";

const mk = (): ReportEntry => ({
  id: "e1",
  source: "manual",
  approvalStatus: null,
  segments: [],
  date: new Date(2026, 2, 15, 12, 0),
  startTime: null,
  endTime: null,
  hours: "2.00",
  billableRate: "500",
  description: "Work",
  isBilled: false,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 2,
  _value: 1000,
  client: { id: "c1", name: "Acme" },
  project: { id: "p1", name: "Web", client: null, monthlyBudgetHours: null },
  prepaidPackage: null,
  tags: [],
  task: null,
  member: null,
});

describe("generateXLSX", () => {
  it("produces a parseable xlsx with headers matching columns", async () => {
    const buf = await generateXLSX([mk()], {
      columns: ["date", "client", "hours"],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet(1);
    expect(ws?.getCell("A1").value).toBe("Dato");
    expect(ws?.getCell("B1").value).toBe("Kunde");
    expect(ws?.getCell("C1").value).toBe("Timer");
    expect(ws?.getCell("B2").value).toBe("Acme");
  });

  it("freezes the header row", async () => {
    const buf = await generateXLSX([mk()], { columns: ["date"] });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const ws = wb.getWorksheet(1);
    const view = ws?.views?.[0] as
      | import("exceljs").WorksheetViewFrozen
      | undefined;
    expect(view?.state).toBe("frozen");
    expect(view?.ySplit).toBe(1);
  });

  it("writes formula-like text as plain string cells without a prefix", async () => {
    const entry = { ...mk(), description: "=1+1" };
    const buf = await generateXLSX([entry], {
      columns: ["description"],
      groups: [
        {
          key: "g1",
          label: "@SUM(A1)",
          hours: 1,
          revenue: 0,
          entries: [],
          budget: null,
        },
      ],
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const cell = wb.getWorksheet(1)?.getCell("A2");
    expect(cell?.value).toBe("=1+1");
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
    const group = wb.getWorksheet(2)?.getCell("A2");
    expect(group?.value).toBe("@SUM(A1)");
    expect(group?.type).toBe(ExcelJS.ValueType.String);
  });
});
