import { PgDialect } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import { recordsFilter } from "./filter";
import { collectRecords, recordsCSV, recordsInput } from "./records";

describe("personal records", () => {
  it("accepts historical years and validates months", () => {
    expect(recordsInput.parse({ year: 2010 }).year).toBe(2010);
    expect(recordsInput.safeParse({ year: 2026, month: 13 }).success).toBe(
      false,
    );
  });
  it("scopes all roles to the caller and active organization with exclusive date bounds", () => {
    const query = new PgDialect().sqlToQuery(
      recordsFilter("self", "org", { year: 2024, month: 2 }) ??
        (() => {
          throw new Error("missing filter");
        })(),
    );
    expect(query.sql).toContain('"time_entries"."user_id" =');
    expect(query.sql).toContain('"time_entries"."organization_id" =');
    expect(query.params).toEqual([
      "self",
      "org",
      "2024-02-01T00:00:00.000Z",
      "2024-03-01T00:00:00.000Z",
    ]);
  });
  it("exports unrounded hours and neutralizes spreadsheet formulas", () => {
    const csv = recordsCSV([
      {
        id: "a",
        date: new Date("2024-02-29Z"),
        description: '=HYPERLINK("x")',
        hours: "1.25",
      },
    ]);
    expect(csv).toContain("1,25");
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).toContain("29.02.2024");
    expect(recordsCSV([])).toContain("Dato;Beskrivelse;Timer");
  });
});

it("collects every page for export, including more than 1000 entries", async () => {
  const offsets: number[] = [];
  const entries = await collectRecords(async (offset) => {
    offsets.push(offset);
    return {
      entries: Array.from(
        { length: offset === 1000 ? 1 : 250 },
        (_, index) => ({
          id: String(offset + index),
          date: new Date("2020-01-01Z"),
          description: "",
          hours: "1",
        }),
      ),
      nextOffset: offset === 1000 ? null : offset + 250,
    };
  });
  expect(offsets).toEqual([0, 250, 500, 750, 1000]);
  expect(entries).toHaveLength(1001);
  expect(new Set(entries.map((entry) => entry.id)).size).toBe(1001);
});
