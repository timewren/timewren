import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import type { CollectedTable } from "../collect";
import { exportableColumns } from "../collect";
import { type FileOwner, type ObjectReader, safeName } from "../files";
import { ORG_EXPORT_TABLES } from "../registry";
import { tableToCsv, writeExportZip } from "../zip";
import { collectZip } from "./collect-zip";

const entry = (key: string) => ORG_EXPORT_TABLES.find((e) => e.key === key)!;

describe("tableToCsv spreadsheet safety", () => {
  const csv = (text: string) =>
    tableToCsv({
      entry: entry("timeEntries"),
      columns: ["text", "decimal", "count"],
      numericColumns: new Set(["decimal"]),
      rows: [{ text, decimal: "-2.50", count: -3 }],
    });

  it("pins ordinary output including BOM, CRLF and negative numbers", () => {
    expect(csv('æøå; "tekst"\nslut')).toBe(
      '\uFEFFtext;decimal;count\r\n"æøå; ""tekst""\nslut";-2,50;-3',
    );
  });

  it.each(["+45 12 34 56 78", "-1.250,00", "+1 (555) 123"])(
    "leaves number-like text %j unchanged",
    (text) => {
      expect(csv(text)).toBe(`\uFEFFtext;decimal;count\r\n${text};-2,50;-3`);
    },
  );

  it.each(["=1", "+SUM(A1)", "-2+3+cmd", "@SUM(A1)", "\r=1", "a\rb"])(
    "escapes %j",
    (text) => {
      const guarded = text === "a\rb" ? text : `'${text}`;
      const escaped = text.includes("\r") ? `"${guarded}"` : guarded;
      expect(csv(text)).toBe(`\uFEFFtext;decimal;count\r\n${escaped};-2,50;-3`);
    },
  );
});

function table(key: string, rows: Record<string, unknown>[]): CollectedTable {
  const { columns, numericColumns } = exportableColumns(entry(key));
  return { entry: entry(key), columns, numericColumns, rows };
}

describe("safeName", () => {
  it("fjerner mapper, .. og mærkelige tegn", () => {
    expect(safeName("../../etc/passwd")).toBe("etc_passwd");
    expect(safeName("Faktura æøå 2026.pdf")).toBe("Faktura_aeoeaa_2026.pdf");
    expect(safeName("a/b:c")).toBe("a_b_c");
    expect(safeName("")).toBe("fil");
    expect(safeName(".hidden")).toBe("hidden");
    expect(safeName("café.png")).toBe("cafe.png");
  });
});

const owner: FileOwner = {
  orgId: "org-A",
  userId: "u1",
  mode: "org",
  uploaderIds: new Set(["u1"]),
};
const noObjects: ObjectReader = {
  head: async () => null,
  get: async () => {
    throw new Error("ingen objekter i denne test");
  },
};
const META = {
  organizationId: "org-A",
  organizationName: "Bageriet",
  requestedByUserId: "u1",
  exportedAt: new Date("2026-10-11T10:00:00Z"),
};

