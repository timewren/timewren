import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aluntaKlippekortTokens,
  calendarConnections,
  clientPortalAccess,
  clientPortalSessions,
  dataExportRequests,
  extensionTokens,
  reportShares,
} from "@/lib/db/schema";

/**
 * #726: klartekst-kolonnerne for link-/adgangstokens må ikke længere kendes
 * af koden, og migration 0126 må kun nulstille dem bag en guard.
 */
const PLAINTEXT = [
  { table: extensionTokens, name: "extension_tokens", column: "token" },
  {
    table: clientPortalAccess,
    name: "client_portal_access",
    column: "access_token",
  },
  {
    table: clientPortalAccess,
    name: "client_portal_access",
    column: "email_verification_token",
  },
  {
    table: clientPortalAccess,
    name: "client_portal_access",
    column: "password_reset_token",
  },
  {
    table: clientPortalSessions,
    name: "client_portal_sessions",
    column: "session_token",
  },
  {
    table: aluntaKlippekortTokens,
    name: "alunta_klippekort_tokens",
    column: "token",
  },
  { table: reportShares, name: "report_shares", column: "token" },
  {
    table: dataExportRequests,
    name: "data_export_requests",
    column: "download_token",
  },
  {
    table: calendarConnections,
    name: "calendar_connections",
    column: "webhook_token",
  },
] as const;

const migration = readFileSync(
  join(process.cwd(), "drizzle/0126_clear_plaintext_tokens.sql"),
  "utf8",
);

describe("schema uden klartekst-tokens (#726)", () => {
  it.each(PLAINTEXT)(
    "$name.$column findes ikke i schema.ts",
    ({ table, column }) => {
      const dbNames = Object.values(getTableColumns(table)).map((c) => c.name);
      expect(dbNames).not.toContain(column);
    },
  );
});

describe("migration 0126", () => {
  const guardEnd = migration.indexOf("END $$;");
  const guard = migration.slice(0, guardEnd);

  it("kører guarden før den første UPDATE", () => {
    expect(guardEnd).toBeGreaterThan(0);
    expect(guard).toContain("RAISE EXCEPTION");
    expect(migration.indexOf("UPDATE ")).toBeGreaterThan(guardEnd);
  });

  it.each(PLAINTEXT.filter((p) => p.column !== "password_reset_token"))(
    "guarder $name.$column mod manglende/afvigende hash",
    ({ name, column }) => {
      expect(guard).toMatch(
        new RegExp(`\\('${name}',\\s*'${column}',\\s*'${column}_hash'`),
      );
    },
  );

  it("kræver krypteret kopi for tokens der skal kunne vises igen", () => {
    for (const [table, enc] of [
      ["client_portal_access", "access_token_encrypted"],
      ["alunta_klippekort_tokens", "token_encrypted"],
      ["report_shares", "token_encrypted"],
      ["data_export_requests", "download_token_encrypted"],
    ]) {
      expect(guard).toMatch(new RegExp(`'${table}',[^)]*'${enc}'\\)`));
    }
    expect(guard).toContain("OR %I IS NULL");
    expect(guard).toContain("encode(sha256(convert_to(");
  });

  it.each(PLAINTEXT)("nulstiller $name.$column", ({ name, column }) => {
    expect(migration).toMatch(
      new RegExp(`UPDATE "${name}" SET [^;]*"${column}" = NULL`),
    );
  });

  it("dropper ingen kolonner endnu (sker i et senere trin)", () => {
    const statements = migration.replace(/^\s*--(?! >).*$/gm, "");
    expect(statements).not.toMatch(/DROP COLUMN/i);
  });
});
