import { describe, expect, it } from "vitest";
import { csvCell } from "@/lib/resource-plan/export";
import { CLIENT_COLUMNS, convertToCSV } from "@/lib/utils/csv-export";
import { buildCsv, csvEscape } from "../csv";

describe("spreadsheet-safe CSV", () => {
  it("pins ordinary enterprise output including BOM, decimals and CRLF", () => {
    expect(
      buildCsv(
        ["Tekst", "Tal"],
        [
          ["æøå, tekst", -2.5],
          ['a;"b"\nc', 0],
        ],
      ),
    ).toBe('\uFEFFTekst;Tal\r\næøå, tekst;-2,50\r\n"a;""b""\nc";0,00\r\n');
  });

  it("pins ordinary configurable output and delimiter-specific quoting", () => {
    const rows = [{ text: 'æøå, "tekst"\nslut', amount: -2.5 }];
    const columns = [
      { key: "text", header: "Tekst" },
      { key: "amount", header: "Tal", format: "number" as const },
    ];
    expect(convertToCSV(rows, columns)).toBe(
      'Tekst;Tal\n"æøå, ""tekst""\nslut";-2,50',
    );
    expect(
      convertToCSV([{ text: "a;b" }], [columns[0]], { delimiter: "," }),
    ).toBe("Tekst\na;b");
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell(-2.5)).toBe("-2,5");
  });

  it.each(["=1+1", "+SUM(A1)", "-2+3+cmd", "@SUM(A1)", "\t=1", "\r=1", "  =1"])(
    "guards text %j in every CSV style",
    (value) => {
      const expected = value.includes("\r") ? `"'${value}"` : `'${value}`;
      expect(csvEscape(value)).toBe(expected);
      expect(csvCell(value)).toBe(expected);
      expect(
        convertToCSV([{ text: value }], [{ key: "text", header: "Tekst" }]),
      ).toBe(`Tekst\n${expected}`);
    },
  );

  it("keeps phone numbers and amounts unprefixed in the client export", () => {
    const phone = CLIENT_COLUMNS.filter((c) => c.key === "phone");
    expect(convertToCSV([{ phone: "+45 12 34 56 78" }], phone)).toBe(
      "Telefon\n+45 12 34 56 78",
    );
    expect(convertToCSV([{ phone: "+SUM(A1)" }], phone)).toBe(
      "Telefon\n'+SUM(A1)",
    );
    expect(csvEscape("-1.250,00")).toBe("-1.250,00");
  });

  it("quotes embedded carriage returns", () => {
    expect(csvEscape("a\rb")).toBe('"a\rb"');
    expect(
      convertToCSV([{ text: "a\rb" }], [{ key: "text", header: "Tekst" }]),
    ).toBe('Tekst\n"a\rb"');
  });
});