describe("writeExportZip", () => {
  it("har README, komplet JSON, CSV pr. tabel og filer", async () => {
    const entries = table("timeEntries", [
      {
        id: "te-1",
        hours: "1.50",
        description: 'Møde; "kunde"',
        isBillable: true,
        date: new Date("2026-10-11T08:00:00Z"),
        // Binært indhold i en række bliver til en fil i ZIP'en.
        filename: "a.txt",
        bilag: new Uint8Array([65]),
      },
    ]);
    const empty = table("orgAuditLogs", []);
    const { zip, result } = await collectZip((out) =>
      writeExportZip(out, [entries, empty], owner, noObjects, META),
    );
    expect(result.fileCount).toBe(1);
    expect(result.byteLength).toBe(zip.byteLength);
    const files = unzipSync(zip);
    expect(Object.keys(files).sort()).toEqual(
      [
        "README.txt",
        "data.json",
        "csv/tidsregistreringer.csv",
        "csv/haendelseslog.csv",
        "filer/tidsregistreringer/te-1-a.txt",
        "filer/oversigt.csv",
      ].sort(),
    );
    expect(strFromU8(files["filer/tidsregistreringer/te-1-a.txt"])).toBe("A");

    const json = JSON.parse(strFromU8(files["data.json"]));
    expect(json.metadata.organizationId).toBe("org-A");
    expect(json.metadata.fileCount).toBe(1);
    expect(json.tables.tidsregistreringer[0].bilag).toEqual({
      filIEksporten: "filer/tidsregistreringer/te-1-a.txt",
    });
    expect(json.metadata.rowCounts).toEqual({
      tidsregistreringer: 1,
      haendelseslog: 0,
    });
    expect(json.tables.tidsregistreringer[0].hours).toBe("1.50");

    const raw = files["csv/tidsregistreringer.csv"];
    // UTF-8-BOM, så Excel læser æøå rigtigt
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const csv = strFromU8(raw).replace(/^\uFEFF/, "");
    const [header, row] = csv.split("\r\n");
    expect(header.split(";")).toContain("hours");
    expect(row).toContain("1,50");
    expect(row).toContain('"Møde; ""kunde"""');
    expect(row).toContain("Ja");
    expect(row).toContain("2026-10-11 10:00:00"); // dansk tid

    // Tom tabel har stadig kolonneoverskrifter
    expect(strFromU8(files["csv/haendelseslog.csv"])).toContain("action");

    const readme = strFromU8(files["README.txt"]);
    expect(readme).toContain('organisationen "Bageriet"');
    expect(readme).toContain("haendelseslog");
    expect(readme).toContain("supportTickets");
    expect(readme).not.toContain("\u2014"); // ingen tankestreger
  });

  it("data.json er byte for byte det samme som JSON.stringify(…, null, 2) af det hele", async () => {
    const rows = Array.from({ length: 1200 }, (_, i) => ({
      id: `te-${i}`,
      hours: "0.25",
      note: i % 7 === 0 ? 'linje 1\nlinje "2"' : null,
      date: new Date(Date.UTC(2026, 9, 1 + (i % 28))),
      tags: i % 3 === 0 ? ["a", "b"] : [],
    }));
    const tables = [
      table("timeEntries", rows),
      table("orgAuditLogs", []),
      table("clients", [{ id: "c1", name: "Æblegård" }]),
    ];
    // Facit beregnes før skrivningen, som muterer rækkerne.
    const expected = JSON.stringify(
      {
        metadata: {
          exportedAt: META.exportedAt.toISOString(),
          organizationId: META.organizationId,
          organizationName: META.organizationName,
          requestedByUserId: META.requestedByUserId,
          format: "timetrack-org-export",
          version: 1,
          rowCounts: Object.fromEntries(
            tables.map((t) => [t.entry.file, t.rows.length]),
          ),
          fileCount: 0,
        },
        tables: Object.fromEntries(tables.map((t) => [t.entry.file, t.rows])),
      },
      null,
      2,
    );
    const { zip } = await collectZip((out) =>
      writeExportZip(out, tables, owner, noObjects, META),
    );
    expect(strFromU8(unzipSync(zip)["data.json"])).toBe(expected);
  });

  it("CSV i stumper er identisk med tableToCsv og har BOM og CRLF", async () => {
    const t = table(
      "timeEntries",
      Array.from({ length: 1100 }, (_, i) => ({ id: `te-${i}`, hours: "1.5" })),
    );
    const expected = tableToCsv(t);
    const { zip } = await collectZip((out) =>
      writeExportZip(out, [t], owner, noObjects, META),
    );
    const raw = unzipSync(zip)["csv/tidsregistreringer.csv"];
    expect([...raw.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    // strFromU8 fjerner BOM'en, så sammenlign uden den.
    expect(strFromU8(raw)).toBe(expected.replace(/^﻿/, ""));
    expect(expected.split("\r\n")).toHaveLength(1101);
  });

  it("CSV escaper linjeskift", () => {
    const t = table("clients", [{ id: "c1", notes: "linje 1\nlinje 2" }]);
    expect(tableToCsv(t)).toContain('"linje 1\nlinje 2"');
  });
});
