import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as dbSchema from "@/lib/db/schema";
import { connectTestDb, testPostgres } from "@/test/test-db";
import { loadFlexNormStatus, loadNormDays } from "../norm-period-load";
import {
  assertClosingUnlocked,
  isWeekClosingLocked,
} from "../period-closing-lock";

// Normperiode og flexsaldo mod en rigtig Postgres (#507): beskæftigelses-
// graden skifter midt i måneden, ferie og sygdom trækkes fra, en timer-post
// efter dansk midnat lander på den danske dato, og optjent overtid trækkes
// fra flex. Uden TEST_DATABASE_URL skippes blokken.
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("loadNormDays (integration)", () => {
  const schema = `norm_period_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  let pool: ReturnType<typeof postgres>;
  let db: Parameters<typeof loadNormDays>[0];

  const VACATION = "55555555-5555-4555-8555-555555555555";
  const SICK = "66666666-6666-4666-8666-666666666666";

  beforeAll(async () => {
    await connectTestDb(admin);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.unsafe(`
        CREATE TABLE ${schema}."user" (
          id text PRIMARY KEY, name text, email text
        );
        CREATE TABLE ${schema}.organizations (
          id text PRIMARY KEY,
          default_weekly_hours numeric(4,1) DEFAULT 37 NOT NULL,
          daily_norm_hours numeric(4,1),
          break_minutes_per_day integer DEFAULT 0 NOT NULL,
          break_policy varchar(30) DEFAULT 'none' NOT NULL,
          timesheet_max_hours_per_day numeric(4,1) DEFAULT 24 NOT NULL,
          timesheet_warn_over_norm boolean DEFAULT true NOT NULL,
          timesheet_block_empty_workdays boolean DEFAULT false NOT NULL,
          timesheet_lock_after_weeks integer,
          timesheet_auto_lock_weekday integer,
          flex_norm_period varchar(10) DEFAULT 'week' NOT NULL,
          flex_norm_year_start varchar(10) DEFAULT 'calendar' NOT NULL,
          flex_norm_annual_hours numeric(6,1),
          flex_carryover_max_hours numeric(6,1),
          flex_carryover_max_deficit_hours numeric(6,1),
          flex_norm_start_date date
        );
        CREATE TABLE ${schema}.employee_profiles (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          weekly_hours numeric(4,1),
          working_days jsonb,
          daily_norm_hours numeric(4,1),
          department_id uuid
        );
        CREATE TABLE ${schema}.employment_periods (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          employee_profile_id uuid,
          user_id text NOT NULL,
          valid_from date,
          valid_to date,
          weekly_hours numeric(4,1) NOT NULL,
          conversion_factor numeric(5,3),
          employment_type varchar(20),
          department_id uuid,
          position varchar(255),
          working_days jsonb,
          daily_norm_hours numeric(4,1),
          break_minutes integer,
          end_reason varchar(50),
          note text,
          created_by text,
          created_at timestamp DEFAULT now() NOT NULL,
          updated_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.work_plan_assignments (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          plan_id uuid NOT NULL,
          user_id text,
          department_id uuid,
          valid_from date NOT NULL,
          valid_to date
        );
        CREATE TABLE ${schema}.work_plan_versions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          plan_id uuid NOT NULL,
          valid_from date NOT NULL,
          rotation_weeks integer DEFAULT 1 NOT NULL,
          rotation_anchor date,
          weeks jsonb NOT NULL
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
          updated_by text,
          updated_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.absence_types (
          id uuid PRIMARY KEY,
          organization_id text NOT NULL,
          category varchar(20) DEFAULT 'other' NOT NULL,
          deducts_vacation boolean DEFAULT false NOT NULL
        );
        CREATE TABLE ${schema}.absence_requests (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          absence_type_id uuid NOT NULL,
          status varchar(20) NOT NULL,
          start_date date NOT NULL,
          end_date date
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
        CREATE TABLE ${schema}.time_entries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          organization_id text,
          hours numeric(5,2) NOT NULL,
          date timestamp NOT NULL
        );
        CREATE TABLE ${schema}.overtime_ledger (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text,
          type varchar(20) NOT NULL,
          hours numeric(6,2) NOT NULL,
          week_start date,
          created_at timestamp DEFAULT now() NOT NULL
        );
        CREATE TABLE ${schema}.period_closings (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id text NOT NULL,
          user_id text NOT NULL,
          period_type varchar(10) NOT NULL,
          period_start date NOT NULL,
          period_end date NOT NULL,
          status varchar(20) DEFAULT 'open' NOT NULL
        );
        INSERT INTO ${schema}.period_closings (organization_id, user_id, period_type, period_start, period_end, status)
          VALUES ('o1', 'u1', 'month', '2026-08-01', '2026-08-31', 'acknowledged'),
                 ('o1', 'u1', 'month', '2026-09-01', '2026-09-30', 'reopened');
        INSERT INTO ${schema}."user" (id, name, email)
          VALUES ('u1', 'Ulla', 'u@x.dk'), ('u-other', 'Otto', 'o@x.dk');
        INSERT INTO ${schema}.organizations (id, flex_norm_period, flex_norm_start_date, flex_carryover_max_hours)
          VALUES ('o1', 'month', '2026-09-01', 10);
        INSERT INTO ${schema}.employee_profiles (organization_id, user_id, weekly_hours, working_days)
          VALUES ('o1', 'u1', 30, '["1","2","3","4","5"]'::jsonb);
        -- Fuld tid t.o.m. 15/10, derefter 30 t/uge
        INSERT INTO ${schema}.employment_periods (organization_id, user_id, valid_from, valid_to, weekly_hours, working_days)
          VALUES ('o1', 'u1', '2026-01-01', '2026-10-15', 37, '["1","2","3","4","5"]'::jsonb),
                 ('o1', 'u1', '2026-10-16', NULL, 30, '["1","2","3","4","5"]'::jsonb);
        INSERT INTO ${schema}.absence_types (id, organization_id, category, deducts_vacation)
          VALUES ('${VACATION}', 'o1', 'vacation', true), ('${SICK}', 'o1', 'sickness', false);
        INSERT INTO ${schema}.absence_requests (organization_id, user_id, absence_type_id, status, start_date, end_date)
          VALUES ('o1', 'u1', '${VACATION}', 'approved', '2026-10-05', '2026-10-05'),
                 ('o1', 'u1', '${SICK}', 'approved', '2026-10-06', '2026-10-06'),
                 ('o1', 'u1', '${SICK}', 'pending', '2026-10-07', '2026-10-07');
        -- UTC-midnat-konventionen + en timer-post kl. 00:30 dansk tid
        INSERT INTO ${schema}.time_entries (user_id, organization_id, hours, date)
          VALUES ('u1', 'o1', 8, '2026-10-01 00:00:00'),
                 ('u1', 'o1', 7.4, '2026-10-01 22:30:00'),
                 ('u1', NULL, 1, '2026-10-08 00:00:00'),
                 ('u1', 'o2', 5, '2026-10-09 00:00:00'),
                 -- September: præcis norm undtagen +12 t (loft 10)
                 ('u1', 'o1', 12, '2026-09-05 00:00:00');
        INSERT INTO ${schema}.overtime_ledger (organization_id, user_id, type, hours, week_start)
          VALUES ('o1', 'u1', 'earned', 1, '2026-10-12');
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

  it("dagene følger ansættelseshistorik, fravær og dansk dato", async () => {
    const days = await loadNormDays(db, {
      orgId: "o1",
      userIds: ["u1", "u-other"],
      from: "2026-10-01",
      to: "2026-10-31",
      settings: {
        period: "month",
        yearStart: "calendar",
        annualHours: null,
        carryoverMaxHours: null,
        carryoverMaxDeficitHours: null,
        startDate: null,
      },
      today: "2026-10-31",
    });
    // u-other har ingen medarbejderprofil i o1
    expect(days.has("u-other")).toBe(false);
    const byDate = Object.fromEntries(
      (days.get("u1") ?? []).map((d) => [d.date, d]),
    );
    expect(byDate["2026-10-01"]).toMatchObject({ net: 7.4, registered: 8 });
    expect(byDate["2026-10-02"]).toMatchObject({ registered: 7.4 });
    expect(byDate["2026-10-05"]).toMatchObject({ vacation: 7.4, net: 0 });
    expect(byDate["2026-10-06"]).toMatchObject({ otherAbsence: 7.4, net: 0 });
    // Afventende fravær sænker ikke normen
    expect(byDate["2026-10-07"]).toMatchObject({ net: 7.4 });
    // Legacy-post uden org tæller; post i en anden org gør ikke
    expect(byDate["2026-10-08"].registered).toBe(1);
    expect(byDate["2026-10-09"].registered).toBe(0);
    expect(byDate["2026-10-16"]).toMatchObject({ net: 6 });
  });

  it("saldo pr. normperiode med overførsel og optjent overtid", async () => {
    const status = (
      await loadFlexNormStatus(db, {
        orgId: "o1",
        userIds: ["u1"],
        today: "2026-10-31",
      })
    ).get("u1");
    expect(status).toBeDefined();
    if (!status) return;
    // Oktober: 11 × 7,4 + 11 × 6,0 = 147,4 brutto; ferie og sygdom 14,8
    expect(status.current.totals).toMatchObject({
      gross: 147.4,
      vacation: 7.4,
      otherAbsence: 7.4,
      net: 132.6,
      registered: 16.4,
      earnedOvertime: 1,
    });
    expect(status.current.totals.flex).toBe(-117.2);
    // September: 22 hverdage à 7,4 = 162,8 norm, 12 t registreret → −150,8
    const sep = status.previous[0];
    expect(sep.label).toBe("september 2026");
    expect(sep.balance).toBe(-150.8);
    // Intet minus-loft: hele saldoen overføres
    expect(sep.carryOut).toBe(-150.8);
    expect(status.current.carryIn).toBe(-150.8);
    expect(status.current.balance).toBe(-268);
  });

  it("låste perioder afviser ændringer; oplåste gør ikke", async () => {
    await expect(
      assertClosingUnlocked(db, "o1", "u1", ["2026-08-31"]),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      assertClosingUnlocked(db, "o1", "u1", ["2026-09-01", "2026-10-01"]),
    ).resolves.toBeUndefined();
    // Andre brugere og orgs påvirkes ikke
    await expect(
      assertClosingUnlocked(db, "o2", "u1", ["2026-08-31"]),
    ).resolves.toBeUndefined();
    // Ugen 31/8–6/9 rører den låste august
    expect(await isWeekClosingLocked(db, "o1", "u1", "2026-08-31")).toBe(true);
    expect(await isWeekClosingLocked(db, "o1", "u1", "2026-09-07")).toBe(false);
  });
});
