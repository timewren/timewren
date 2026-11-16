// src/lib/reports/columns.test.ts
import { describe, expect, it } from "vitest";
import { formatReportCell, formatReportHours, REPORT_COLUMNS } from "./columns";

const makeEntry = () => ({
  date: new Date("2026-03-15T12:00:00"),
  hours: "2.50",
  billableRate: "750",
  description: "Kode-review",
  isBilled: true,
  isBillable: true,
  isPrepaid: false,
  clientDefaultBillable: true,
  isFromTemplate: false,
  _rounded: 2.5,
  _value: 1875,
  client: { id: "c1", name: "Acme ApS" },
  project: { id: "p1", name: "Website", client: null },
  prepaidPackage: null,
  tags: [{ id: "t1", name: "backend" }],
  member: null,
});

describe("REPORT_COLUMNS", () => {
  it("date returns local YYYY-MM-DD", () => {
    expect(REPORT_COLUMNS.date.getValue(makeEntry() as never)).toBe(
      "2026-03-15",
    );
  });

  it("client prefers direct client over project.client", () => {
    expect(REPORT_COLUMNS.client.getValue(makeEntry() as never)).toBe(
      "Acme ApS",
    );
  });

  it("hours returns numeric", () => {
    expect(REPORT_COLUMNS.hours.getValue(makeEntry() as never)).toBe(2.5);
  });

  it("value returns rounded hours * rate", () => {
    expect(REPORT_COLUMNS.value.getValue(makeEntry() as never)).toBe(1875);
  });

  it("billed returns boolean", () => {
    expect(REPORT_COLUMNS.billed.getValue(makeEntry() as never)).toBe(true);
  });

  it("tags joins tag names", () => {
    expect(REPORT_COLUMNS.tags.getValue(makeEntry() as never)).toBe("backend");
  });
});

describe("formatReportCell", () => {
  it("viser datoer som dansk talform", () => {
    expect(formatReportCell("2026-03-15", "date")).toBe("15.03.2026");
    expect(formatReportCell("", "date")).toBe("");
  });

  it("viser timer med decimalkomma", () => {
    expect(formatReportCell(2.5, "time")).toBe("2,5");
    expect(formatReportCell(1.25, "time")).toBe("1,25");
  });

  it("viser beløb med tusindtalspunktum og kr", () => {
    expect(formatReportCell(1875, "currency")).toBe("1.875 kr");
    expect(formatReportCell(812.5, "currency")).toBe("812,5 kr");
  });

  it("viser ja/nej og lader tekst være", () => {
    expect(formatReportCell(true, "boolean")).toBe("Ja");
    expect(formatReportCell(false, "boolean")).toBe("Nej");
    expect(formatReportCell("Acme ApS", "text")).toBe("Acme ApS");
  });
});

describe("formatReportHours", () => {
  it("bruger decimalkomma og mellemrum før t", () => {
    expect(formatReportHours(29.5)).toBe("29,5 t");
    expect(formatReportHours(0)).toBe("0,0 t");
    expect(formatReportHours(1234.56)).toBe("1.234,6 t");
  });
});
