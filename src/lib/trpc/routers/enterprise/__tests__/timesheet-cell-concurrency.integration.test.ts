/**
 * INTEGRATION (#1112, fund 24): `setTimesheetCell` læste cellens poster,
 * slettede/opdaterede/indsatte og genberegnede flex i separate statements på
 * `ctx.db` uden transaktion. Der er ingen unik nøgle pr. grid-celle, så to
 * samtidige autosaves på en tom celle så begge "ingen poster" og indsatte
 * hver sin post — cellen viste dobbelt så mange timer.
 *
 * Kører mod en rigtig Postgres (to forbindelser, så kaldene faktisk
 * overlapper). Hele `public` klones til en scratch-schema.
 *
 *   TEST_DATABASE_URL=postgres://… npx vitest run <denne fil>
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/telemetry/track", () => ({ trackEvent: vi.fn() }));

import * as schema from "@/lib/db/schema";
import {
  clients,
  employeeProfiles,
  members,
  organizations,
  projects,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { enterpriseTimesheetRouter } from "../timesheet";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const USER = "timesheet-cell-user";
const ORG = "timesheet-cell-org";
const CLIENT = "aaaaaaa1-1111-4111-8111-111111111114";
const PROJECT = "ccccccc3-3333-4333-8333-333333333334";

describe.skipIf(!TEST_DATABASE_URL)(
  "setTimesheetCell er atomisk pr. celle (integration)",
  () => {
    const scratch = `timesheet_cell_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 4,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function setCell(hours: number) {
      return enterpriseTimesheetRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: USER }, activeOrganizationId: ORG },
        } as never)
        .setTimesheetCell({ projectId: PROJECT, date: "2026-11-02", hours });
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      const tables = await admin<{ table_name: string }[]>`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`;
      for (const { table_name } of tables) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table_name}" (LIKE public."${table_name}" INCLUDING ALL)`,
        );
      }
      await db.insert(users).values({
        id: USER,
        email: "anna@example.com",
        name: "Anna Test",
      } as never);
      await db.insert(organizations).values({
        id: ORG,
        name: "Test Org",
        slug: "test-org-timesheet-cell",
      } as never);
      await db.insert(members).values({
        id: "m-timesheet-cell",
        organizationId: ORG,
        userId: USER,
        role: "owner",
      } as never);
      await db.insert(employeeProfiles).values({
        userId: USER,
        organizationId: ORG,
        role: "admin",
        employmentType: "full_time",
        weeklyHours: "37.0",
        workingDays: ["1", "2", "3", "4", "5"],
      } as never);
      await db.insert(clients).values({
        id: CLIENT,
        userId: USER,
        organizationId: ORG,
        name: "Testkunde ApS",
      } as never);
      await db.insert(projects).values({
        id: PROJECT,
        userId: USER,
        organizationId: ORG,
        clientId: CLIENT,
        name: "Testprojekt",
      } as never);
      // Klonen af hele public tager over 30 s, når suiten kører parallelt
    }, 120_000);

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("to samtidige autosaves på en tom celle giver én post, ikke dobbelt", async () => {
      const results = await Promise.allSettled([setCell(3), setCell(3)]);
      expect(results.map((r) => r.status)).toEqual(["fulfilled", "fulfilled"]);

      const entries = await db.select().from(timeEntries);
      expect(entries).toHaveLength(1);
      expect(Number(entries[0].hours)).toBe(3);
    });
  },
);
