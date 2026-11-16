import { describe, expect, it } from "vitest";
import { usageCSV, usageExportRows } from "./usage-export";

const usage = [
  {
    id: "u1",
    date: "2026-02-01",
    description: '=HYPERLINK("test")',
    hoursUsed: "1.25",
    valueUsed: "625",
  },
  {
    id: "u2",
    date: "2026-03-01",
    description: 'Møde; "test"\nNy linje',
    hoursUsed: "0.50",
    valueUsed: "250",
  },
];

describe("klippekort usage export", () => {
  it("sorts the entire history newest first without mutating it", () => {
    expect(usageExportRows(usage, false)[0].description).toBe(
      usage[1].description,
    );
    expect(usage[0].hoursUsed).toBe("1.25");
    expect(
      usageExportRows(
        Array.from({ length: 150 }, () => usage[0]),
        false,
      ),
    ).toHaveLength(150);
  });
  it("omits values entirely when hidden or unavailable in the portal", () => {
    expect(usageExportRows(usage, false)[0]).not.toHaveProperty("value");
    expect(usageCSV(usage, false)).not.toContain("Værdi");
    expect(
      usageCSV([{ ...usage[0], valueUsed: undefined }], true),
    ).not.toContain("Værdi");
    expect(usageCSV(usage, true)).toContain("625,00");
  });
  it("escapes Danish CSV and neutralizes spreadsheet formulas", () => {
    const csv = usageCSV(usage, false);
    expect(csv).toContain("1,25");
    expect(csv).toContain('"Møde; ""test""\nNy linje"');
    expect(csv).toContain("'=HYPERLINK");
  });
});
