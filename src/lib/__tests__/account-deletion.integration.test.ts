import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  AUDIT_RETENTION_TABLES,
  buildDeletionSql,
} from "@/lib/account-deletion";
import { DELETED_USER_LABEL } from "@/lib/org-audit";
import { connectTestDb, testPostgres } from "@/test/test-db";

describe("buildDeletionSql (#479, #499)", () => {
  const sql = buildDeletionSql("user_1", ["org_1"]);

  it("undtager audit-/ledger-tabellerne fra den dynamiske FK-sletning mod user", () => {
    for (const table of AUDIT_RETENTION_TABLES) {
      expect(sql).toContain(`'${table}'::regclass`);
    }
    expect(sql).toMatch(
      /c\.confrelid = '"user"'::regclass[\s\S]*c\.conrelid NOT IN \('org_audit_logs'::regclass, 'timesheet_week_events'::regclass, 'vacation_ledger'::regclass, 'overtime_ledger'::regclass\)/,
    );
  });

  it("anonymiserer aktør/medarbejder i stedet for at slette rækkerne", () => {
    expect(sql).toContain(
      `SET actor_id = NULL, actor_label = '${DELETED_USER_LABEL}'`,
    );
    expect(sql).toContain(
      `SET user_id = NULL, user_label = '${DELETED_USER_LABEL}'`,
    );
    expect(sql).not.toMatch(/DELETE FROM org_audit_logs/);
    expect(sql).not.toMatch(/DELETE FROM timesheet_week_events/);
  });

  it("anonymiserer ledger-posteringer i stedet for at slette dem (#499)", () => {
    for (const table of ["vacation_ledger", "overtime_ledger"]) {
      expect(sql).toMatch(
        new RegExp(
          `UPDATE ${table}\\s+SET user_id = NULL, user_label = '${DELETED_USER_LABEL}'\\s+WHERE user_id = v_user`,
        ),
      );
      expect(sql).not.toMatch(new RegExp(`DELETE FROM ${table}`));
    }
  });

  it("afviser id'er der ikke er regex-sikre", () => {
    expect(() => buildDeletionSql("x'; DROP TABLE t; --", [])).toThrow();
    expect(() => buildDeletionSql("ok", ["bad id"])).toThrow();
  });
});

