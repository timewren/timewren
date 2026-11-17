/**
 * INTEGRATION: timer- og tidsskabeloner er personlige, men hører til den
 * organisation, de er oprettet i. Et medlem af to organisationer må ikke
 * læse, ændre eller bruge org A's skabeloner (med A's projekt og kunde),
 * mens det arbejder i org B, og det samme gælder efter at have forladt A.
 * Ældre skabeloner uden organisation forbliver synlige for ejeren.
 *
 * Kører kun med TEST_DATABASE_URL sat.
 */

import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
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
  clients,
  members,
  organizations,
  projects,
  recurringTimeTemplates,
  timeEntries,
  timerTemplates,
  users,
} from "@/lib/db/schema";
import { recurringRouter } from "../recurring";
import { timerTemplatesRouter } from "../timerTemplates";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG_A = "org-templates-a";
const ORG_B = "org-templates-b";
// Medlem af begge organisationer.
const SHARED = "user-templates-shared";
// Kun medlem af B.
const OTHER = "user-templates-other";

const CLIENT_A = "00000000-0000-4000-8000-00000000a002";
const PROJECT_A = "00000000-0000-4000-8000-00000000a001";
const TIMER_A = "00000000-0000-4000-8000-00000000a101";
const TIMER_LEGACY = "00000000-0000-4000-8000-00000000c101";
const RECURRING_A = "00000000-0000-4000-8000-00000000a201";
const RECURRING_LEGACY = "00000000-0000-4000-8000-00000000c201";

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "role_permissions",
  "subscriptions",
  "feature_flags",
  "employee_profiles",
  "rate_history",
  "clients",
  "projects",
  "prepaid_packages",
  "timer_templates",
  "recurring_time_templates",
  "recurring_template_clients",
  "time_entries",
  "generated_time_entries",
];

