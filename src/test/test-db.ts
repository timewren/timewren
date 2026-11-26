/**
 * Forbindelser til test-databasen for `*.integration.test.ts`.
 *
 * CI-runnerne deles med Docker-builds og andre jobs, så Postgres kan være
 * længe om at starte en ny backend. Med postgres.js' standard på 30 s gav det
 * `CONNECT_TIMEOUT` i en tilfældig fils beforeAll (#1183). Forbindelserne får
 * derfor 60 s, og opsætningen prøver én gang til ved timeout.
 */
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { inject } from "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    /** Skabelon-databasen fra integration-db-setup.ts, null hvis den mangler. */
    testDbTemplate: string | null;
    testDbTemplateError: string | null;
  }
}

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const CONNECT_TIMEOUT_SECONDS = 60;

export function testPostgres(
  options: postgres.Options<Record<string, postgres.PostgresType>> = {},
) {
  return postgres(TEST_DATABASE_URL ?? "", {
    connect_timeout: CONNECT_TIMEOUT_SECONDS,
    ...options,
  });
}

function isConnectTimeout(err: unknown) {
  return (err as { code?: unknown } | null)?.code === "CONNECT_TIMEOUT";
}

/**
 * Åbner forbindelserne i beforeAll, så en timeout rammer opsætningen (med ét
 * forsøg til) og ikke en test. postgres.js lukker ikke inaktive forbindelser
 * (idle_timeout 0), så med `max: 1` genbruger testene den åbnede forbindelse.
 */
export async function connectTestDb(...clients: postgres.Sql[]) {
  for (const sql of clients) {
    try {
      await sql`select 1`;
    } catch (err) {
      if (!isConnectTimeout(err)) throw err;
      await sql`select 1`;
    }
  }
}

/**
 * Egen database for én testfil, klonet fra skabelonen, som
 * `integration-db-setup.ts` laver af TEST_DATABASE_URL før kørslen. Til filer,
 * der skal have hele schemaet med alle FK'er: afterAll sletter databasen i
 * stedet for at køre kontosletningen pr. testbruger i den delte database,
 * hvilket tog 15-30 s pr. fil og løb over hookTimeout på en presset runner.
 *
 *   const testDb = isolatedTestDatabase();
 *   const pg = testPostgres({ max: 2, database: testDb.name });
 *   beforeAll(async () => { await testDb.create(); await connectTestDb(pg); });
 *   afterAll(async () => { await pg.end(); await testDb.drop(); });
 */
export function isolatedTestDatabase({ empty = false } = {}) {
  const template = inject("testDbTemplate");
  const name = `${template}_${randomUUID().slice(0, 8)}`;
  // Forbundet til TEST_DATABASE_URL's database, aldrig til skabelonen: en
  // database kan kun klones, når ingen er forbundet til den.
  const admin = testPostgres({ max: 1, onnotice: () => {} });
  return {
    name,
    async create() {
      if (!template) {
        throw new Error(
          `Ingen skabelon-database: ${inject("testDbTemplateError") ?? "ukendt fejl"}`,
        );
      }
      await connectTestDb(admin);
      await admin`CREATE DATABASE ${admin(name)} TEMPLATE ${admin(empty ? "template0" : template)}`;
    },
    async drop() {
      await admin.unsafe(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    },
  };
}
