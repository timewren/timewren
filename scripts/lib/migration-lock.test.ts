import { describe, expect, it, vi } from "vitest";
import {
  type AdvisoryLockClient,
  acquireMigrationLock,
  DEFAULT_LOCK_TIMEOUT_MS,
  lockTimeoutFromEnv,
  MIGRATION_LOCK_KEY,
  postgresLockClient,
} from "./migration-lock";

/**
 * En falsk Postgres med én advisory lock pr. nøgle, delt mellem "sessioner".
 * Det er præcis det scenarie #630 handler om: to containere mod samme DB.
 */
function fakeDatabase() {
  const holders = new Map<number, string>();
  const session = (id: string): AdvisoryLockClient => ({
    tryLock: vi.fn(async (key: number) => {
      const holder = holders.get(key);
      if (holder && holder !== id) return false;
      holders.set(key, id);
      return true;
    }),
    unlock: vi.fn(async (key: number) => {
      if (holders.get(key) === id) holders.delete(key);
    }),
  });
  return { session, holders };
}

/** Et ur der kun går frem når nogen "sover" — ingen ventetid i testen. */
function fakeClock(onSleep?: (elapsed: number) => void) {
  let elapsed = 0;
  return {
    now: () => elapsed,
    sleep: async (ms: number) => {
      elapsed += ms;
      onSleep?.(elapsed);
    },
  };
}

const silent = () => {};

describe("acquireMigrationLock", () => {
  it("tager låsen med det samme når ingen andre migrerer", async () => {
    const { session } = fakeDatabase();
    const client = session("a");
    const clock = fakeClock();

    const result = await acquireMigrationLock(client, {
      ...clock,
      log: silent,
    });

    expect(result).toEqual({ acquired: true, waitedMs: 0 });
    expect(client.tryLock).toHaveBeenCalledWith(MIGRATION_LOCK_KEY);
  });

  it("lader den anden instans vente til den første er færdig, i stedet for at race", async () => {
    const { session } = fakeDatabase();
    const first = session("first");
    const second = session("second");

    await acquireMigrationLock(first, { ...fakeClock(), log: silent });

    // Den første migrerer færdig efter 6 s og slipper låsen.
    const clock = fakeClock((elapsed) => {
      if (elapsed >= 6_000) void first.unlock(MIGRATION_LOCK_KEY);
    });
    const result = await acquireMigrationLock(second, {
      ...clock,
      pollIntervalMs: 2_000,
      log: silent,
    });

    expect(result).toEqual({ acquired: true, waitedMs: 6_000 });
  });

  it("giver op efter timeout, så en hængende migration stadig alarmerer", async () => {
    const { session } = fakeDatabase();
    await acquireMigrationLock(session("stuck"), {
      ...fakeClock(),
      log: silent,
    });

    const result = await acquireMigrationLock(session("waiting"), {
      ...fakeClock(),
      timeoutMs: 10_000,
      pollIntervalMs: 2_000,
      log: silent,
    });

    expect(result.acquired).toBe(false);
    expect(result.waitedMs).toBeGreaterThanOrEqual(10_000);
  });

  it("lader en ny instans overtage, når den der migrerede døde (låsen slippes med forbindelsen)", async () => {
    const { session, holders } = fakeDatabase();
    await acquireMigrationLock(session("dead"), {
      ...fakeClock(),
      log: silent,
    });

    // Forbindelsen lukker: Postgres frigiver session-låsen.
    holders.clear();

    const result = await acquireMigrationLock(session("next"), {
      ...fakeClock(),
      log: silent,
    });
    expect(result).toEqual({ acquired: true, waitedMs: 0 });
  });
});

describe("postgresLockClient", () => {
  it("bruger pg_try_advisory_lock/pg_advisory_unlock med den faste nøgle som bigint", async () => {
    const calls: { text: string; values: unknown[] }[] = [];
    const sql = vi.fn(
      async (strings: TemplateStringsArray, ...values: unknown[]) => {
        calls.push({ text: strings.join("?"), values });
        return [{ locked: true }];
      },
    );
    // biome-ignore lint/suspicious/noExplicitAny: minimal postgres.js-mock
    const client = postgresLockClient(sql as any);

    await expect(client.tryLock(MIGRATION_LOCK_KEY)).resolves.toBe(true);
    await client.unlock(MIGRATION_LOCK_KEY);

    expect(calls[0].text).toContain("pg_try_advisory_lock(?::bigint)");
    expect(calls[0].values).toEqual([String(MIGRATION_LOCK_KEY)]);
    expect(calls[1].text).toContain("pg_advisory_unlock(?::bigint)");
  });

  it("læser et false-svar som 'låsen er optaget'", async () => {
    const sql = vi.fn(async () => [{ locked: false }]);
    // biome-ignore lint/suspicious/noExplicitAny: minimal postgres.js-mock
    const client = postgresLockClient(sql as any);
    await expect(client.tryLock(MIGRATION_LOCK_KEY)).resolves.toBe(false);
  });
});

describe("lockTimeoutFromEnv", () => {
  it("bruger standarden når variablen mangler eller er ugyldig", () => {
    expect(lockTimeoutFromEnv(undefined)).toBe(DEFAULT_LOCK_TIMEOUT_MS);
    expect(lockTimeoutFromEnv("abc")).toBe(DEFAULT_LOCK_TIMEOUT_MS);
    expect(lockTimeoutFromEnv("0")).toBe(DEFAULT_LOCK_TIMEOUT_MS);
  });

  it("respekterer en gyldig værdi", () => {
    expect(lockTimeoutFromEnv("120000")).toBe(120_000);
  });
});
