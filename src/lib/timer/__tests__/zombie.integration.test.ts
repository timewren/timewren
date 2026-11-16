import { PgDialect } from "drizzle-orm/pg-core";
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

vi.mock("@/lib/db", () => ({ db: {} }));

import { CLEARED_PREPAID_CHOICE } from "../prepaid-choice";
import {
  buildZombieClearQuery,
  type ClearedZombie,
  clearZombieTimers,
  discardedSeconds,
  isZombieTimer,
  mapClearedZombie,
  ZOMBIE_REASON,
  zombieCutoff,
  zombieEventInput,
} from "../zombie";

const NOW = new Date("2026-10-03T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY);

describe("isZombieTimer", () => {
  it("kørende i over 7 døgn uden sync i 7 døgn er en zombie", () => {
    expect(
      isZombieTimer(
        { isRunning: true, startTime: daysAgo(60), lastSyncedAt: daysAgo(30) },
        NOW,
      ),
    ).toBe(true);
  });

  it("aldrig synket tæller som ingen sync", () => {
    expect(
      isZombieTimer(
        { isRunning: true, startTime: daysAgo(8), lastSyncedAt: null },
        NOW,
      ),
    ).toBe(true);
  });

  it("en klient der stadig synker, holder timeren i live", () => {
    expect(
      isZombieTimer(
        { isRunning: true, startTime: daysAgo(60), lastSyncedAt: daysAgo(1) },
        NOW,
      ),
    ).toBe(false);
  });

  it("under 7 døgn gammel er ikke en zombie", () => {
    expect(
      isZombieTimer(
        { isRunning: true, startTime: daysAgo(6.9), lastSyncedAt: null },
        NOW,
      ),
    ).toBe(false);
  });

  it("pausede og tomme timere røres ikke", () => {
    expect(
      isZombieTimer(
        { isRunning: false, startTime: daysAgo(60), lastSyncedAt: null },
        NOW,
      ),
    ).toBe(false);
    expect(
      isZombieTimer(
        { isRunning: true, startTime: null, lastSyncedAt: null },
        NOW,
      ),
    ).toBe(false);
  });
});

describe("buildZombieClearQuery", () => {
  const query = new PgDialect().sqlToQuery(buildZombieClearQuery(NOW));
  const text = query.sql.replace(/\s+/g, " ");

  it("er én UPDATE … RETURNING med prædikaterne i WHERE (ingen read-then-write)", () => {
    expect(text).toMatch(/^UPDATE timer_states AS t SET/);
    expect(text).toContain("FOR UPDATE");
    expect(text).toContain("RETURNING");
    // Prædikaterne står både i den låsende delforespørgsel og i den ydre WHERE
    for (const alias of ["timer_states", "t"]) {
      expect(text).toContain(`${alias}.is_running = true`);
      expect(text).toMatch(
        new RegExp(`${alias}\\.start_time < \\$\\d+::timestamp`),
      );
      expect(text).toMatch(
        new RegExp(
          `\\(${alias}\\.last_synced_at IS NULL OR ${alias}\\.last_synced_at < \\$\\d+::timestamp\\)`,
        ),
      );
    }
    expect(text).toContain("version = t.version + 1");
  });

  it("bruger en UTC-grænse 7 døgn tilbage", () => {
    expect(query.params).toContain("2026-09-26 12:00:00.000");
    expect(zombieCutoff(NOW).toISOString()).toBe("2026-09-26T12:00:00.000Z");
  });

  it("rydder de samme felter som confirmStop, inkl. klippekort-valget", () => {
    const prepaidColumns = {
      prepaidChoice: "prepaid_choice",
      prepaidPackageId: "prepaid_package_id",
      prepaidChoiceClientId: "prepaid_choice_client_id",
    } as const;
    for (const key of Object.keys(CLEARED_PREPAID_CHOICE)) {
      const col = prepaidColumns[key as keyof typeof prepaidColumns];
      expect(col, `ukendt felt i CLEARED_PREPAID_CHOICE: ${key}`).toBeTruthy();
      expect(text).toContain(`${col} = NULL`);
    }
    for (const cleared of [
      "is_running = false",
      "start_time = NULL",
      "elapsed_seconds = 0",
      "base_seconds = 0",
      "project_id = NULL",
      "client_id = NULL",
      "task_id = NULL",
      "description = ''",
      "intent = NULL",
      "intent_at = NULL",
      "intent_from = NULL",
      "is_idle = false",
      "idle_detected_at = NULL",
    ]) {
      expect(text).toContain(cleared);
    }
  });
});

describe("zombie-hændelsen", () => {
  const zombie: ClearedZombie = mapClearedZombie({
    user_id: "u1",
    organization_id: "o1",
    // Rå SQL giver nøgne UTC-strenge — skal læses som UTC
    start_time: "2026-09-01 12:00:00",
    base_seconds: 600,
    elapsed_seconds: 600,
    project_id: "p1",
    client_id: "c1",
    task_id: null,
    version_before: 41,
    version_after: 42,
    last_synced_at: "2026-09-02 08:00:00",
    last_synced_from: "extension",
  });

  it("læser rå tidsstempler som UTC", () => {
    expect(zombie.startTime?.toISOString()).toBe("2026-09-01T12:00:00.000Z");
    expect(zombie.lastSyncedAt?.toISOString()).toBe("2026-09-02T08:00:00.000Z");
  });

  it("den kasserede tid er base + nu − start", () => {
    expect(discardedSeconds(zombie, NOW)).toBe(600 + 32 * 24 * 3600);
  });

  it("logges som clear fra cron med årsag og de kasserede værdier", () => {
    const input = zombieEventInput(zombie, NOW);
    expect(input).toMatchObject({
      userId: "u1",
      organizationId: "o1",
      event: "clear",
      source: "cron",
      versionBefore: 41,
      versionAfter: 42,
      clientId: "c1",
      projectId: "p1",
      baseSeconds: 600,
    });
    expect(input.detail).toMatchObject({
      reason: ZOMBIE_REASON,
      discardedStartTime: "2026-09-01T12:00:00.000Z",
      discardedBaseSeconds: 600,
      discardedElapsedSeconds: 600,
      discardedHours: 768.2,
      clientId: "c1",
      lastSyncedFrom: "extension",
    });
  });
});

// Atomiciteten og prædikaterne kan kun verificeres mod en rigtig Postgres;
// uden TEST_DATABASE_URL skippes blokken (CI sætter variablen).
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

describe.skipIf(!TEST_DATABASE_URL)("clearZombieTimers (integration)", () => {
  const schema = `zombie_timers_${Date.now()}`;
  const admin = testPostgres({ max: 1 });
  let pool: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    await connectTestDb(admin);
    await admin.unsafe(`CREATE SCHEMA ${schema}`);
    await admin.unsafe(`
        CREATE TABLE ${schema}.timer_states (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL UNIQUE,
          organization_id text,
          is_running boolean DEFAULT false,
          start_time timestamp,
          elapsed_seconds integer DEFAULT 0,
          base_seconds integer DEFAULT 0,
          project_id uuid,
          client_id uuid,
          task_id uuid,
          description text DEFAULT '',
          last_synced_at timestamp DEFAULT now(),
          last_synced_from varchar(20),
          version integer NOT NULL DEFAULT 0,
          intent varchar(20),
          intent_at timestamp,
          intent_from varchar(20),
          is_idle boolean DEFAULT false,
          idle_detected_at timestamp,
          prepaid_choice varchar(10),
          prepaid_package_id uuid,
          prepaid_choice_client_id uuid,
          current_session_id uuid,
          updated_at timestamp NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schema}.timer_sessions (
          id uuid PRIMARY KEY,
          status varchar(12) NOT NULL,
          ended_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schema}.timer_events (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id text NOT NULL,
          organization_id text,
          created_at timestamp NOT NULL DEFAULT now(),
          event varchar(32) NOT NULL,
          source varchar(16) NOT NULL,
          client_hint varchar(64),
          version_before integer,
          version_after integer,
          start_time timestamp,
          base_seconds integer,
          project_id uuid,
          client_id uuid,
          detail jsonb
        );
      `);
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
    await admin.unsafe(`DELETE FROM ${schema}.timer_sessions`);
    await admin.unsafe(`DELETE FROM ${schema}.timer_events`);
  });

  const CLIENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const PACKAGE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

  async function seed(
    userId: string,
    row: {
      running: boolean;
      startDaysAgo: number | null;
      syncDaysAgo: number | null;
    },
  ) {
    const utc = (d: number | null) =>
      d === null ? "NULL" : `(now() AT TIME ZONE 'UTC') - interval '${d} days'`;
    await admin.unsafe(
      `INSERT INTO ${schema}.timer_states
           (user_id, organization_id, is_running, start_time, base_seconds,
            elapsed_seconds, client_id, description, last_synced_at,
            last_synced_from, version, prepaid_choice, prepaid_package_id,
            prepaid_choice_client_id)
         VALUES ($1, 'o1', $2, ${utc(row.startDaysAgo)}, 120, 120, $3,
           'glemt', ${utc(row.syncDaysAgo)}, 'web', 5, 'package', $4, $3)`,
      [userId, row.running, CLIENT, PACKAGE],
    );
  }

  async function state(userId: string) {
    const [row] = await admin.unsafe(
      `SELECT * FROM ${schema}.timer_states WHERE user_id = $1`,
      [userId],
    );
    return row;
  }

  it("rydder kun zombier, atomisk, og logger den kasserede session", async () => {
    await seed("zombie", { running: true, startDaysAgo: 60, syncDaysAgo: 30 });
    await seed("never-synced", {
      running: true,
      startDaysAgo: 10,
      syncDaysAgo: null,
    });
    await seed("still-syncing", {
      running: true,
      startDaysAgo: 60,
      syncDaysAgo: 1,
    });
    await seed("young", { running: true, startDaysAgo: 2, syncDaysAgo: 2 });
    await seed("paused", { running: false, startDaysAgo: 60, syncDaysAgo: 30 });

    const now = new Date();
    const cleared = await clearZombieTimers(db, now);
    expect(cleared.map((z) => z.userId).sort()).toEqual([
      "never-synced",
      "zombie",
    ]);

    const z = cleared.find((c) => c.userId === "zombie");
    expect(z?.versionBefore).toBe(5);
    expect(z?.versionAfter).toBe(6);
    expect(z?.clientId).toBe(CLIENT);
    expect(z?.baseSeconds).toBe(120);
    // Kasseret start ≈ 60 døgn før nu (læst som UTC)
    const ageDays =
      (now.getTime() - (z?.startTime?.getTime() ?? 0)) / (24 * 3600 * 1000);
    expect(ageDays).toBeGreaterThan(59.9);
    expect(ageDays).toBeLessThan(60.1);

    const after = await state("zombie");
    expect(after).toMatchObject({
      is_running: false,
      start_time: null,
      elapsed_seconds: 0,
      base_seconds: 0,
      client_id: null,
      project_id: null,
      description: "",
      prepaid_choice: null,
      prepaid_package_id: null,
      prepaid_choice_client_id: null,
      version: 6,
      // Sporet efter den døde klient bevares
      last_synced_from: "web",
    });

    for (const untouched of ["still-syncing", "young", "paused"]) {
      const row = await state(untouched);
      expect(row.version, untouched).toBe(5);
      expect(row.client_id, untouched).toBe(CLIENT);
    }

    const events = await admin.unsafe(
      `SELECT user_id, event, source, version_before, version_after,
           client_id, detail
         FROM ${schema}.timer_events ORDER BY user_id`,
    );
    expect(events).toHaveLength(2);
    expect(events[1]).toMatchObject({
      user_id: "zombie",
      event: "clear",
      source: "cron",
      version_before: 5,
      version_after: 6,
      client_id: CLIENT,
    });
    expect(events[1].detail).toMatchObject({
      reason: ZOMBIE_REASON,
      discardedBaseSeconds: 120,
      clientId: CLIENT,
      lastSyncedFrom: "web",
    });
    expect(events[1].detail.discardedHours).toBeGreaterThan(60 * 24 - 1);

    // Anden kørsel rydder intet
    expect(await clearZombieTimers(db, new Date())).toEqual([]);
  });

  it("nulstiller rækkens session og kasserer den — kun den (efter id)", async () => {
    const SESSION = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
    const OTHER = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    await seed("zombie", { running: true, startDaysAgo: 60, syncDaysAgo: 30 });
    await admin.unsafe(
      `UPDATE ${schema}.timer_states SET current_session_id = $1 WHERE user_id = 'zombie'`,
      [SESSION],
    );
    await admin.unsafe(
      `INSERT INTO ${schema}.timer_sessions (id, status) VALUES ($1, 'running'), ($2, 'running')`,
      [SESSION, OTHER],
    );

    const [z] = await clearZombieTimers(db, new Date());
    expect(z?.sessionId).toBe(SESSION);
    expect((await state("zombie")).current_session_id).toBeNull();
    const sessions = await admin.unsafe(
      `SELECT id, status, ended_at FROM ${schema}.timer_sessions ORDER BY id`,
    );
    expect(sessions[0]).toMatchObject({ id: SESSION, status: "discarded" });
    expect(sessions[0].ended_at).not.toBeNull();
    expect(sessions[1]).toMatchObject({ id: OTHER, status: "running" });
  });
});
