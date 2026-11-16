import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  buildPayrollExport,
  layoutForSystem,
  payrollExportToCsv,
  payrollExportToXlsx,
} from "../export";
import type { WageLineTotal } from "../mapping";

const totals: WageLineTotal[] = [
  {
    userId: "u1",
    employeeNumber: "1001",
    externalPayrollId: "00012345",
    employeeName: "Mette Jensen",
    departmentName: "Værksted",
    code: "0100",
    name: "Normaltimer",
    unit: "hours",
    quantity: 148,
    supplement: false,
  },
  {
    userId: "u1",
    employeeNumber: "1001",
    externalPayrollId: "00012345",
    employeeName: "Mette Jensen",
    departmentName: "Værksted",
    code: "0300",
    name: "Sygdom",
    unit: "days",
    quantity: 2,
    supplement: false,
  },
];

describe("buildPayrollExport", () => {
  it("generisk layout: medarbejdernr;lønart;antal;enhed;periode", () => {
    const t = buildPayrollExport(totals, {
      system: "generic",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(t.headers.slice(0, 6)).toEqual([
      "Medarbejdernr",
      "Lønart",
      "Antal",
      "Enhed",
      "PeriodeStart",
      "PeriodeSlut",
    ]);
    expect(t.rows[0].slice(0, 6)).toEqual([
      "1001",
      "0100",
      148,
      "T",
      "2026-08-01",
      "2026-08-31",
    ]);
    expect(t.rows[1][3]).toBe("D");
  });

  it("SD-layout bruger tjenestenummer og DD-MM-YYYY", () => {
    const t = buildPayrollExport(totals, {
      system: "sd",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(t.headers[0]).toBe("Tjenestenummer");
    expect(t.rows[0]).toEqual([
      "00012345",
      "0100",
      148,
      "T",
      "01-08-2026",
      "31-08-2026",
      "Mette Jensen",
    ]);
  });

  it("SD falder tilbage til medarbejdernummer uden eksternt id", () => {
    const t = buildPayrollExport([{ ...totals[0], externalPayrollId: "" }], {
      system: "sd",
      from: "2026-08-01",
      to: "2026-08-31",
    });
    expect(t.rows[0][0]).toBe("1001");
  });

  it("øvrige systemer bruger det generiske layout", () => {
    for (const s of ["kmd", "sls", "danloen", "dataloen"] as const) {
      expect(layoutForSystem(s)).toBe("generic");
    }
    expect(layoutForSystem("sd")).toBe("sd");
  });

  it("CSV: BOM, semikolon, decimalkomma, CRLF", () => {
    const csv = payrollExportToCsv(
      buildPayrollExport([{ ...totals[0], quantity: 7.5 }], {
        system: "generic",
        from: "2026-08-01",
        to: "2026-08-31",
      }),
    );
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    const lines = csv.slice(1).split("\r\n");
    expect(lines[0].startsWith("Medarbejdernr;Lønart;Antal;Enhed")).toBe(true);
    expect(lines[1]).toBe(
      "1001;0100;7,50;T;2026-08-01;2026-08-31;Mette Jensen;Normaltimer;Værksted;00012345",
    );
  });

  it("XLSX skriver formel-lignende tekst som almindelig tekst uden apostrof", async () => {
    const buf = await payrollExportToXlsx(
      { headers: ["Medarbejder", "Antal"], rows: [["@SUM(A1)", 1.5]] },
      { title: "Løn", period: "2026-10" },
    );
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    const cell = wb.getWorksheet(1)?.getCell("A5");
    expect(cell?.value).toBe("@SUM(A1)");
    expect(cell?.type).toBe(ExcelJS.ValueType.String);
  });
});
