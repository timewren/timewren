/**
 * globalSetup for integration-projektet: kloner TEST_DATABASE_URL's database
 * (med repoets schema fra `drizzle-kit push`) til en skabelon, som
 * `isolatedTestDatabase()` laver en database pr. fil ud fra. Klonen sker her,
 * før nogen worker er forbundet; mens testene kører, er de forbundet til
 * kildedatabasen, og så kan den ikke klones.
 *
 * Bagefter fejler kørslen, hvis en fil har skrevet i kildedatabasens
 * public-schema (skrivetællerne i pg_stat_user_tables er steget). Filerne
 * skriver i deres eget schema eller deres egen database (docs/ci.md).
 */
import { randomUUID } from "node:crypto";
import type postgres from "postgres";
import type { TestProject } from "vitest/node";
import { connectTestDb, testPostgres } from "./test-db";

/** Indsatte, opdaterede og slettede rækker pr. tabel i public-schemaet. */
async function publicWriteCounts(sql: postgres.Sql) {
  const rows = await sql<{ relname: string; n: string }[]>`
    SELECT relname, (n_tup_ins + n_tup_upd + n_tup_del)::text AS n
    FROM pg_stat_user_tables WHERE schemaname = 'public'`;
  return new Map(rows.map((row) => [row.relname, Number(row.n)]));
}

/** Tabeller, hvis skrivetællere er steget fra `before` til `after`. */
export function writtenTables(
  before: Map<string, number>,
  after: Map<string, number>,
) {
  return [...after]
    .filter(([table, n]) => n > (before.get(table) ?? 0))
    .map(([table]) => table)
    .sort();
}

export default async function setup(project: TestProject) {
  project.provide("testDbTemplate", null);
  project.provide("testDbTemplateError", "TEST_DATABASE_URL er ikke sat");
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return;

  // Forbindelsen til kilden lukkes igen før klonen
  const shared = testPostgres({ max: 1, onnotice: () => {} });
  await connectTestDb(shared);
  const writesBefore = await publicWriteCounts(shared);
  await shared.end();

  const source = decodeURIComponent(new URL(url).pathname.slice(1));
  const template = `tt_it_${randomUUID().slice(0, 8)}`;
  // Vedligeholdelses-databasen, så ingen er forbundet til kilden under klonen
  const sql = testPostgres({
    max: 1,
    database: "postgres",
    onnotice: () => {},
  });
  try {
    await connectTestDb(sql);
    await sql.unsafe(`CREATE DATABASE "${template}" TEMPLATE "${source}"`);
    project.provide("testDbTemplate", template);
  } catch (err) {
    // Fx en åben forbindelse til kilden (dev-server, Drizzle Studio). Kun de
    // filer, der bruger isolatedTestDatabase(), fejler, med denne besked.
    project.provide(
      "testDbTemplateError",
      `kunne ikke klone ${source}: ${(err as Error).message}`,
    );
  }

  return async () => {
    // Skabelonen og de filers databaser, hvis afterAll ikke nåede at rydde op
    const left = await sql<{ datname: string }[]>`
      SELECT datname FROM pg_database WHERE datname LIKE ${`${template}%`}
      ORDER BY datname = ${template}`;
    for (const { datname } of left) {
      await sql.unsafe(`DROP DATABASE IF EXISTS "${datname}" WITH (FORCE)`);
    }
    await sql.end();

    // Lukkede forbindelser har sendt deres tællere; en fil, der lader sin
    // forbindelse stå åben, kan nå at slippe forbi (op til 10 s forsinkelse).
    const after = testPostgres({ max: 1, onnotice: () => {} });
    const written = writtenTables(writesBefore, await publicWriteCounts(after));
    await after.end();
    if (written.length > 0) {
      throw new Error(
        `Integrationstestene skrev i den delte databases public-schema (${written.join(", ")}). Brug et eget schema eller isolatedTestDatabase() (docs/ci.md).`,
      );
    }
  };
}
