import { getTableColumns } from "drizzle-orm";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vitest";
import * as schema from "@/lib/db/schema";
import { SAFE_LOOKALIKE_COLUMNS } from "../registry";
import { userExportableColumns } from "../user-collect";
import {
  USER_EXCLUSION_GROUPS,
  USER_EXPORT_EXCLUDED,
  USER_EXPORT_TABLES,
  USER_PROFILE_COLUMNS,
  USER_REFERENCE_TABLES,
} from "../user-registry";

const allTables = (Object.entries(schema) as [string, unknown][]).filter(
  (e): e is [string, PgTable] => e[1] instanceof PgTable,
);
const included = new Map(USER_EXPORT_TABLES.map((e) => [e.key, e]));

/**
 * orgAuditLogs.targetUserId er en ren tekstkolonne uden FK (loggen skal
 * overleve, at brugeren slettes). Alle andre bruger-kolonner skal have FK.
 */
const USER_COLUMNS_WITHOUT_FK = new Set(["orgAuditLogs.targetUserId"]);

function fkTargets(table: PgTable, jsKey: string): string[] {
  const col = (getTableColumns(table) as Record<string, unknown>)[jsKey];
  return getTableConfig(table)
    .foreignKeys.filter((f) => f.reference().columns[0] === col)
    .map((f) => getTableConfig(f.reference().foreignTable).name);
}

describe("bruger-eksport: alle tabeller er taget stilling til", () => {
  it("hver tabel i schema.ts er enten med eller udeladt med en begrundelse", () => {
    const missing = allTables
      .map(([key]) => key)
      .filter((key) => !included.has(key) && !(key in USER_EXPORT_EXCLUDED));
    expect(
      missing,
      `Nye tabeller skal tilføjes USER_EXPORT_TABLES eller USER_EXPORT_EXCLUDED i src/lib/export/org-export/user-registry.ts: ${missing.join(", ")}`,
    ).toEqual([]);
  });

  it("ingen tabel står begge steder, og ingen står der, som ikke findes", () => {
    const keys = new Set(allTables.map(([k]) => k));
    for (const key of included.keys()) {
      expect(key in USER_EXPORT_EXCLUDED, key).toBe(false);
      expect(keys.has(key), key).toBe(true);
    }
    for (const [key, ex] of Object.entries(USER_EXPORT_EXCLUDED)) {
      expect(keys.has(key), key).toBe(true);
      expect(ex.note.length, key).toBeGreaterThan(5);
      expect(ex.group in USER_EXCLUSION_GROUPS, key).toBe(true);
    }
  });

  it("registret peger på de rigtige tabeller og har unikke, pæne filnavne", () => {
    const files = new Set<string>();
    for (const e of [...USER_EXPORT_TABLES, ...USER_REFERENCE_TABLES]) {
      expect((schema as Record<string, unknown>)[e.key], e.key).toBe(e.table);
      expect(files.has(e.file), e.file).toBe(false);
      expect(e.file).toMatch(/^[a-z0-9-]+$/);
      expect(e.label.length, e.key).toBeGreaterThan(5);
      files.add(e.file);
    }
  });
});

