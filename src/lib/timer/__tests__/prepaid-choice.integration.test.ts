import { drizzle } from "drizzle-orm/postgres-js";
import type postgres from "postgres";
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

// clientAccess trækker tRPC-opsætningen ind; storeTimerPrepaidChoice bruger
// den ikke, så forbindelsen mockes væk.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  readReturnedPrepaidChoice,
  readTimerPrepaidChoice,
  storeTimerPrepaidChoice,
  writeResetsPrepaidChoice,
} from "../prepaid-choice";

const CLIENT_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const CLIENT_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PACKAGE_1 = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

describe("readTimerPrepaidChoice (#422)", () => {
  it("returnerer valget for timerens kunde", () => {
    expect(
      readTimerPrepaidChoice({
        clientId: CLIENT_A,
        prepaidChoice: "package",
        prepaidPackageId: PACKAGE_1,
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toEqual({ mode: "package", packageId: PACKAGE_1, clientId: CLIENT_A });
    expect(
      readTimerPrepaidChoice({
        clientId: CLIENT_A,
        prepaidChoice: "none",
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toEqual({ mode: "none", clientId: CLIENT_A });
  });

  it("bruger projektets kunde når timeren ingen direkte kunde har", () => {
    expect(
      readTimerPrepaidChoice({
        clientId: null,
        project: { clientId: CLIENT_A },
        prepaidChoice: "none",
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toEqual({ mode: "none", clientId: CLIENT_A });
  });

  it("ignorerer et valg truffet for en anden kunde (kundeskift = automatisk)", () => {
    expect(
      readTimerPrepaidChoice({
        clientId: CLIENT_B,
        prepaidChoice: "none",
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toBeNull();
  });

  it("er automatisk uden valg, uden kunde eller med et forsvundet kort", () => {
    expect(readTimerPrepaidChoice(null)).toBeNull();
    expect(readTimerPrepaidChoice({ clientId: CLIENT_A })).toBeNull();
    expect(
      readTimerPrepaidChoice({
        clientId: null,
        prepaidChoice: "none",
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toBeNull();
    // ON DELETE SET NULL på kortet
    expect(
      readTimerPrepaidChoice({
        clientId: CLIENT_A,
        prepaidChoice: "package",
        prepaidPackageId: null,
        prepaidChoiceClientId: CLIENT_A,
      }),
    ).toBeNull();
  });

  it("læser RETURNING-rækken fra et stop med den effektive kunde", () => {
    expect(
      readReturnedPrepaidChoice({
        prepaidChoice: "package",
        prepaidPackageId: PACKAGE_1,
        prepaidChoiceClientId: CLIENT_A,
        effectiveClientId: CLIENT_A,
      }),
    ).toEqual({ mode: "package", packageId: PACKAGE_1, clientId: CLIENT_A });
    expect(
      readReturnedPrepaidChoice({
        prepaidChoice: "package",
        prepaidPackageId: PACKAGE_1,
        prepaidChoiceClientId: CLIENT_A,
        effectiveClientId: CLIENT_B,
      }),
    ).toBeNull();
  });
});

describe("writeResetsPrepaidChoice (#422)", () => {
  it("nulstiller ved frisk eller køet start", () => {
    expect(
      writeResetsPrepaidChoice({ isRunning: true, isFreshStart: true }),
    ).toBe(true);
    expect(
      writeResetsPrepaidChoice({ isRunning: true, isQueuedStart: true }),
    ).toBe(true);
  });

  it("nulstiller når timeren ryddes helt", () => {
    expect(
      writeResetsPrepaidChoice({
        isRunning: false,
        elapsedSeconds: 0,
        baseSeconds: 0,
      }),
    ).toBe(true);
  });

  it("bevarer valget når web genoptager en pauset timer (isFreshStart med opsparet tid)", () => {
    expect(
      writeResetsPrepaidChoice({
        isRunning: true,
        isFreshStart: true,
        elapsedSeconds: 900,
        baseSeconds: 900,
      }),
    ).toBe(false);
  });

  it("bevarer valget ved heartbeat, pause, genoptag og adoption", () => {
    expect(writeResetsPrepaidChoice({ isRunning: true })).toBe(false);
    expect(
      writeResetsPrepaidChoice({
        isRunning: true,
        isFreshStart: true,
        isAdoption: true,
      }),
    ).toBe(false);
    expect(
      writeResetsPrepaidChoice({
        isRunning: false,
        elapsedSeconds: 600,
        baseSeconds: 600,
      }),
    ).toBe(false);
  });

  it("tæller ikke udeladte felter som 0 (extensionens partielle skrivninger)", () => {
    expect(writeResetsPrepaidChoice({ isRunning: false })).toBe(false);
    expect(writeResetsPrepaidChoice({})).toBe(false);
  });
});

// Skrivningen SKAL være atomisk (ingen read-then-write på timer_states):
// guardsene på aktiv session, igangværende stop og kunde ligger i UPDATE'ens
// WHERE. Det kan kun verificeres mod en rigtig Postgres; uden
// TEST_DATABASE_URL skippes blokken (CI sætter variablen).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)(
  "storeTimerPrepaidChoice — atomisk skrivning (integration)",
  () => {
    const schema = `prepaid_choice_${Date.now()}`;
    const admin = testPostgres({ max: 1 });
    let pool: ReturnType<typeof postgres>;
    let db: ReturnType<typeof drizzle>;

    beforeAll(async () => {
      await connectTestDb(admin);
      await admin.unsafe(`CREATE SCHEMA ${schema}`);
      await admin.unsafe(`
        CREATE TABLE ${schema}.projects (
          id uuid PRIMARY KEY,
          client_id uuid
        );
        CREATE TABLE ${schema}.timer_states (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL UNIQUE,
          is_running boolean DEFAULT false,
          elapsed_seconds integer DEFAULT 0,
          base_seconds integer DEFAULT 0,
          project_id uuid,
          client_id uuid,
          intent varchar(20),
          prepaid_choice varchar(10),
          prepaid_package_id uuid,
          prepaid_choice_client_id uuid,
          updated_at timestamp NOT NULL DEFAULT now()
        );
      `);
      await admin.unsafe(
        `INSERT INTO ${schema}.projects (id, client_id) VALUES ($1, $2)`,
        [PROJECT_A, CLIENT_A],
      );
      pool = testPostgres({
        max: 2,
        connection: { search_path: schema },
      });
      await connectTestDb(pool);
      db = drizzle(pool);
    });

    afterAll(async () => {
      await pool?.end();
      await admin.unsafe(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    });

    beforeEach(async () => {
      await admin.unsafe(`DELETE FROM ${schema}.timer_states`);
    });

    async function seed(row: {
      isRunning?: boolean;
      elapsed?: number;
      clientId?: string | null;
      projectId?: string | null;
      intent?: string | null;
    }) {
      await admin.unsafe(
        `INSERT INTO ${schema}.timer_states
           (user_id, is_running, elapsed_seconds, base_seconds, client_id, project_id, intent)
         VALUES ('u1', $1, $2, $2, $3, $4, $5)`,
        [
          row.isRunning ?? true,
          row.elapsed ?? 0,
          row.clientId === undefined ? CLIENT_A : row.clientId,
          row.projectId ?? null,
          row.intent ?? null,
        ],
      );
    }

    async function readChoice() {
      const [row] = await admin.unsafe(
        `SELECT prepaid_choice, prepaid_package_id, prepaid_choice_client_id
         FROM ${schema}.timer_states WHERE user_id = 'u1'`,
      );
      return row as unknown as {
        prepaid_choice: string | null;
        prepaid_package_id: string | null;
        prepaid_choice_client_id: string | null;
      };
    }

    // biome-ignore lint/suspicious/noExplicitAny: testskemaet har kun en delmængde af tabellerne
    const store = (...args: any[]) =>
      // biome-ignore lint/suspicious/noExplicitAny: se ovenfor
      (storeTimerPrepaidChoice as any)(db, ...args) as Promise<boolean>;

    it("gemmer et kort på en kørende timer for kunden", async () => {
      await seed({});
      expect(
        await store("u1", CLIENT_A, { mode: "package", packageId: PACKAGE_1 }),
      ).toBe(true);
      expect(await readChoice()).toEqual({
        prepaid_choice: "package",
        prepaid_package_id: PACKAGE_1,
        prepaid_choice_client_id: CLIENT_A,
      });
    });

    it("matcher kunden via projektet", async () => {
      await seed({ clientId: null, projectId: PROJECT_A });
      expect(await store("u1", CLIENT_A, { mode: "none" })).toBe(true);
      expect((await readChoice()).prepaid_choice).toBe("none");
    });

    it("gemmer også på en pauset timer med tid", async () => {
      await seed({ isRunning: false, elapsed: 300 });
      expect(await store("u1", CLIENT_A, { mode: "none" })).toBe(true);
    });

    it("afviser en anden kunde end timerens", async () => {
      await seed({});
      expect(await store("u1", CLIENT_B, { mode: "none" })).toBe(false);
      expect((await readChoice()).prepaid_choice).toBeNull();
    });

    it("afviser en ryddet timer og en timer midt i et stop", async () => {
      await seed({ isRunning: false, elapsed: 0 });
      expect(await store("u1", CLIENT_A, { mode: "none" })).toBe(false);

      await admin.unsafe(`DELETE FROM ${schema}.timer_states`);
      await seed({ intent: "stopping" });
      expect(await store("u1", CLIENT_A, { mode: "none" })).toBe(false);
      expect((await readChoice()).prepaid_choice).toBeNull();
    });

    it('"auto" rydder valget', async () => {
      await seed({});
      await store("u1", CLIENT_A, { mode: "package", packageId: PACKAGE_1 });
      expect(await store("u1", CLIENT_A, { mode: "auto" })).toBe(true);
      expect(await readChoice()).toEqual({
        prepaid_choice: null,
        prepaid_package_id: null,
        prepaid_choice_client_id: null,
      });
    });
  },
);
