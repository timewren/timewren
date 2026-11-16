/**
 * INTEGRATION (#startside): isStartPageAccessible/resolveStartPage skal give
 * samme svar som den rigtige navigation (DashboardShell/ModuleGuard) — modul
 * slået fra, rolle uden adgang, freelancerOnly i en enterprise-org, og den
 * org-løse solo-fallback. Håndlavede mocks kan ikke se dette troværdigt (ingen
 * rigtig rolePermissions/organizationModules-opløsning), så testen kører mod
 * en rigtig Postgres med et klonet, minimalt schema i en scratch-schema.
 *
 * Kører kun med TEST_DATABASE_URL sat (se account-deletion.test.ts).
 */

import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { connectTestDb, testPostgres } from "@/test/test-db";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));

import * as schema from "@/lib/db/schema";
import {
  featureFlags,
  members,
  organizationModules,
  organizations,
  rolePermissions,
  users,
} from "@/lib/db/schema";
import { isStartPageAccessible, resolveStartPage } from "./start-page.server";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG_ID = "org-startside-it";
const OWNER_ID = "user-startside-ejer";
const MEMBER_ID = "user-startside-medlem";

describe.skipIf(!TEST_DATABASE_URL)(
  "isStartPageAccessible / resolveStartPage (integration, #startside)",
  () => {
    const scratch = `start_page_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "user",
        "organizations",
        "members",
        "organization_modules",
        "role_permissions",
        "employee_profiles",
        "feature_flags",
      ]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      await db.insert(users).values([
        { id: OWNER_ID, email: "ejer@startside.test", name: "Ejer" },
        { id: MEMBER_ID, email: "medlem@startside.test", name: "Medlem" },
      ]);
      await db.insert(organizations).values({
        id: ORG_ID,
        name: "Startside Test",
        slug: "startside-test",
      });
      await db.insert(members).values([
        {
          id: "m-owner",
          organizationId: ORG_ID,
          userId: OWNER_ID,
          role: "owner",
        },
        {
          id: "m-member",
          organizationId: ORG_ID,
          userId: MEMBER_ID,
          role: "member",
        },
      ]);
      // Klippekort slået fra for orgen; alt andet tændt.
      await db.insert(organizationModules).values([
        {
          organizationId: ORG_ID,
          moduleKey: "klippekort",
          isAvailable: true,
          isEnabled: false,
        },
        {
          organizationId: ORG_ID,
          moduleKey: "clients",
          isAvailable: true,
          isEnabled: true,
        },
      ]);
      // Member har "none"-adgang til tid; owner er uberørt (altid "write").
      await db.insert(rolePermissions).values({
        organizationId: ORG_ID,
        roleName: "member",
        moduleKey: "time",
        accessLevel: "none",
      });
      await db.insert(featureFlags).values({
        key: "prepaidPackages",
        enabled: true,
      });
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("/dashboard er altid tilgængelig, selv uden org", async () => {
      expect(
        await isStartPageAccessible(db, OWNER_ID, null, "/dashboard"),
      ).toBe(true);
      expect(
        await isStartPageAccessible(db, MEMBER_ID, ORG_ID, "/dashboard"),
      ).toBe(true);
    });

    it("afviser et modul organisationen har slået fra", async () => {
      expect(
        await isStartPageAccessible(
          db,
          OWNER_ID,
          ORG_ID,
          "/dashboard/klippekort",
        ),
      ).toBe(false);
    });

    it("tillader et tændt modul for ejeren", async () => {
      expect(
        await isStartPageAccessible(db, OWNER_ID, ORG_ID, "/dashboard/clients"),
      ).toBe(true);
    });

    it("afviser en side rollen kun har 'none'-adgang til, men tillader ejeren", async () => {
      expect(
        await isStartPageAccessible(db, MEMBER_ID, ORG_ID, "/dashboard/time"),
      ).toBe(false);
      expect(
        await isStartPageAccessible(db, OWNER_ID, ORG_ID, "/dashboard/time"),
      ).toBe(true);
    });

    it("afviser en ukendt sti", async () => {
      expect(
        await isStartPageAccessible(
          db,
          OWNER_ID,
          ORG_ID,
          "/dashboard/settings",
        ),
      ).toBe(false);
    });

    it("solo-bruger uden org falder tilbage til FREELANCE_BUNDLE + owner-rolle", async () => {
      expect(
        await isStartPageAccessible(db, OWNER_ID, null, "/dashboard/clients"),
      ).toBe(true);
      // "klippekort" er i FREELANCE_BUNDLE, men kræver stadig feature-flagget —
      // sat til true i beforeAll, så det er tilgængeligt for solo også.
      expect(
        await isStartPageAccessible(
          db,
          OWNER_ID,
          null,
          "/dashboard/klippekort",
        ),
      ).toBe(true);
    });

    it("resolveStartPage falder tilbage til /dashboard for null, ukendt og ikke-tilgængelig", async () => {
      expect(await resolveStartPage(db, OWNER_ID, ORG_ID, null)).toBe(
        "/dashboard",
      );
      expect(
        await resolveStartPage(db, OWNER_ID, ORG_ID, "/dashboard/ukendt"),
      ).toBe("/dashboard");
      expect(
        await resolveStartPage(db, MEMBER_ID, ORG_ID, "/dashboard/time"),
      ).toBe("/dashboard");
    });

    it("resolveStartPage bevarer en tilgængelig, kendt startside", async () => {
      expect(
        await resolveStartPage(db, OWNER_ID, ORG_ID, "/dashboard/clients"),
      ).toBe("/dashboard/clients");
    });
  },
);

describe.skipIf(!TEST_DATABASE_URL)(
  "isStartPageAccessible — platform-roller admin/supporter ser bag feature-flags (#startside)",
  () => {
    const scratch = `start_page_it_roles_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    const ORG = "org-startside-roles-it";
    const PLAIN_USER = "user-startside-roles-plain";
    const ADMIN_USER = "user-startside-roles-admin";
    const SUPPORTER_USER = "user-startside-roles-supporter";

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of [
        "user",
        "organizations",
        "members",
        "organization_modules",
        "role_permissions",
        "employee_profiles",
        "feature_flags",
      ]) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      await db.insert(users).values([
        {
          id: PLAIN_USER,
          email: "plain@startside-roller.test",
          name: "Bruger",
        },
        {
          id: ADMIN_USER,
          email: "admin@startside-roller.test",
          name: "Admin",
          role: "admin",
        },
        {
          id: SUPPORTER_USER,
          email: "supporter@startside-roller.test",
          name: "Supporter",
          role: "supporter",
        },
      ]);
      await db.insert(organizations).values({
        id: ORG,
        name: "Startside Roller Test",
        slug: "startside-roller-test",
      });
      await db.insert(members).values([
        {
          id: "m-plain",
          organizationId: ORG,
          userId: PLAIN_USER,
          role: "owner",
        },
        {
          id: "m-admin",
          organizationId: ORG,
          userId: ADMIN_USER,
          role: "owner",
        },
        {
          id: "m-supporter",
          organizationId: ORG,
          userId: SUPPORTER_USER,
          role: "owner",
        },
      ]);
      // Klippekort-modulet er tændt, men selve feature-flagget er slået fra —
      // kun admin/supporter bør alligevel kunne vælge /dashboard/klippekort.
      await db.insert(organizationModules).values({
        organizationId: ORG,
        moduleKey: "klippekort",
        isAvailable: true,
        isEnabled: true,
      });
      await db.insert(featureFlags).values({
        key: "prepaidPackages",
        enabled: false,
      });
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("afviser en almindelig bruger, når feature-flagget er slået fra", async () => {
      expect(
        await isStartPageAccessible(
          db,
          PLAIN_USER,
          ORG,
          "/dashboard/klippekort",
        ),
      ).toBe(false);
    });

    it("tillader admin, selv med feature-flagget slået fra", async () => {
      expect(
        await isStartPageAccessible(
          db,
          ADMIN_USER,
          ORG,
          "/dashboard/klippekort",
        ),
      ).toBe(true);
    });

    it("tillader supporter, selv med feature-flagget slået fra", async () => {
      expect(
        await isStartPageAccessible(
          db,
          SUPPORTER_USER,
          ORG,
          "/dashboard/klippekort",
        ),
      ).toBe(true);
    });
  },
);
