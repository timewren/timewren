import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";

// Indeks, der findes i databasen men ikke i schema.ts, foreslår
// `db:push`/`db:generate` at droppe. Hvert indeks fra migrationerne nedenfor
// skal derfor være deklareret i schema.ts med samme navn og kolonner (#1115).

function declaredIndexes(): Map<string, { table: string; columns: string[] }> {
  const out = new Map<string, { table: string; columns: string[] }>();
  for (const value of Object.values(schema)) {
    if (!(value instanceof PgTable)) continue;
    const config = getTableConfig(value);
    for (const idx of config.indexes) {
      const name = idx.config.name;
      if (!name) continue;
      out.set(name, {
        table: config.name,
        columns: idx.config.columns.map((c) =>
          "name" in c ? (c.name as string) : "",
        ),
      });
    }
  }
  return out;
}

function migrationIndexes(file: string) {
  const sqlText = readFileSync(join(process.cwd(), "drizzle", file), "utf8");
  const re =
    /CREATE INDEX (?:CONCURRENTLY )?IF NOT EXISTS "([^"]+)" ON "([^"]+)" \(([^)]+)\)/g;
  return [...sqlText.matchAll(re)].map((m) => ({
    name: m[1],
    table: m[2],
    columns: m[3].split(",").map((c) => c.trim().replace(/"/g, "")),
  }));
}

describe("indeks fra migrationer er deklareret i schema.ts", () => {
  const declared = declaredIndexes();

  for (const file of [
    "0033_perf_indexes.sql",
    "0158_members_user_notification_channels_idx.sql",
    "0159_hot_read_path_indexes.sql",
  ]) {
    it(file, () => {
      const expected = migrationIndexes(file);
      expect(expected.length).toBeGreaterThan(0);
      for (const idx of expected) {
        expect(declared.get(idx.name), idx.name).toEqual({
          table: idx.table,
          columns: idx.columns,
        });
      }
    });
  }
});

// scripts/migrate-safe.ts genskaber sine indeks ved hver deploy
// (applySchemaPatches), så de findes i prod og skal også stå i schema.ts.
// Udtryks- og DESC-kolonner kan ikke sammenlignes på navn, så her tjekkes
// navn og tabel, og kolonnerne kun når listen er rene kolonnenavne.
describe("indeks fra scripts/migrate-safe.ts er deklareret i schema.ts", () => {
  const declared = declaredIndexes();
  // Bevidst droppet af drizzle/0099 og 0106 (gammel nøgle på ferie-saldi);
  // migrate-safe genskaber den, men den skal ikke gøres permanent i schema.ts.
  const legacy = new Set(["vacation_balances_user_year_org_idx"]);

  const source = readFileSync(
    join(process.cwd(), "scripts", "migrate-safe.ts"),
    "utf8",
  );
  const re =
    /CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?IF NOT EXISTS "([^"]+)" ON "([^"]+)" \((.+?)\)(?: WHERE|`)/g;
  const expected = [...source.matchAll(re)]
    .map((m) => ({ name: m[1], table: m[2], columns: m[3] }))
    .filter((idx) => !legacy.has(idx.name));

  it("finder indeks i migrate-safe.ts", () => {
    expect(expected.length).toBeGreaterThan(50);
  });

  for (const idx of expected) {
    it(idx.name, () => {
      const found = declared.get(idx.name);
      expect(found?.table, idx.name).toBe(idx.table);
      if (/^"[a-z_]+"(, "[a-z_]+")*$/.test(idx.columns)) {
        expect(found?.columns).toEqual(
          idx.columns.split(",").map((c) => c.trim().replace(/"/g, "")),
        );
      }
    });
  }
});
