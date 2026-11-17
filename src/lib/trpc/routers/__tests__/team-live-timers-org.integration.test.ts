/**
 * INTEGRATION: `team.liveTimers` må kun vise en kollegas timer i den
 * organisation, timeren kører i. Timeren er personlig (én række pr. bruger),
 * så et medlem af to organisationer ville ellers dukke op i begge orgs
 * live-overblik med den anden orgs projekt, kunde og beskrivelse.
 *
 * Rækker uden `organizationId` (fra før timer-sync satte den) tilskrives
 * orgen via timerens projekt eller kunde; har timeren ingen af delene, kun
 * når brugeren ikke er medlem af andre organisationer. Deres beskrivelse
 * vises aldrig, for den kan være skrevet i en anden org.
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
  timerStates,
  users,
} from "@/lib/db/schema";
import { teamRouter } from "../team";

const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

const ORG_A = "org-livetimers-a";
const ORG_B = "org-livetimers-b";
// Medlem af begge organisationer.
const SHARED = "user-livetimers-shared";
// Kun medlem af A.
const VIEWER = "user-livetimers-viewer";

const PROJECT_A = "00000000-0000-4000-8000-00000000a001";
const PROJECT_B = "00000000-0000-4000-8000-00000000b001";
const CLIENT_B = "00000000-0000-4000-8000-00000000b002";
const CLIENT_A = "00000000-0000-4000-8000-00000000a002";

const CLONED = [
  "user",
  "organizations",
  "members",
  "organization_modules",
  "clients",
  "projects",
  "timer_states",
];

describe.skipIf(!TEST_DATABASE_URL)(
  "team.liveTimers — timere fra andre organisationer (integration)",
  () => {
    const scratch = `team_livetimers_it_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    const client = testPostgres({
      max: 1,
      connection: { search_path: scratch },
    });
    const db = drizzle(client, { schema });

    function liveTimersIn(orgId: string, userId = VIEWER) {
      return teamRouter
        .createCaller({
          db,
          headers: new Headers(),
          session: { user: { id: userId } },
          orgOverride: orgId,
        } as never)
        .liveTimers();
    }

    async function sharedRowIn(orgId: string) {
      const rows = await liveTimersIn(orgId, SHARED);
      const row = rows.find((r) => r.userId === SHARED);
      if (!row) throw new Error("medlemmet mangler i overblikket");
      return row;
    }

    async function setSharedTimer(values: {
      organizationId: string | null;
      projectId: string | null;
      clientId: string | null;
    }) {
      await db.delete(timerStates);
      await db.insert(timerStates).values({
        userId: SHARED,
        isRunning: true,
        startTime: new Date(),
        description: "Hemmelig opgave",
        ...values,
      });
    }

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
        { id: VIEWER, email: "bo@example.com", name: "Bo Test" },
      ]);
      await db.insert(organizations).values([
        { id: ORG_A, name: "Testkunde A ApS", slug: "livetimers-a" },
        { id: ORG_B, name: "Testkunde B ApS", slug: "livetimers-b" },
      ]);
      await db.insert(members).values([
        { id: "m-lt-1", organizationId: ORG_A, userId: SHARED, role: "member" },
        { id: "m-lt-2", organizationId: ORG_B, userId: SHARED, role: "owner" },
        { id: "m-lt-3", organizationId: ORG_A, userId: VIEWER, role: "owner" },
      ]);
      await db.insert(clients).values([
        {
          id: CLIENT_B,
          name: "Kunde i B",
          userId: SHARED,
          organizationId: ORG_B,
        },
        {
          id: CLIENT_A,
          name: "Kunde i A",
          userId: SHARED,
          organizationId: ORG_A,
        },
      ]);
      await db.insert(projects).values([
        {
          id: PROJECT_A,
          name: "Projekt i A",
          userId: SHARED,
          organizationId: ORG_A,
        },
        {
          id: PROJECT_B,
          name: "Projekt i B",
          userId: SHARED,
          organizationId: ORG_B,
          clientId: CLIENT_B,
        },
      ]);
    });

    beforeEach(async () => {
      await db.delete(timerStates);
    });

    afterAll(async () => {
      await admin.unsafe(`DROP SCHEMA ${scratch} CASCADE`);
      await client.end();
      await admin.end();
    });

    it("viser ikke en timer, der kører i en anden organisation", async () => {
      await setSharedTimer({
        organizationId: ORG_B,
        projectId: PROJECT_B,
        clientId: CLIENT_B,
      });

      const row = await sharedRowIn(ORG_A);
      expect(row.isRunning).toBe(false);
      expect(row.description).toBe("");
      expect(row.projectName).toBeNull();
      expect(row.clientName).toBeNull();
    });

    it("viser timeren i den organisation, den kører i", async () => {
      await setSharedTimer({
        organizationId: ORG_B,
        projectId: PROJECT_B,
        clientId: CLIENT_B,
      });

      const row = await sharedRowIn(ORG_B);
      expect(row.isRunning).toBe(true);
      expect(row.description).toBe("Hemmelig opgave");
      expect(row.projectName).toBe("Projekt i B");
      expect(row.clientName).toBe("Kunde i B");
    });

    it("tilskriver en ældre række uden organisation via timerens projekt", async () => {
      await setSharedTimer({
        organizationId: null,
        projectId: PROJECT_B,
        clientId: CLIENT_B,
      });

      expect((await sharedRowIn(ORG_A)).isRunning).toBe(false);
      expect((await sharedRowIn(ORG_B)).isRunning).toBe(true);
    });

    it("viser hverken en anden orgs kunde eller beskrivelse på en række uden organisation", async () => {
      // En blandet tilstand: projekt fra B, kunde og beskrivelse fra A.
      await setSharedTimer({
        organizationId: null,
        projectId: PROJECT_B,
        clientId: CLIENT_A,
      });

      const inB = await sharedRowIn(ORG_B);
      expect(inB.isRunning).toBe(true);
      expect(inB.projectName).toBe("Projekt i B");
      expect(inB.clientName).toBeNull();
      expect(inB.description).toBe("");
      expect((await sharedRowIn(ORG_A)).isRunning).toBe(false);
    });

    it("tilskriver en ældre række uden projekt via timerens kunde", async () => {
      await setSharedTimer({
        organizationId: null,
        projectId: null,
        clientId: CLIENT_B,
      });

      expect((await sharedRowIn(ORG_A)).isRunning).toBe(false);
      expect((await sharedRowIn(ORG_B)).isRunning).toBe(true);
    });

    it("skjuler en ældre intern-tid-række for et medlem af flere organisationer", async () => {
      await setSharedTimer({
        organizationId: null,
        projectId: null,
        clientId: null,
      });

      expect((await sharedRowIn(ORG_A)).isRunning).toBe(false);
      expect((await sharedRowIn(ORG_B)).isRunning).toBe(false);
    });

    it("viser en ældre intern-tid-række for et medlem af én organisation, men ikke dens beskrivelse", async () => {
      await db.insert(timerStates).values({
        userId: VIEWER,
        isRunning: true,
        startTime: new Date(),
        description: "Intern tid",
      });

      const rows = await liveTimersIn(ORG_A);
      const row = rows.find((r) => r.userId === VIEWER);
      expect(row?.isRunning).toBe(true);
      expect(row?.description).toBe("");
    });

    it("viser ikke en blandet rækkes beskrivelse, efter at medlemmet har forladt den anden organisation", async () => {
      // Beskrivelsen er skrevet i A, projektet er B's; rækken hører til ingen
      // af dem. Når medlemmet fjernes fra A, rydder det ikke timeren.
      await setSharedTimer({
        organizationId: null,
        projectId: PROJECT_B,
        clientId: null,
      });
      await db.delete(members).where(eq(members.id, "m-lt-1"));
      try {
        const inB = await sharedRowIn(ORG_B);
        expect(inB.isRunning).toBe(true);
        expect(inB.projectName).toBe("Projekt i B");
        expect(inB.description).toBe("");
      } finally {
        await db.insert(members).values({
          id: "m-lt-1",
          organizationId: ORG_A,
          userId: SHARED,
          role: "member",
        });
      }
    });
  },
);
