import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as dbSchema from "@/lib/db/schema";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { loadDayOffCalendar, loadDayOffLookupsForUsers } from "../load";

// Fridagskalenderens opløsning mod en rigtig Postgres (#526): afdeling > org
// > egen > standard, og den ældre helligdagsliste flettet ind. Uden
// TEST_DATABASE_URL skippes blokken (samme mønster som idle-claim-testen).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("loadDayOffCalendar (integration)", () => {
  const schema = `day_off_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  let pool: ReturnType<typeof postgres>;
  let db: Parameters<typeof loadDayOffCalendar>[0];

  beforeAll(async () => {
    await connectTestDb(admin);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    // Kun de kolonner loaderen læser; tabellen day_off_calendars som i 0127
    await admin.unsafe(`
        CREATE TABLE ${schema}.day_off_calendars (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text,
          department_id uuid,
          user_id text,
          preset varchar(20) DEFAULT 'private' NOT NULL,
          optional_days jsonb DEFAULT '{}'::jsonb NOT NULL,
          custom_days jsonb DEFAULT '[]'::jsonb NOT NULL,
          updated_by text,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.holidays (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text,
          date date NOT NULL,
          name varchar(255) NOT NULL,
          is_half_day boolean NOT NULL DEFAULT false,
          is_system boolean NOT NULL DEFAULT false,
          is_archived boolean NOT NULL DEFAULT false
        );
        CREATE TABLE ${schema}.employee_profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          department_id uuid,
          is_active boolean NOT NULL DEFAULT true
        );
      `);
    pool = testPostgres({
      max: 2,
      connection: { search_path: schema },
    });
    await connectTestDb(pool);
    db = drizzle(pool, { schema: dbSchema }) as unknown as typeof db;
  });

  afterAll(async () => {
    await pool?.end();
    await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  });

  const DEPT = "11111111-1111-4111-8111-111111111111";

  beforeEach(async () => {
    await admin.unsafe(`
        DELETE FROM ${schema}.day_off_calendars;
        DELETE FROM ${schema}.holidays;
        DELETE FROM ${schema}.employee_profiles;
        INSERT INTO ${schema}.employee_profiles (organization_id, user_id, department_id, is_active)
          VALUES ('o1', 'u-dept', '${DEPT}', true), ('o1', 'u-plain', NULL, true),
                 ('o1', 'u-former', NULL, false);
        -- Ældre liste: genereret juleaften + egen sommerfest + anden orgs dag
        INSERT INTO ${schema}.holidays (organization_id, date, name, is_system)
          VALUES ('o1', '2026-12-24', 'Juleaftensdag', true),
                 ('o1', '2026-08-14', 'Sommerfest', false),
                 ('o2', '2026-08-13', 'Anden org', false);
      `);
  });

  it("standard: officielle helligdage + hele den ældre liste for org'en", async () => {
    const cal = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-plain",
    });
    expect(cal.source).toBe("default");
    expect(cal.lookup("2026-12-25")?.isHalfDay).toBe(false);
    expect(cal.lookup("2026-12-24")?.name).toBe("Juleaftensdag");
    expect(cal.lookup("2026-08-14")?.name).toBe("Sommerfest");
    expect(cal.lookup("2026-08-13")).toBeNull(); // anden orgs række
  });

  it("org-kalender: genererede rækker droppes, egne beholdes", async () => {
    await admin.unsafe(`
        INSERT INTO ${schema}.day_off_calendars (organization_id, preset, custom_days)
          VALUES ('o1', 'private', '[{"date":"2026-05-15","name":"Brodag","isHalfDay":false}]');
      `);
    const cal = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-plain",
    });
    expect(cal.source).toBe("org");
    expect(cal.lookup("2026-12-24")).toBeNull();
    expect(cal.lookup("2026-08-14")?.name).toBe("Sommerfest");
    expect(cal.lookup("2026-05-15")?.name).toBe("Brodag");
  });

  it("afdeling vinder over org, egen bruges kun uden org-kalender", async () => {
    await admin.unsafe(`
        INSERT INTO ${schema}.day_off_calendars (organization_id, preset)
          VALUES ('o1', 'private');
        INSERT INTO ${schema}.day_off_calendars (organization_id, department_id, preset)
          VALUES ('o1', '${DEPT}', 'ok24');
        INSERT INTO ${schema}.day_off_calendars (user_id, preset)
          VALUES ('u-plain', 'ok24');
      `);
    const dept = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-dept",
    });
    expect(dept.source).toBe("department");
    expect(dept.lookup("2026-06-05")?.isHalfDay).toBe(true);

    const plain = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-plain",
    });
    expect(plain.source).toBe("org");
    expect(plain.lookup("2026-06-05")).toBeNull();

    const batch = await loadDayOffLookupsForUsers(db, "o1", [
      { userId: "u-dept", departmentId: DEPT },
      { userId: "u-plain", departmentId: null },
    ]);
    expect(batch.get("u-dept")?.("2026-12-31")?.isHalfDay).toBe(false);
    expect(batch.get("u-plain")?.("2026-12-31")).toBeNull();
  });

  it("uden org: brugerens egen kalender", async () => {
    await admin.unsafe(`
        INSERT INTO ${schema}.day_off_calendars (user_id, preset, optional_days)
          VALUES ('solo', 'private', '{"christmasEve":"half"}');
      `);
    const cal = await loadDayOffCalendar(db, { orgId: null, userId: "solo" });
    expect(cal.source).toBe("user");
    expect(cal.lookup("2026-12-24")?.isHalfDay).toBe(true);
    expect(cal.lookup("2026-08-14")).toBeNull(); // org'ens ældre liste
  });

  it("medarbejder (#742): egen kalender ignoreres, også uden org-kalender", async () => {
    await admin.unsafe(`
        INSERT INTO ${schema}.day_off_calendars (user_id, preset)
          VALUES ('u-plain', 'ok24'), ('u-member', 'ok24'), ('u-former', 'ok24');
      `);
    const employee = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-plain",
    });
    expect(employee.source).toBe("default");
    expect(employee.personalBlockedBy).toBe("employee");
    expect(employee.lookup("2026-12-31")).toBeNull();

    // Også når kalderen allerede kender afdelingen (flex, dækningsgrad)
    const known = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-plain",
      departmentId: null,
    });
    expect(known.source).toBe("default");

    // Medlem uden medarbejderprofil (selvstyret arbejdstid) og tidligere
    // medarbejder: egen kalender gælder, så længe org'en ikke har valgt
    for (const userId of ["u-member", "u-former"]) {
      const own = await loadDayOffCalendar(db, { orgId: "o1", userId });
      expect(own.source).toBe("user");
      expect(own.personalBlockedBy).toBeNull();
      expect(own.lookup("2026-12-31")?.isHalfDay).toBe(false);
    }

    const batch = await loadDayOffLookupsForUsers(db, "o1", [
      { userId: "u-plain", departmentId: null },
    ]);
    expect(batch.get("u-plain")?.("2026-12-31")).toBeNull();
  });

  it("org-kalender blokerer egen kalender for alle i org'en", async () => {
    await admin.unsafe(`
        INSERT INTO ${schema}.day_off_calendars (organization_id, preset)
          VALUES ('o1', 'private');
        INSERT INTO ${schema}.day_off_calendars (user_id, preset)
          VALUES ('u-member', 'ok24');
      `);
    const cal = await loadDayOffCalendar(db, {
      orgId: "o1",
      userId: "u-member",
    });
    expect(cal.source).toBe("org");
    expect(cal.personalBlockedBy).toBe("org");
    expect(cal.lookup("2026-12-31")).toBeNull();
  });
});