// Integration: kræver en Postgres (TEST_DATABASE_URL). Bygger et minimalt
// skema med samme FK-semantik som prod (drizzle/0104_audit_retention.sql)
// og kører den rigtige DO-blok mod det.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "deleteUserAccountCompletely — audit-retention (integration)",
  () => {
    const client = testPostgres({ max: 1 });
    const schema = `audit_del_${Date.now()}`;

    beforeAll(async () => {
      await connectTestDb(client);
      await client.unsafe(`CREATE SCHEMA ${schema}`);
      await client.unsafe(`SET search_path TO ${schema}`);
      await client.unsafe(`
        CREATE TABLE "user" (id text PRIMARY KEY, name text, email text);
        CREATE TABLE organizations (id text PRIMARY KEY);
        CREATE TABLE members (
          id serial PRIMARY KEY,
          organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
        );
        -- Almindelig brugerdata uden org-kolonne: skal fortsat slettes
        CREATE TABLE sessions (
          id serial PRIMARY KEY,
          user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE
        );
        CREATE TABLE org_audit_logs (
          id serial PRIMARY KEY,
          organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
          actor_label varchar(255),
          action varchar(50) NOT NULL,
          target_email varchar(255),
          target_user_id text,
          metadata jsonb
        );
        CREATE TABLE timesheet_week_events (
          id serial PRIMARY KEY,
          organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id text REFERENCES "user"(id) ON DELETE SET NULL,
          user_label varchar(255),
          actor_id text REFERENCES "user"(id) ON DELETE SET NULL,
          actor_label varchar(255),
          event varchar(20) NOT NULL
        );
        -- Ledger-tabeller (#499): samme retention som audit-rækkerne
        CREATE TABLE vacation_ledger (
          id serial PRIMARY KEY,
          organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id text REFERENCES "user"(id) ON DELETE SET NULL,
          user_label varchar(255),
          entry_type varchar(20) NOT NULL,
          days numeric(6,2) NOT NULL,
          created_by text REFERENCES "user"(id) ON DELETE SET NULL
        );
        CREATE TABLE overtime_ledger (
          id serial PRIMARY KEY,
          organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
          user_id text REFERENCES "user"(id) ON DELETE SET NULL,
          user_label varchar(255),
          type varchar(20) NOT NULL,
          hours numeric(6,2) NOT NULL,
          created_by text REFERENCES "user"(id) ON DELETE SET NULL
        );
        -- Nævnes eksplicit i DO-blokken; skal findes
        CREATE TABLE time_entries (id serial PRIMARY KEY, organization_id text, user_id text);
        CREATE TABLE recurring_time_templates (id serial PRIMARY KEY, organization_id text, user_id text, is_active boolean);
        CREATE TABLE generated_time_entries (id serial PRIMARY KEY, recurring_template_id int, time_entry_id int);

        INSERT INTO "user" VALUES ('victim', 'Vera Victim', 'vera@example.dk'),
                                  ('boss', 'Bo Boss', 'bo@example.dk');
        INSERT INTO organizations VALUES ('org-a'), ('solo');
        INSERT INTO members (organization_id, user_id) VALUES ('org-a', 'boss'), ('solo', 'victim');
        INSERT INTO sessions (user_id) VALUES ('victim'), ('boss');
        INSERT INTO org_audit_logs (organization_id, actor_id, actor_label, action, target_email, target_user_id)
          VALUES ('org-a', 'victim', 'Vera Victim (vera@example.dk)', 'time_entry_updated', NULL, NULL),
                 ('org-a', 'boss', 'Bo Boss (bo@example.dk)', 'member_removed', 'vera@example.dk', 'victim'),
                 ('solo', 'victim', 'Vera Victim (vera@example.dk)', 'org_updated', NULL, NULL);
        INSERT INTO timesheet_week_events (organization_id, user_id, user_label, actor_id, actor_label, event)
          VALUES ('org-a', 'victim', 'Vera Victim (vera@example.dk)', 'boss', 'Bo Boss (bo@example.dk)', 'approved'),
                 ('org-a', 'boss', 'Bo Boss (bo@example.dk)', 'victim', 'Vera Victim (vera@example.dk)', 'approved');
        INSERT INTO vacation_ledger (organization_id, user_id, user_label, entry_type, days, created_by)
          VALUES ('org-a', 'victim', 'Vera Victim (vera@example.dk)', 'earned', 2.08, NULL),
                 ('org-a', 'boss', 'Bo Boss (bo@example.dk)', 'adjustment', 1.00, 'victim'),
                 ('solo', 'victim', 'Vera Victim (vera@example.dk)', 'earned', 2.08, NULL);
        INSERT INTO overtime_ledger (organization_id, user_id, user_label, type, hours, created_by)
          VALUES ('org-a', 'victim', 'Vera Victim (vera@example.dk)', 'earned', 3.50, 'boss'),
                 ('org-a', 'boss', 'Bo Boss (bo@example.dk)', 'used', -7.40, 'victim');
      `);
    });

    afterAll(async () => {
      await client.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await client.end();
    });

    it("sletter brugeren men bevarer audit-rækkerne med anonym aktør", async () => {
      await client.unsafe(buildDeletionSql("victim", ["solo"]));

      expect(await client`SELECT id FROM "user"`).toEqual([{ id: "boss" }]);
      expect(await client`SELECT id FROM organizations`).toEqual([
        { id: "org-a" },
      ]);
      expect(await client`SELECT user_id FROM sessions`).toEqual([
        { user_id: "boss" },
      ]);

      // Solo-orgens log forsvandt med orgen; org-a's rækker består anonymiseret
      const logs =
        await client`SELECT organization_id, actor_id, actor_label, action, target_email FROM org_audit_logs ORDER BY id`;
      expect(logs).toEqual([
        {
          organization_id: "org-a",
          actor_id: null,
          actor_label: DELETED_USER_LABEL,
          action: "time_entry_updated",
          target_email: null,
        },
        {
          organization_id: "org-a",
          actor_id: "boss",
          actor_label: "Bo Boss (bo@example.dk)",
          action: "member_removed",
          target_email: DELETED_USER_LABEL,
        },
      ]);

      const events =
        await client`SELECT user_id, user_label, actor_id, actor_label FROM timesheet_week_events ORDER BY id`;
      expect(events).toEqual([
        {
          user_id: null,
          user_label: DELETED_USER_LABEL,
          actor_id: "boss",
          actor_label: "Bo Boss (bo@example.dk)",
        },
        {
          user_id: "boss",
          user_label: "Bo Boss (bo@example.dk)",
          actor_id: null,
          actor_label: DELETED_USER_LABEL,
        },
      ]);

      // Ledger (#499): solo-orgens postering forsvandt med orgen; org-a's
      // posteringer består anonymiseret, og created_by NULLes (SET NULL)
      const vacation =
        await client`SELECT organization_id, user_id, user_label, entry_type, created_by FROM vacation_ledger ORDER BY id`;
      expect(vacation).toEqual([
        {
          organization_id: "org-a",
          user_id: null,
          user_label: DELETED_USER_LABEL,
          entry_type: "earned",
          created_by: null,
        },
        {
          organization_id: "org-a",
          user_id: "boss",
          user_label: "Bo Boss (bo@example.dk)",
          entry_type: "adjustment",
          created_by: null,
        },
      ]);
      const overtime =
        await client`SELECT user_id, user_label, type, created_by FROM overtime_ledger ORDER BY id`;
      expect(overtime).toEqual([
        {
          user_id: null,
          user_label: DELETED_USER_LABEL,
          type: "earned",
          created_by: "boss",
        },
        {
          user_id: "boss",
          user_label: "Bo Boss (bo@example.dk)",
          type: "used",
          created_by: null,
        },
      ]);
    });
  },
);