describe("bruger-eksport: hver regel peger på en kolonne, der hører til brugeren", () => {
  it("kolonnerne i reglerne findes og er bruger- eller medlems-id'er", () => {
    for (const e of USER_EXPORT_TABLES) {
      const cols = getTableColumns(e.table) as Record<string, unknown>;
      const s = e.scope;
      if (s.kind === "own") {
        expect(
          cols.organizationId,
          `${e.key} mangler organizationId`,
        ).toBeDefined();
        for (const c of s.columns) {
          expect(cols[c], `${e.key}.${c}`).toBeDefined();
          if (!USER_COLUMNS_WITHOUT_FK.has(`${e.key}.${c}`)) {
            expect(fkTargets(e.table, c), `${e.key}.${c}`).toContain("user");
          }
        }
      }
      if (s.kind === "ownVia" || s.kind === "global") {
        expect(cols[s.column], `${e.key}.${s.column}`).toBeDefined();
        expect(fkTargets(e.table, s.column), `${e.key}.${s.column}`).toContain(
          "user",
        );
      }
      if (s.kind === "member") {
        expect(cols[s.column], `${e.key}.${s.column}`).toBeDefined();
        expect(fkTargets(e.table, s.column), `${e.key}.${s.column}`).toContain(
          "members",
        );
        expect(cols.organizationId, e.key).toBeDefined();
      }
    }
  });

  it("en bruger-kolonne på en fælles tabel er udeladt, ikke med: user_id betyder ofte 'oprettet af'", () => {
    // Tabeller, hvor user_id er oprettet-af på data organisationen deler.
    for (const key of [
      "clients",
      "projects",
      "invoices",
      "invoiceLines",
      "prepaidPackages",
      "prepaidUsage",
      "companyProfiles",
      "portalBranding",
      "emailTemplates",
      "outgoingWebhooks",
      "sentEmails",
      // user_id er afsenderen af fakturamails, `to` er kundens adresse
      "emailDeliveryLogs",
      "emailFilterRules",
      "tags",
      "taskStatuses",
    ]) {
      expect(included.has(key), key).toBe(false);
      expect(key in USER_EXPORT_EXCLUDED, key).toBe(true);
    }
  });

  it("børn af en udeladt forælder er også udeladt; børn i eksporten har en forælder, der er med", () => {
    const childTables = [...included.values()].filter(
      (e) => e.scope.kind === "child" || e.scope.kind === "ownVia",
    );
    expect(childTables.length).toBeGreaterThan(0);
    for (const e of childTables) {
      const s = e.scope;
      if (s.kind !== "child" && s.kind !== "ownVia") continue;
      const parent = included.get(s.parent);
      expect(parent, `${e.key} -> ${s.parent} er udeladt`).toBeDefined();
      const parentName = getTableConfig(parent!.table).name;
      // Kolonnen, børnene hentes via, har FK til forælderen.
      const viaColumn = s.kind === "child" ? s.column : s.parentColumn;
      const fk = getTableConfig(e.table).foreignKeys.find(
        (f) =>
          f.reference().columns[0] === viaColumn &&
          getTableConfig(f.reference().foreignTable).name === parentName,
      );
      expect(fk, `${e.key} mangler FK til ${parentName}`).toBeDefined();
    }
    // Og omvendt: børn af udeladte forældre (fx fakturalinjer) er udeladt.
    for (const key of Object.keys(USER_EXPORT_EXCLUDED)) {
      expect(included.has(key), key).toBe(false);
    }
  });

  it("opslagstabellerne er organisations-scopede og har id og navn", () => {
    for (const r of USER_REFERENCE_TABLES) {
      const cols = getTableColumns(r.table) as Record<string, unknown>;
      expect(cols.id, r.key).toBeDefined();
      expect(cols.organizationId, r.key).toBeDefined();
      for (const c of r.columns) expect(cols[c], `${r.key}.${c}`).toBeDefined();
      // Kun id og et navn (og højst et forældre-id): ingen stamdata.
      expect(r.columns.length, r.key).toBeLessThanOrEqual(3);
      expect(included.has(r.key) || r.key in USER_EXPORT_EXCLUDED, r.key).toBe(
        true,
      );
    }
  });
});

