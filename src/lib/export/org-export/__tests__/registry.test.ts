import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { exportableColumns } from "../collect";
import {
  ORG_EXPORT_EXCLUDED,
  ORG_EXPORT_TABLES,
  SAFE_LOOKALIKE_COLUMNS,
} from "../registry";

const allTables = (Object.entries(schema) as [string, unknown][]).filter(
  (e): e is [string, PgTable] => e[1] instanceof PgTable,
);
const included = new Map(ORG_EXPORT_TABLES.map((e) => [e.key, e]));

describe("organisations-eksport: alle tabeller er taget stilling til", () => {
  it("hver tabel i schema.ts er enten med i eksporten eller udeladt med en begrundelse", () => {
    const missing = allTables
      .map(([key]) => key)
      .filter((key) => !included.has(key) && !(key in ORG_EXPORT_EXCLUDED));
    expect(
      missing,
      `Nye tabeller skal tilføjes ORG_EXPORT_TABLES eller ORG_EXPORT_EXCLUDED i src/lib/export/org-export/registry.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("ingen tabel står begge steder, og ingen står der, som ikke findes", () => {
    const keys = new Set(allTables.map(([k]) => k));
    for (const key of included.keys()) {
      expect(key in ORG_EXPORT_EXCLUDED, key).toBe(false);
      expect(keys.has(key), key).toBe(true);
    }
    for (const key of Object.keys(ORG_EXPORT_EXCLUDED)) {
      expect(keys.has(key), key).toBe(true);
      expect(ORG_EXPORT_EXCLUDED[key].length).toBeGreaterThan(5);
    }
  });

  it("hver tabel med organization_id er med (org-scopet) eller udeladt", () => {
    for (const [key, table] of allTables) {
      const hasOrg = getTableConfig(table).columns.some(
        (c) => c.name === "organization_id",
      );
      if (!hasOrg) continue;
      const entry = included.get(key);
      if (entry) {
        expect(entry.scope.kind, key).toBe("org");
      } else {
        expect(key in ORG_EXPORT_EXCLUDED, key).toBe(true);
      }
    }
  });

  it("registret peger på de rigtige tabeller og har unikke filnavne", () => {
    const files = new Set<string>();
    for (const e of ORG_EXPORT_TABLES) {
      expect((schema as Record<string, unknown>)[e.key], e.key).toBe(e.table);
      expect(files.has(e.file), e.file).toBe(false);
      expect(e.file).toMatch(/^[a-z0-9-]+$/);
      files.add(e.file);
    }
  });

  it("org-scopede tabeller har organizationId, og børn peger med FK på en org-scopet forælder", () => {
    for (const e of ORG_EXPORT_TABLES) {
      const cols = getTableColumns(e.table) as Record<string, unknown>;
      if (e.scope.kind === "org") {
        expect(cols.organizationId, e.key).toBeDefined();
      }
      if (e.scope.kind === "parent") {
        const scope = e.scope;
        const parent = included.get(scope.parent);
        expect(parent?.scope.kind, `${e.key} -> ${scope.parent}`).toBe("org");
        expect(Object.values(cols)).toContain(scope.column);
        const parentName = getTableConfig(parent!.table).name;
        const fk = getTableConfig(e.table).foreignKeys.find((f) => {
          const ref = f.reference();
          return (
            ref.columns[0] === scope.column &&
            getTableConfig(ref.foreignTable).name === parentName
          );
        });
        expect(fk, `${e.key} mangler FK til ${parentName}`).toBeDefined();
      }
    }
  });

  it("de data, kunderne spurgte efter, er med", () => {
    for (const key of [
      "timeEntries",
      "clients",
      "projects",
      "tasks",
      "prepaidPackages",
      "prepaidUsage",
      "invoices",
      "invoiceLines",
      "absenceRequests",
      "timesheetWeeks",
      "timesheetWeekEvents",
      "timeApprovalRequests",
      "orgAuditLogs",
      "taskAttachments",
      "organizations",
      "members",
    ]) {
      expect(included.has(key), key).toBe(true);
    }
  });
});

describe("organisations-eksport: hemmeligheder kommer aldrig med", () => {
  const SUSPICIOUS =
    /token|secret|password|passwd|hash|encrypt|credential|webhook_url|api_key|private|salt|otp|_key$|^key$/i;

  it("ingen eksporteret kolonne ligner en hemmelighed, medmindre den er godkendt", () => {
    const leaks: string[] = [];
    for (const e of ORG_EXPORT_TABLES) {
      const all = getTableColumns(e.table) as Record<string, { name: string }>;
      for (const jsKey of exportableColumns(e).columns) {
        const dbName = all[jsKey].name;
        if (SUSPICIOUS.test(dbName) && !SAFE_LOOKALIKE_COLUMNS.has(dbName)) {
          leaks.push(`${e.key}.${dbName}`);
        }
      }
    }
    expect(
      leaks,
      "Tilføj kolonnen til REDACTED_COLUMNS (eller SAFE_LOOKALIKE_COLUMNS, hvis den er ufarlig)",
    ).toEqual([]);
  });

  it("brugere eksporteres kun med id, navn, e-mail og oprettelsesdato", () => {
    const users = included.get("users")!;
    expect(exportableColumns(users).columns.sort()).toEqual(
      ["createdAt", "email", "id", "name"].sort(),
    );
  });

  it("kendte hemmelige kolonner er væk", () => {
    const cols = (key: string) => exportableColumns(included.get(key)!).columns;
    expect(cols("clientPortalAccess")).not.toContain("passwordHash");
    expect(cols("clientPortalAccess")).not.toContain("accessTokenEncrypted");
    expect(cols("outgoingWebhooks")).not.toContain("secret");
    expect(cols("emailIntegrations")).not.toContain("imapPassword");
    expect(cols("calendarConnections")).not.toContain("accessToken");
    expect(cols("calendarConnections")).not.toContain("refreshToken");
    expect(cols("notificationChannels")).not.toContain("slackBotToken");
    expect(cols("imports")).not.toContain("credentials");
  });
});