describe.skipIf(!TEST_DATABASE_URL)(
  "skabeloner scopes til organisationen (integration)",
  () => {
    const scratch = `templates_org_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function ctx(orgId: string, userId = SHARED) {
      return {
        db,
        headers: new Headers(),
        session: { user: { id: userId } },
        orgOverride: orgId,
      } as never;
    }
    const timers = (orgId: string, userId?: string) =>
      timerTemplatesRouter.createCaller(ctx(orgId, userId));
    const recurring = (orgId: string, userId?: string) =>
      recurringRouter.createCaller(ctx(orgId, userId));

    beforeAll(async () => {
      await connectTestDb(admin, client);
      await admin.unsafe(`CREATE SCHEMA ${scratch}`);
      for (const table of CLONED) {
        await admin.unsafe(
          `CREATE TABLE ${scratch}."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      await db.insert(users).values([
        { id: SHARED, email: "anna@example.com", name: "Anna Test" },
        { id: OTHER, email: "bo@example.com", name: "Bo Test" },
      ]);
      await db.insert(organizations).values([
        { id: ORG_A, name: "Testkunde A ApS", slug: "templates-a" },
        { id: ORG_B, name: "Testkunde B ApS", slug: "templates-b" },
      ]);
      await db.insert(members).values([
        { id: "m-tpl-1", organizationId: ORG_A, userId: SHARED, role: "owner" },
        { id: "m-tpl-2", organizationId: ORG_B, userId: SHARED, role: "owner" },
        { id: "m-tpl-3", organizationId: ORG_B, userId: OTHER, role: "owner" },
      ]);
      await db.insert(clients).values({
        id: CLIENT_A,
        name: "Kunde i A",
        userId: SHARED,
        organizationId: ORG_A,
      });
      await db.insert(projects).values({
        id: PROJECT_A,
        name: "Projekt i A",
        userId: SHARED,
        organizationId: ORG_A,
        clientId: CLIENT_A,
      });
    });

    beforeEach(async () => {
      await db.delete(timeEntries);
      await db.delete(timerTemplates);
      await db.delete(recurringTimeTemplates);
      await db.insert(timerTemplates).values([
        {
          id: TIMER_A,
          userId: SHARED,
          organizationId: ORG_A,
          name: "Timer i A",
          projectId: PROJECT_A,
          clientId: CLIENT_A,
        },
        {
          id: TIMER_LEGACY,
          userId: SHARED,
          organizationId: null,
          name: "Gammel timer",
        },
      ]);
      await db.insert(recurringTimeTemplates).values([
        {
          id: RECURRING_A,
          userId: SHARED,
          organizationId: ORG_A,
          name: "Fast tid i A",
          projectId: PROJECT_A,
          clientId: CLIENT_A,
          description: "Support",
          hours: "1.00",
          frequency: "daily",
          nextDue: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: RECURRING_LEGACY,
          userId: SHARED,
          organizationId: null,
          name: "Gammel fast tid",
          description: "Admin",
          hours: "0.50",
        },
      ]);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    describe("timerTemplates", () => {
      it("viser org A's skabelon i A, men ikke i B", async () => {
        const inA = (await timers(ORG_A).list()).map((t) => t.id);
        const inB = (await timers(ORG_B).list()).map((t) => t.id);
        expect(inA).toContain(TIMER_A);
        expect(inB).not.toContain(TIMER_A);
      });

      it("bevarer ældre skabeloner uden organisation i begge orgs", async () => {
        expect((await timers(ORG_A).list()).map((t) => t.id)).toContain(
          TIMER_LEGACY,
        );
        expect((await timers(ORG_B).list()).map((t) => t.id)).toContain(
          TIMER_LEGACY,
        );
        await expect(
          timers(ORG_B).getById({ id: TIMER_LEGACY }),
        ).resolves.toMatchObject({ id: TIMER_LEGACY });
      });

      it("afviser læsning og ændring af org A's skabelon fra org B", async () => {
        const api = timers(ORG_B);
        await expect(api.getById({ id: TIMER_A })).rejects.toThrow();
        await expect(
          api.update({ id: TIMER_A, data: { name: "Ændret" } }),
        ).rejects.toThrow();
        await expect(api.toggleFavorite({ id: TIMER_A })).rejects.toThrow();
        await expect(api.recordUsage({ id: TIMER_A })).rejects.toThrow();
        await expect(api.delete({ id: TIMER_A })).rejects.toThrow();

        const row = await db.query.timerTemplates.findFirst({
          where: eq(timerTemplates.id, TIMER_A),
        });
        expect(row).toMatchObject({
          name: "Timer i A",
          isFavorite: false,
          usageCount: 0,
        });
      });

      it("afviser et andet medlem af org B", async () => {
        await expect(
          timers(ORG_B, OTHER).getById({ id: TIMER_A }),
        ).rejects.toThrow();
        expect(await timers(ORG_B, OTHER).list()).toEqual([]);
      });
    });

    describe("recurring (tidsskabeloner)", () => {
      it("viser org A's skabelon i A, men ikke i B", async () => {
        const ids = async (orgId: string) => ({
          list: (await recurring(orgId).list()).map((t) => t.id),
          active: (await recurring(orgId).listActive()).map((t) => t.id),
          pending: (await recurring(orgId).getPending()).map((t) => t.id),
          byProject: (
            await recurring(orgId).getByProject({ projectId: PROJECT_A })
          ).map((t) => t.id),
        });
        const inA = await ids(ORG_A);
        const inB = await ids(ORG_B);
        for (const found of Object.values(inA)) {
          expect(found).toContain(RECURRING_A);
        }
        for (const found of Object.values(inB)) {
          expect(found).not.toContain(RECURRING_A);
        }
      });

      it("bevarer ældre skabeloner uden organisation i begge orgs", async () => {
        expect((await recurring(ORG_A).list()).map((t) => t.id)).toContain(
          RECURRING_LEGACY,
        );
        expect((await recurring(ORG_B).list()).map((t) => t.id)).toContain(
          RECURRING_LEGACY,
        );
      });

      it("afviser læsning, ændring og brug af org A's skabelon fra org B", async () => {
        const api = recurring(ORG_B);
        await expect(api.getById({ id: RECURRING_A })).rejects.toThrow();
        await expect(
          api.update({ id: RECURRING_A, name: "Ændret" }),
        ).rejects.toThrow();
        await expect(api.toggleActive({ id: RECURRING_A })).rejects.toThrow();
        await expect(api.pause({ id: RECURRING_A })).rejects.toThrow();
        await expect(api.resume({ id: RECURRING_A })).rejects.toThrow();
        await expect(api.duplicate({ id: RECURRING_A })).rejects.toThrow();
        await expect(
          api.generate({ templateId: RECURRING_A }),
        ).rejects.toThrow();
        await expect(api.delete({ id: RECURRING_A })).rejects.toThrow();

        const row = await db.query.recurringTimeTemplates.findFirst({
          where: eq(recurringTimeTemplates.id, RECURRING_A),
        });
        expect(row).toMatchObject({ name: "Fast tid i A", isActive: true });
        expect(await db.select().from(timeEntries)).toEqual([]);
        expect(
          await db
            .select()
            .from(recurringTimeTemplates)
            .where(eq(recurringTimeTemplates.organizationId, ORG_B)),
        ).toEqual([]);
      });

      it("afviser et andet medlem af org B", async () => {
        await expect(
          recurring(ORG_B, OTHER).getById({ id: RECURRING_A }),
        ).rejects.toThrow();
        expect(await recurring(ORG_B, OTHER).list()).toEqual([]);
      });
    });
  },
);
