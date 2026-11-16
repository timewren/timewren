/**
 * Postgres advisory lock omkring boot-migrationen (#630).
 *
 * Starter to containere tæt på hinanden (fx når Swarm genstarter appen flere
 * gange under en server-opgradering), kørte begge `migrate-safe.ts` samtidig.
 * Den ene tabte kapløbet om den samme `CREATE ...`, fejlede med 42P07, og
 * startup.sh sendte en Discord-alarm om forældet schema — selv om schemaet
 * var komplet. Den alarm kan ikke skelnes fra en ægte fejl.
 *
 * Med låsen migrerer kun én instans ad gangen. De andre venter, og når de får
 * låsen, kører de det samme idempotente forløb, som så finder intet at gøre.
 * Det er bevidst at de ikke springer helt over: dør den første instans midt i
 * migrationen, slipper Postgres låsen sammen med forbindelsen, og så er det
 * den næste der skal gøre arbejdet færdigt.
 *
 * Låsen er session-baseret og hører til forbindelsen. migrate-safe.ts bruger
 * én forbindelse (`max: 1`), så låsen holdes for hele kørslen og slippes
 * senest når forbindelsen lukkes — også hvis processen dør.
 */

import type postgres from "postgres";

/**
 * Fast nøgle til låsen. Værdien er vilkårlig, men må ikke ændres mellem
 * versioner: en gammel og en ny container skal tage den samme lås.
 */
export const MIGRATION_LOCK_KEY = 630_573_001;

/** Hvor længe en instans venter på en anden, før den giver op. */
export const DEFAULT_LOCK_TIMEOUT_MS = 5 * 60_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

export interface AdvisoryLockClient {
  /** `pg_try_advisory_lock` — true hvis låsen blev taget. */
  tryLock(key: number): Promise<boolean>;
  unlock(key: number): Promise<void>;
}

export type LockResult =
  | { acquired: true; waitedMs: number }
  | { acquired: false; waitedMs: number };

export interface AcquireOptions {
  key?: number;
  timeoutMs?: number;
  pollIntervalMs?: number;
  /** Injiceres i tests, så de ikke skal vente i realtid. */
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
}

/** Adapter fra en postgres.js-forbindelse til låse-interfacet. */
export function postgresLockClient(sql: postgres.Sql): AdvisoryLockClient {
  return {
    async tryLock(key) {
      const [row] = await sql<{ locked: boolean }[]>`
        select pg_try_advisory_lock(${String(key)}::bigint) as locked
      `;
      return row?.locked === true;
    },
    async unlock(key) {
      await sql`select pg_advisory_unlock(${String(key)}::bigint)`;
    },
  };
}

/**
 * Tag migrationslåsen, eller vent på den indtil `timeoutMs`.
 *
 * `pg_try_advisory_lock` i en løkke frem for den blokerende
 * `pg_advisory_lock`, så ventetiden har et loft, vi selv styrer. Udløber
 * den, er noget galt (en migration der hænger i minutter), og så skal
 * kalderen fejle, så den eksisterende alarm går.
 */
export async function acquireMigrationLock(
  client: AdvisoryLockClient,
  options: AcquireOptions = {},
): Promise<LockResult> {
  const key = options.key ?? MIGRATION_LOCK_KEY;
  const timeoutMs = options.timeoutMs ?? DEFAULT_LOCK_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const log = options.log ?? ((message: string) => console.log(message));

  const startedAt = now();
  if (await client.tryLock(key)) {
    return { acquired: true, waitedMs: 0 };
  }

  log("⏳ En anden instans migrerer allerede — venter på migrationslåsen...");
  while (now() - startedAt < timeoutMs) {
    await sleep(pollIntervalMs);
    if (await client.tryLock(key)) {
      const waitedMs = now() - startedAt;
      log(
        `🔓 Migrationslåsen frigivet efter ${Math.round(waitedMs / 1000)} s — tjekker om der er noget tilbage at migrere`,
      );
      return { acquired: true, waitedMs };
    }
  }
  return { acquired: false, waitedMs: now() - startedAt };
}

/** Læs ventetiden fra miljøet; ugyldige værdier giver standarden. */
export function lockTimeoutFromEnv(
  raw: string | undefined = process.env.MIGRATION_LOCK_TIMEOUT_MS,
): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0
    ? parsed
    : DEFAULT_LOCK_TIMEOUT_MS;
}
