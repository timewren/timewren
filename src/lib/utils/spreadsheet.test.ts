import { afterEach, describe, expect, it, vi } from "vitest";
import { exportClientBreakdownCSV } from "./csv";
import { escapeCsv, sanitizeForSpreadsheet } from "./spreadsheet";

afterEach(() => vi.unstubAllGlobals());

describe("spreadsheet helpers", () => {
  it("preserves ordinary text and numeric values", () => {
    expect(sanitizeForSpreadsheet("æøå, tekst")).toBe("æøå, tekst");
    expect(escapeCsv(null)).toBe("");
    expect(escapeCsv(undefined)).toBe("");
    expect(escapeCsv(-2.5)).toBe("-2.5");
    expect(escapeCsv("-2,50", { numeric: true })).toBe("-2,50");
    expect(escapeCsv('a;"b"', { delimiter: ",", alwaysQuote: true })).toBe(
      '"a;""b"""',
    );
  });

  it.each(["+45 12 34 56 78", "-1.250,00", "+1 (555) 123", "-1", " -2,5"])(
    "leaves number-like text %j unchanged",
    (text) => {
      expect(sanitizeForSpreadsheet(text)).toBe(text);
      expect(escapeCsv(text)).toBe(text);
    },
  );

  it("checks long digit runs in linear time", () => {
    const text = `${" ".repeat(500)}${"1".repeat(5_000)}x`;
    const start = performance.now();
    expect(sanitizeForSpreadsheet(text)).toBe(text);
    expect(sanitizeForSpreadsheet(`-${"1".repeat(5_000)}x`)).toBe(
      `'-${"1".repeat(5_000)}x`,
    );
    expect(performance.now() - start).toBeLessThan(250);
  });

  it.each([
    "=1",
    "=1+1",
    "+SUM(A1)",
    "@cmd",
    "@SUM(A1)",
    "-2+3+cmd|' /C calc'!A0",
    "+1+1",
    "\t=1",
    "\r=1",
    "  =1",
  ])("guards %j once", (text) => {
    expect(sanitizeForSpreadsheet(text)).toBe(`'${text}`);
    expect(sanitizeForSpreadsheet(sanitizeForSpreadsheet(text))).toBe(
      `'${text}`,
    );
    expect(escapeCsv(text, { alwaysQuote: true })).toBe(`"'${text}"`);
  });
});

describe("legacy browser CSV", () => {
  async function download(text: string, hours = "2", revenue = "10") {
    let output: Blob | undefined;
    vi.stubGlobal("URL", {
      createObjectURL: (blob: Blob) => {
        output = blob;
        return "blob:test";
      },
      revokeObjectURL: vi.fn(),
    });
    vi.stubGlobal("document", {
      createElement: () => ({ style: {}, click: vi.fn() }),
      body: { appendChild: vi.fn(), removeChild: vi.fn() },
    });
    exportClientBreakdownCSV(
      [{ clientId: "c1", clientName: text, hours, revenue }],
      "2026-01-01",
      "2026-01-31",
    );
    // Blob.text strips the BOM, so decode explicitly to pin its bytes too.
    return new TextDecoder("utf-8", { ignoreBOM: true }).decode(
      await output!.arrayBuffer(),
    );
  }

  it("pins ordinary browser download bytes", async () => {
    expect(await download('Testkunde, "æøå"')).toBe(
      '\uFEFFKlient,Total Timer,Total Omsætning (kr),Gennemsnit Timepris (kr)\n"Testkunde, ""æøå""",2,10,5.00\nTOTAL,2.00,10.00,5.00',
    );
  });

  it("preserves negative numeric strings in browser downloads", async () => {
    expect(await download("Testkunde", "-2.00", "-10.00")).toContain(
      "\nTestkunde,-2.00,-10.00,0.00\nTOTAL,-2.00,-10.00,0.00",
    );
  });

  it.each(["=1", "+SUM(A1)", "-2+3+cmd", "@SUM(A1)", "\r=1", "a\rb"])(
    "escapes %j in browser downloads",
    async (text) => {
      const guarded = text === "a\rb" ? text : `'${text}`;
      const escaped = text.includes("\r") ? `"${guarded}"` : guarded;
      expect(await download(text)).toContain(`\n${escaped},2,10,5.00\n`);
    },
  );
});
