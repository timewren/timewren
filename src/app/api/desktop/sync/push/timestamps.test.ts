import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";
import { prepaidPackages, projects, timeEntries } from "@/lib/db/schema";
import { coerceTimestampFields } from "@/lib/desktop-sync";

// main's signatur er (data, table); testene er skrevet tabel-først.
const coerce = (
  table: Parameters<typeof coerceTimestampFields>[1],
  data: Record<string, unknown>,
) => coerceTimestampFields(data, table);

// Porten der manglede: alle de andre desktop-tester mocker `@/lib/db`, så de
// kan aldrig se at drizzle afviser en streng i en `timestamp`-kolonne. Her
// bygges den rigtige SQL af den payload `pull` leverer (hele rækker som JSON →
// ISO-strenge) — det var den vei, der kastede
// `TypeError: value.toISOString is not a function` og lod HVER desktop-post
// fejle, også `time_entries.date` der er NOT NULL.
//
// `.toSQL()` kører drizzle's `mapToDriverValue` uden at røre en database, så
// testen er hermetisk.

process.env.DATABASE_URL ||= "postgres://probe:probe@127.0.0.1:5432/probe";

let db: typeof import("@/lib/db").db;

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
});

const USER = "user-1";

/** Payload som appen sender tilbage efter et `pull` af den samme post. */
function pulledTimeEntry() {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    userId: USER,
    description: "Udvikling",
    hours: "2.50",
    date: "2026-09-30T00:00:00.000Z",
    startTime: "2026-09-30T08:00:00.000Z",
    endTime: "2026-09-30T10:30:00.000Z",
    createdAt: "2026-09-30T10:31:00.000Z",
    updatedAt: "2026-09-30T10:31:00.000Z",
  };
}

describe("desktop-payload mod rigtig drizzle-SQL", () => {
  it("drizzle afviser en streng i en timestamp-kolonne", () => {
    // Beviset på at konverteringen ikke er kosmetik: uden den kaster den
    // konkrete insert/update. Hvis en fremtidig drizzle-version en gang
    // accepterer strenge, fortæller denne tripwire at konverteringen er
    // overflødig — og at de andre tests så bør tjekkes igen.
    expect(() =>
      db
        .insert(timeEntries)
        // @ts-expect-error — streng i en Date-kolonne er præcis fejlen
        .values({ ...pulledTimeEntry(), hours: "2.50" })
        .toSQL(),
    ).toThrow(/toISOString/);
  });

  it("bygger INSERT for en pulled tidspost efter konvertering", () => {
    const { id: _id, ...insertable } = pulledTimeEntry();
    const query = db
      .insert(timeEntries)
      .values(coerce(timeEntries, insertable) as never)
      .toSQL();

    expect(query.sql).toContain('"date"');
    // Bindings er ISO-strenge, ikke `[object Object]`.
    for (const param of query.params) {
      expect(param).not.toMatch(/GMT|Invalid|\[object/);
    }
    expect(query.params).toContain("2026-09-30T08:00:00.000Z");
  });

  it("bygger UPDATE for en pulled tidspost efter konvertering", () => {
    const query = db
      .update(timeEntries)
      .set(coerce(timeEntries, pulledTimeEntry()) as Record<string, never>)
      .where(eq(timeEntries.id, "22222222-2222-4222-8222-222222222222"))
      .toSQL();

    expect(query.sql).toContain('"start_time"');
    expect(query.params).toContain("2026-09-30T10:30:00.000Z");
  });

  it("bygger INSERT for et pulled klippekort og et pulled projekt", () => {
    const pkg = db
      .insert(prepaidPackages)
      .values(
        coerce(prepaidPackages, {
          userId: USER,
          name: "10 timer",
          totalHours: "10",
          purchaseDate: "2026-09-01T00:00:00.000Z",
          expiryDate: "2026-12-31T00:00:00.000Z",
        }) as never,
      )
      .toSQL();
    expect(pkg.params).toContain("2026-09-01T00:00:00.000Z");

    const project = db
      .insert(projects)
      .values(
        coerce(projects, {
          userId: USER,
          name: "Projekt",
          startDate: "2026-09-01T00:00:00.000Z",
          endDate: "2026-10-01T00:00:00.000Z",
        }) as never,
      )
      .toSQL();
    expect(project.params).toContain("2026-10-01T00:00:00.000Z");
  });
});
