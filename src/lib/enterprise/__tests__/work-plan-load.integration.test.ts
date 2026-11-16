import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as dbSchema from "@/lib/db/schema";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { loadPlanMembers, loadRegisteredDays } from "../work-plan-load";

// Den faste arbejdsplan mod en rigtig Postgres (#510): afdelingens plan,
// personlig tildeling, afvigelse med redaktør, fridag og godkendt fravær.
// Uden TEST_DATABASE_URL skippes blokken.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("loadRegisteredDays (integration)", () => {
  const schema = `work_plan_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  let pool: ReturnType<typeof postgres>;
  let db: Parameters<typeof loadRegisteredDays>[0];

  const DEPT = "11111111-1111-4111-8111-111111111111";
  const PLAN = "22222222-2222-4222-8222-222222222222";
  const OWN = "33333333-3333-4333-8333-333333333333";
  const OTHER = "44444444-4444-4444-8444-444444444444";

  beforeAll(async () => {
    await connectTestDb(admin);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.unsafe(`
        CREATE TABLE ${schema}."user" (
          id text PRIMARY KEY, name text, email text
        );
        CREATE TABLE ${schema}.employee_profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          department_id uuid
        );
        CREATE TABLE ${schema}.employment_periods (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          employee_profile_id uuid,
          user_id text NOT NULL,
          valid_from date,
          valid_to date,
          department_id uuid
        );
        CREATE TABLE ${schema}.work_plan_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          plan_id uuid NOT NULL,
          user_id text,
          department_id uuid,
          valid_from date NOT NULL,
          valid_to date,
          created_by text,
          created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.work_plan_versions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          plan_id uuid NOT NULL,
          valid_from date NOT NULL,
          rotation_weeks integer DEFAULT 1 NOT NULL,
          rotation_anchor date,
          weeks jsonb NOT NULL,
          created_by text,
          created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.work_day_deviations (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          date date NOT NULL,
          kind varchar(20) DEFAULT 'worked' NOT NULL,
          start_time varchar(5),
          end_time varchar(5),
          break_minutes integer,
          hours numeric(5,2) NOT NULL,
          note text,
          created_by text,
          updated_by text,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.absence_requests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          status varchar(20) NOT NULL,
          start_date date NOT NULL,
          end_date date,
          half_day_start boolean NOT NULL DEFAULT false,
          half_day_end boolean NOT NULL DEFAULT false,
          hours_per_day numeric(4,2)
        );
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
        INSERT INTO ${schema}."user" (id, name, email)
          VALUES ('u-dept', 'Dorte', 'd@x.dk'), ('u-own', 'Ole', 'o@x.dk'),
                 ('u-none', 'Nina', 'n@x.dk'), ('boss', 'Bo Leder', 'b@x.dk'),
                 ('u-moved', 'Mia', 'm@x.dk');
        INSERT INTO ${schema}.employee_profiles (organization_id, user_id, department_id)
          VALUES ('o1', 'u-dept', '${DEPT}'), ('o1', 'u-own', '${DEPT}'),
                 ('o1', 'u-none', NULL), ('o1', 'u-moved', '${OTHER}');
        -- Mia skiftede afdeling 23/12: før da gælder DEPT's plan stadig
        INSERT INTO ${schema}.employment_periods (organization_id, user_id, valid_from, valid_to, department_id)
          VALUES ('o1', 'u-moved', NULL, '2026-12-22', '${DEPT}'),
                 ('o1', 'u-moved', '2026-12-23', NULL, '${OTHER}');
        -- Afdelingens plan: man-fre 8-16 (30 min) fra 1/12-2026
        INSERT INTO ${schema}.work_plan_versions (organization_id, plan_id, valid_from, weeks)
          VALUES ('o1', '${PLAN}', '2026-12-01',
            '[[{"weekday":1,"start":"08:00","end":"16:00","breakMinutes":30},
               {"weekday":2,"start":"08:00","end":"16:00","breakMinutes":30},
               {"weekday":3,"start":"08:00","end":"16:00","breakMinutes":30},
               {"weekday":4,"start":"08:00","end":"16:00","breakMinutes":30},
               {"weekday":5,"start":"08:00","end":"16:00","breakMinutes":30}]]'::jsonb),
          -- Personlig plan: kun mandag 9-13
                 ('o1', '${OWN}', '2026-12-01',
            '[[{"weekday":1,"start":"09:00","end":"13:00","breakMinutes":0}]]'::jsonb);
        INSERT INTO ${schema}.work_plan_assignments (organization_id, plan_id, user_id, department_id, valid_from)
          VALUES ('o1', '${PLAN}', NULL, '${DEPT}', '2026-12-01'),
                 ('o1', '${OWN}', 'u-own', NULL, '2026-12-01'),
                 ('o2', '${OWN}', 'u-none', NULL, '2026-12-01');
        INSERT INTO ${schema}.work_day_deviations (organization_id, user_id, date, start_time, end_time, break_minutes, hours, updated_by)
          VALUES ('o1', 'u-dept', '2026-12-22', '08:00', '18:00', 30, 9.5, 'boss');
        INSERT INTO ${schema}.absence_requests (organization_id, user_id, status, start_date, end_date)
          VALUES ('o1', 'u-dept', 'approved', '2026-12-23', '2026-12-23'),
                 ('o1', 'u-dept', 'pending', '2026-12-21', '2026-12-21');
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

  it("beregner dagene efter plan, afvigelse, fravær og helligdag", async () => {
    const members = await loadPlanMembers(db, "o1", [
      "u-dept",
      "u-own",
      "u-none",
      "u-moved",
    ]);
    expect(members).toHaveLength(4);
    const days = await loadRegisteredDays(
      db,
      "o1",
      members,
      "2026-12-21",
      "2026-12-27",
    );
    // u-none har kun en plan i en anden org
    expect(days.has("u-none")).toBe(false);

    const dorte = Object.fromEntries(
      (days.get("u-dept") ?? []).map((d) => [d.date, d]),
    );
    expect(dorte["2026-12-21"]).toMatchObject({ status: "plan", hours: 7.5 });
    expect(dorte["2026-12-22"]).toMatchObject({
      status: "deviation",
      hours: 9.5,
      end: "18:00",
    });
    expect(dorte["2026-12-22"].deviation?.updatedByLabel).toBe(
      "Bo Leder (b@x.dk)",
    );
    expect(dorte["2026-12-23"]).toMatchObject({ status: "absence", hours: 0 });
    // Standardkalenderen: juleaften er ikke fri, juledag er
    expect(dorte["2026-12-24"]).toMatchObject({ status: "plan", hours: 7.5 });
    expect(dorte["2026-12-25"]).toMatchObject({ status: "day_off", hours: 0 });
    expect(dorte["2026-12-26"]).toMatchObject({ status: "free", hours: 0 });

    // Personlig tildeling vinder over afdelingens
    const ole = days.get("u-own") ?? [];
    expect(ole.find((d) => d.date === "2026-12-21")).toMatchObject({
      status: "plan",
      start: "09:00",
      hours: 4,
    });
    expect(ole.find((d) => d.date === "2026-12-22")?.status).toBe("free");

    // Afdelingsskift flytter ikke fortidige plandage
    const mia = days.get("u-moved") ?? [];
    expect(mia.find((d) => d.date === "2026-12-22")).toMatchObject({
      status: "plan",
      hours: 7.5,
    });
    expect(mia.find((d) => d.date === "2026-12-23")?.status).toBe("free");
  });
});
