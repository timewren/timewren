/**
 * Forbindelser til test-databasen for `*.integration.test.ts`.
 *
 * CI-runnerne deles med Docker-builds og andre jobs, så Postgres kan være
 * længe om at starte en ny backend. Med postgres.js' standard på 30 s gav det
 * `CONNECT_TIMEOUT` i en tilfældig fils beforeAll (#1183). Forbindelserne får
 * derfor 60 s, og opsætningen prøver én gang til ved timeout.
 */
import postgres from "postgres";

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