describe("bruger-eksport: hemmeligheder kommer aldrig med", () => {
  const SUSPICIOUS =
    /token|secret|password|passwd|hash|encrypt|credential|webhook_url|api_key|private|salt|otp|_key$|^key$/i;

  it("ingen eksporteret kolonne ligner en hemmelighed, medmindre den er godkendt", () => {
    const leaks: string[] = [];
    for (const e of USER_EXPORT_TABLES) {
      const all = getTableColumns(e.table) as Record<string, { name: string }>;
      for (const jsKey of userExportableColumns(e).columns) {
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

  it("profilen har kun de godkendte kolonner og ingen nøgler eller interne flag", () => {
    const users = included.get("users")!;
    const cols = userExportableColumns(users, { canSeeRates: true }).columns;
    expect([...cols].sort()).toEqual([...USER_PROFILE_COLUMNS].sort());
    for (const secret of [
      "billyApiKey",
      "dineroApiKey",
      "dineroRefreshToken",
      "economicAppSecretToken",
      "economicAgreementGrantToken",
      "timeopsApiKey",
      "aiApiKey",
      "inboundEmailId",
      "role",
      "banned",
      "banReason",
      "isFlagged",
      "flaggedReason",
      "attrGclid",
      "resendContactId",
    ]) {
      expect(cols, secret).not.toContain(secret);
    }
  });

  it("kendte hemmelige og interne kolonner er væk", () => {
    const cols = (key: string) =>
      userExportableColumns(included.get(key)!).columns;
    expect(cols("emailIntegrations")).not.toContain("imapPassword");
    expect(cols("calendarConnections")).not.toContain("accessToken");
    expect(cols("calendarConnections")).not.toContain("refreshToken");
    expect(cols("notificationChannels")).not.toContain("slackBotToken");
    expect(cols("desktopLicenses")).not.toContain("licenseKey");
    expect(cols("desktopLicenses")).not.toContain("note");
    expect(cols("desktopLicenses")).not.toContain("stripeCustomerId");
  });

  it("aktivitetsloggen har ikke før/efter-værdier: rettes en kunde, ville kundens oplysninger komme med", () => {
    const cols = userExportableColumns(included.get("activityLogs")!).columns;
    expect(cols).not.toContain("changes");
    expect(cols).not.toContain("metadata");
    // Hvad du gjorde, hvornår og på hvilken post er stadig med
    for (const k of ["entityType", "entityId", "action", "entityName"]) {
      expect(cols, k).toContain(k);
    }
  });

  it("intern omkostningssats (medlemsrækken og tidsregistreringerne) kommer ikke med", () => {
    for (const key of ["members", "timeEntries"]) {
      expect(
        userExportableColumns(included.get(key)!).columns,
        key,
      ).not.toContain("costRate");
    }
    // Ingen eksporteret kolonne i hele bruger-eksporten hedder cost_rate
    for (const e of USER_EXPORT_TABLES) {
      const all = getTableColumns(e.table) as Record<string, { name: string }>;
      for (const k of userExportableColumns(e).columns) {
        expect(all[k].name, `${e.key}.${k}`).not.toMatch(/cost/);
      }
    }
  });
});

describe("bruger-eksport: de data, en medarbejder har ret til at se, er med", () => {
  it("tid, fravær, timesedler, profil og indstillinger er med", () => {
    for (const key of [
      "users",
      "members",
      "employeeProfiles",
      "timeEntries",
      "timerEvents",
      "absenceRequests",
      "vacationBalances",
      "flexEntries",
      "overtimeLedger",
      "timesheetWeeks",
      "timesheetWeekEvents",
      "checkIns",
      "tasks",
      "taskComments",
      "emailPreferences",
      "notificationChannels",
      "orgAuditLogs",
    ]) {
      expect(included.has(key), key).toBe(true);
    }
  });
});

describe("bruger-eksport: timepriser, beløb og kostpriser kun for ejere og administratorer", () => {
  // Kolonnenavne (i databasen), der ligner penge. Alle skal være adminOnly.
  const MONEY =
    /(^|_)(rate|amount|price|cost|revenue|fee|budget|salary|wage|total_amount)(_|$)/i;

  it("en medarbejder får ingen kolonne, der ligner en pris eller et beløb", () => {
    for (const e of USER_EXPORT_TABLES) {
      if (e.adminOnly === "all") continue;
      const all = getTableColumns(e.table) as Record<string, { name: string }>;
      for (const k of userExportableColumns(e).columns) {
        expect(all[k].name, `${e.key}.${k}`).not.toMatch(MONEY);
      }
    }
  });

  it("tabellen med medarbejderens timepriser er helt skjult for medarbejdere", () => {
    expect(included.get("memberRates")?.adminOnly).toBe("all");
  });

  it("ejere og administratorer får priserne med", () => {
    const admin = { canSeeRates: true };
    expect(
      userExportableColumns(included.get("timeEntries")!, admin).columns,
    ).toEqual(expect.arrayContaining(["billableRate", "costRate"]));
    expect(
      userExportableColumns(included.get("users")!, admin).columns,
    ).toContain("defaultHourlyRate");
    expect(
      userExportableColumns(included.get("members")!, admin).columns,
    ).toContain("costRate");
    for (const key of ["timeEntries", "users", "members"]) {
      const cols = userExportableColumns(included.get(key)!).columns;
      expect(cols, key).not.toContain("billableRate");
      expect(cols, key).not.toContain("costRate");
      expect(cols, key).not.toContain("defaultHourlyRate");
    }
  });

  it("adminOnly peger kun på kolonner, der findes", () => {
    for (const e of USER_EXPORT_TABLES) {
      if (!Array.isArray(e.adminOnly)) continue;
      const cols = Object.keys(getTableColumns(e.table));
      for (const k of e.adminOnly) expect(cols, `${e.key}.${k}`).toContain(k);
    }
  });
});
