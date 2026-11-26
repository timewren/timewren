/**
 * INTEGRATION (#startside): `user.updateProfile` skal gemme en gyldig,
 * tilgængelig startside og afvise en der ikke er — modul-/rolle-gating sker
 * via en rigtig `organizationModules`/`rolePermissions`-opslag, som en
 * håndlavet mock ikke kan se troværdigt. Kører mod en rigtig Postgres med et
 * klonet, minimalt schema i en scratch-schema (se clients-bulkdelete-
 * tombstones.integration.test.ts).
 *
 * Kører kun med TEST_DATABASE_URL sat.
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

import * as schema from "@/lib/db/schema";
import {
  members,
  organizationModules,
  organizations,
  users,
} from "@/lib/db/schema";
import { userRouter } from "../user";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG_ID = "org-startside-mutation-it";
const USER_ID = "user-startside-mutation-it";

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "role_permissions",
  "employee_profiles",
  "feature_flags",
  "rate_history",
  // getProfile læser virksomhedsindstillinger fra org'ens profil.
  "company_profiles",
];

describe.skipIf(!TEST_DATABASE_URL)(
  "user.updateProfile — startPage (integration, #startside)",
  () => {
    const scratch = `user_startpage_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function caller() {
      return userRouter.createCaller({
        db,
        headers: new Headers(),
        // Ingen sessions-tabel i scratch-schemaet: uden `session.session.id`
        // springer resolveActiveOrgId databaseopslaget over og falder
        // tilbage til members-opslaget (ældste owner-medlemskab).
        session: { user: { id: USER_ID } },
        orgOverride: null,
      } as never);
    }

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      await db.insert(users).values({
        id: USER_ID,
        email: "startside-mutation@test.dk",
        name: "Startside Test",
      });
      await db.insert(organizations).values({
        id: ORG_ID,
        name: "Startside Mutation Test",
        slug: "startside-mutation-test",
      });
      await db.insert(members).values({
        id: "m-startside-mutation",
        organizationId: ORG_ID,
        userId: USER_ID,
        role: "owner",
      });
      // Klippekort slået fra for orgen; tasks tændt.
      await db.insert(organizationModules).values([
        {
          organizationId: ORG_ID,
          moduleKey: "klippekort",
          isAvailable: true,
          isEnabled: false,
        },
        {
          organizationId: ORG_ID,
          moduleKey: "tasks",
          isAvailable: true,
          isEnabled: true,
        },
      ]);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("gemmer en gyldig, tilgængelig startside", async () => {
      await caller().updateProfile({
        name: "Startside Test",
        startPage: "/dashboard/tasks",
      });

      const profile = await caller().getProfile();
      expect(profile?.startPage).toBe("/dashboard/tasks");
    });

    it("afviser en hvidlistet men modul-deaktiveret startside", async () => {
      await caller().updateProfile({
        name: "Startside Test",
        startPage: "/dashboard/tasks",
      });

      await expect(
        caller().updateProfile({
          name: "Startside Test",
          startPage: "/dashboard/klippekort",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // Den tidligere gemte værdi står stadig — forsøget skrev ikke noget.
      const profile = await caller().getProfile();
      expect(profile?.startPage).toBe("/dashboard/tasks");
    });

    it("afviser en sti uden for hvidlisten på zod-niveau", async () => {
      await expect(
        caller().updateProfile({
          name: "Startside Test",
          // @ts-expect-error — bevidst ugyldig værdi for at teste zod-afvisningen
          startPage: "/dashboard/settings",
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });

    it("null nulstiller til ingen startside (falder tilbage til /dashboard ved login)", async () => {
      await caller().updateProfile({
        name: "Startside Test",
        startPage: null,
      });

      const profile = await caller().getProfile();
      expect(profile?.startPage).toBeNull();
    });

    it("bevarer timepris og ugemål når kaldet kun sender navn og startside", async () => {
      await caller().updateProfile({
        name: "Startside Test",
        defaultHourlyRate: "750",
        weeklyHourGoal: "30",
      });

      // Kommandopalettens "Gør til startside" sender kun navn + startside —
      // uden felterne skal de forblive uændrede, ikke blive nulstillet.
      await caller().updateProfile({
        name: "Startside Test",
        startPage: "/dashboard/tasks",
      });

      const profile = await caller().getProfile();
      expect(profile?.defaultHourlyRate).toBe("750.00");
      expect(profile?.weeklyHourGoal).toBe("30.0");
      expect(profile?.startPage).toBe("/dashboard/tasks");
    });

    it("setStartPage sætter kun startside og rører ikke andre felter", async () => {
      await caller().updateProfile({
        name: "Startside Test",
        defaultHourlyRate: "750",
        weeklyHourGoal: "30",
      });

      await caller().setStartPage({ startPage: "/dashboard/tasks" });

      const profile = await caller().getProfile();
      expect(profile?.startPage).toBe("/dashboard/tasks");
      expect(profile?.defaultHourlyRate).toBe("750.00");
      expect(profile?.weeklyHourGoal).toBe("30.0");
    });

    it("setStartPage afviser en hvidlistet men modul-deaktiveret startside", async () => {
      await caller().setStartPage({ startPage: "/dashboard/tasks" });

      await expect(
        caller().setStartPage({ startPage: "/dashboard/klippekort" }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      const profile = await caller().getProfile();
      expect(profile?.startPage).toBe("/dashboard/tasks");
    });
  },
);
