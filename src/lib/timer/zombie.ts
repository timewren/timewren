import { type SQL, sql } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { publishTimerEvent } from "@/lib/realtime";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { logTimerEvent, type TimerEventInput } from "./events";

/**
 * Zombie-timere: rækker i timer_states der har stået som "kørende" i over en
 * uge, uden at nogen klient har synket dem i samme periode. Ingen arbejder 7
 * døgn i træk — det er en fane eller enhed der døde midt i en session.
 * Prod havde 3/10-2026 seks af dem på 1.400–5.000 timer (forladt mellem marts
 * og august), som kun forurenede runaway_timer-fundene.
 *
 * Oprydningen nulstiller rækken som confirmStop gør, men opretter INGEN
 * tidspost (tiden er ikke reel). Den kasserede session logges i timer_events,
 * så den kan genskabes, og stabilitetsvagten viser et info-fund.
 */

export const ZOMBIE_TIMER_DAYS = 7;
export const ZOMBIE_REASON = "zombie_auto_clear";
const ZOMBIE_BATCH_LIMIT = 100;

/** Date → "YYYY-MM-DD HH:MM:SS.mmm" (UTC, uden zone) til ::timestamp */
function toUtcSql(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export function zombieCutoff(now: Date): Date {
  return new Date(now.getTime() - ZOMBIE_TIMER_DAYS * 24 * 60 * 60 * 1000);
}

/** Samme regel som SQL'en — til tests og forklaring. */
export function isZombieTimer(
  row: {
    isRunning: boolean | null;
    startTime: Date | null;
    lastSyncedAt: Date | null;
  },
  now: Date,
): boolean {
  const cutoff = zombieCutoff(now).getTime();
  return (
    row.isRunning === true &&
    row.startTime !== null &&
    row.startTime.getTime() < cutoff &&
    (row.lastSyncedAt === null || row.lastSyncedAt.getTime() < cutoff)
  );
}

/**
 * Én atomisk UPDATE … RETURNING (ingen read-then-write): prædikaterne står i
 * både den låsende delforespørgsel og den ydre WHERE, så en klient der synker
 * rækken samtidig, vinder. Delforespørgslen (`old`) leverer de kasserede
 * værdier fra før opdateringen. Felterne nulstilles som i confirmStop
 * (inkl. klippekort-valget, jf. CLEARED_PREPAID_CHOICE); last_synced_* røres
 * ikke, så sporet efter den døde klient bevares.
 */
export function buildZombieClearQuery(now: Date): SQL {
  const cutoff = sql`${toUtcSql(zombieCutoff(now))}::timestamp`;
  const nowSql = sql`${toUtcSql(now)}::timestamp`;
  const predicate = (alias: string) => {
    const t = sql.raw(alias);
    return sql`${t}.is_running = true
      AND ${t}.start_time IS NOT NULL
      AND ${t}.start_time < ${cutoff}
      AND (${t}.last_synced_at IS NULL OR ${t}.last_synced_at < ${cutoff})`;
  };
  return sql`UPDATE timer_states AS t SET
      is_running = false,
      start_time = NULL,
      elapsed_seconds = 0,
      base_seconds = 0,
      project_id = NULL,
      client_id = NULL,
      task_id = NULL,
      description = '',
      intent = NULL,
      intent_at = NULL,
      intent_from = NULL,
      prepaid_choice = NULL,
      prepaid_package_id = NULL,
      prepaid_choice_client_id = NULL,
      is_idle = false,
      idle_detected_at = NULL,
      current_session_id = NULL,
      version = t.version + 1,
      updated_at = ${nowSql}
    FROM (
      SELECT id, user_id, organization_id, start_time, base_seconds,
        elapsed_seconds, project_id, client_id, task_id, version,
        last_synced_at, last_synced_from, current_session_id
      FROM timer_states
      WHERE ${predicate("timer_states")}
      ORDER BY start_time
      LIMIT ${ZOMBIE_BATCH_LIMIT}
      FOR UPDATE
    ) AS old
    WHERE t.id = old.id AND ${predicate("t")}
    RETURNING old.user_id, old.organization_id, old.start_time,
      old.base_seconds, old.elapsed_seconds, old.project_id, old.client_id,
      old.task_id, old.version AS version_before, t.version AS version_after,
      old.last_synced_at, old.last_synced_from,
      old.current_session_id AS session_id`;
}

export interface ClearedZombie {
  userId: string;
  organizationId: string | null;
  startTime: Date | null;
  baseSeconds: number;
  elapsedSeconds: number;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  versionBefore: number;
  versionAfter: number;
  lastSyncedAt: Date | null;
  lastSyncedFrom: string | null;
  /** Den kasserede server-udstedte session (timer-sessioner, fase 1) */
  sessionId: string | null;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

function int(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function mapClearedZombie(r: Record<string, unknown>): ClearedZombie {
  return {
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    startTime: parseDbTimestamp(r.start_time as Date | string | null),
    baseSeconds: int(r.base_seconds),
    elapsedSeconds: int(r.elapsed_seconds),
    projectId: str(r.project_id),
    clientId: str(r.client_id),
    taskId: str(r.task_id),
    versionBefore: int(r.version_before),
    versionAfter: int(r.version_after),
    lastSyncedAt: parseDbTimestamp(r.last_synced_at as Date | string | null),
    sessionId: str(r.session_id),
    lastSyncedFrom: str(r.last_synced_from),
  };
}

/** Den kasserede tid: base + (nu − start), som timeren selv ville vise. */
export function discardedSeconds(z: ClearedZombie, now: Date): number {
  const running = z.startTime
    ? Math.max(0, Math.floor((now.getTime() - z.startTime.getTime()) / 1000))
    : 0;
  return z.baseSeconds + running;
}

export function zombieEventInput(z: ClearedZombie, now: Date): TimerEventInput {
  const seconds = discardedSeconds(z, now);
  return {
    userId: z.userId,
    organizationId: z.organizationId,
    event: "clear",
    source: "cron",
    versionBefore: z.versionBefore,
    versionAfter: z.versionAfter,
    startTime: z.startTime,
    baseSeconds: z.baseSeconds,
    projectId: z.projectId,
    clientId: z.clientId,
    detail: {
      reason: ZOMBIE_REASON,
      discardedStartTime: z.startTime?.toISOString() ?? null,
      discardedBaseSeconds: z.baseSeconds,
      discardedElapsedSeconds: z.elapsedSeconds,
      discardedSeconds: seconds,
      discardedHours: Math.round((seconds / 3600) * 10) / 10,
      clientId: z.clientId,
      projectId: z.projectId,
      taskId: z.taskId,
      lastSyncedAt: z.lastSyncedAt?.toISOString() ?? null,
      lastSyncedFrom: z.lastSyncedFrom,
    },
  };
}

type Db = Pick<typeof dbType, "execute" | "insert">;

/** Ryd zombie-timere, log hver i timer_events og giv åbne faner besked. */
export async function clearZombieTimers(
  db: Db,
  now: Date = new Date(),
): Promise<ClearedZombie[]> {
  const result = (await db.execute(
    buildZombieClearQuery(now),
  )) as unknown as Record<string, unknown>[];
  const cleared = Array.from(result, mapClearedZombie);
  // De kasserede sessioner lukkes — efter id, så en ny session der er startet
  // siden, aldrig rammes.
  const sessionIds = cleared
    .map((z) => z.sessionId)
    .filter((id): id is string => !!id);
  if (sessionIds.length > 0) {
    await db.execute(
      sql`UPDATE timer_sessions SET status = 'discarded', ended_at = now(), updated_at = now()
        WHERE id IN (${sql.join(
          sessionIds.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}) AND status IN ('running', 'paused', 'stopping')`,
    );
  }
  for (const z of cleared) {
    await logTimerEvent(db, zombieEventInput(z, now));
    await publishTimerEvent(z.userId, z.organizationId, {
      userId: z.userId,
      type: "cleared",
      isRunning: false,
      projectId: null,
      clientId: null,
      taskId: null,
      description: "",
      version: z.versionAfter,
    });
  }
  return cleared;
}
