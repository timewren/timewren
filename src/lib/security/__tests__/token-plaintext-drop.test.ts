import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * #726 trin 4: de ni klartekst-kolonner droppes (efter at 0126 har nulstillet
 * dem). calendar_connections.access_token er en levende OAuth-kolonne og må
 * ikke røres.
 */
const COLUMNS = [
  ["extension_tokens", "token"],
  ["client_portal_access", "access_token"],
  ["client_portal_access", "email_verification_token"],
  ["client_portal_access", "password_reset_token"],
  ["client_portal_sessions", "session_token"],
  ["alunta_klippekort_tokens", "token"],
  ["report_shares", "token"],
  ["data_export_requests", "download_token"],
  ["calendar_connections", "webhook_token"],
] as const;

const migration = readFileSync(
  join(process.cwd(), "drizzle/0153_drop_plaintext_tokens.sql"),
  "utf8",
);

describe("migration 0153 (drop klartekst-tokens)", () => {
  const guardEnd = migration.indexOf("END $$;");
  const guard = migration.slice(0, guardEnd);
  const afterGuard = migration.slice(guardEnd);

  it("starter med en fejl-lukket guard før første ALTER", () => {
    expect(guardEnd).toBeGreaterThan(0);
    expect(guard).toContain("RAISE EXCEPTION");
    expect(guard).not.toContain("ALTER TABLE");
    expect(guard).not.toContain("DROP COLUMN");
  });

  it.each(COLUMNS)("guarden dækker %s.%s", (table, column) => {
    expect(guard).toContain(`'${table}'`);
    expect(guard).toContain(`'${column}'`);
  });

  it.each(COLUMNS)("dropper %s.%s", (table, column) => {
    expect(migration).toContain(
      `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "${column}"`,
    );
  });

  it("dropper præcis ni kolonner og rører ikke calendar_connections.access_token", () => {
    expect(afterGuard.match(/DROP COLUMN/g)).toHaveLength(9);
    expect(migration).not.toMatch(
      /"calendar_connections" DROP COLUMN IF EXISTS "access_token"/,
    );
    expect(guard).not.toMatch(/'calendar_connections',\s*'access_token'/);
  });
});
