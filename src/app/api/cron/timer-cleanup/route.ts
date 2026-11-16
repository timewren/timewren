import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import { timerStates } from "@/lib/db/schema";
import { logTimerEvent } from "@/lib/timer/events";
import {
  clearEmptyPausedRows,
  clearRowsWithSavedSession,
  closeActiveSessions,
  currentSessionSavedSql,
  setSessionStatus,
} from "@/lib/timer/sessions";
import { clearZombieTimers, discardedSeconds } from "@/lib/timer/zombie";
import { captureRouteError } from "@/lib/utils/sentry";

// Clean up stale timer intents
// Runs every 5 minutes via Vercel Cron
// Parks timers stuck in "stopping" for over 5 minutes as PAUSED, clears rows
// left paused on an already SAVED session or with 0 s on a fresh session
// (review P3), and clears zombie
// timers (running > 7 days without any sync) — see lib/timer/zombie.ts

export const GET = withCronLogging("timer-cleanup", async (_request) => {
  // Find and park stale intents (older than 5 minutes)
  const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);

  const staleIntents = await db.query.timerStates.findMany({
    where: and(
      eq(timerStates.intent, "stopping"),
      isNotNull(timerStates.intentAt),
      lt(timerStates.intentAt, fiveMinutesAgo),
    ),
    columns: {
      id: true,
      userId: true,
      intent: true,
      intentAt: true,
      intentFrom: true,
      version: true,
      isRunning: true,
      startTime: true,
      elapsedSeconds: true,
      baseSeconds: true,
      currentSessionId: true,
    },
  });

  let clearedCount = 0;

  for (const timerState of staleIntents) {
    try {
      // Timer-sessioner (fase 1): er sessionen allerede GEMT (posten landede,
      // kun confirm gik tabt), er der intet at parkere — ryd rækken som en
      // confirm ville have gjort. Atomisk: version + "gemt" i WHERE.
      const finished = await db.transaction(async (tx) => {
        const [row] = await tx
          .update(timerStates)
          .set({
            isRunning: false,
            startTime: null,
            elapsedSeconds: 0,
            baseSeconds: 0,
            projectId: null,
            clientId: null,
            taskId: null,
            description: "",
            isIdle: false,
            idleDetectedAt: null,
            intent: null,
            intentAt: null,
            intentFrom: null,
            prepaidChoice: null,
            prepaidPackageId: null,
            prepaidChoiceClientId: null,
            currentSessionId: null,
            version: sql`${timerStates.version} + 1`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(timerStates.id, timerState.id),
              eq(timerStates.version, timerState.version),
              currentSessionSavedSql(),
            ),
          )
          .returning({ id: timerStates.id });
        if (row) await closeActiveSessions(tx, timerState.userId, "saved");
        return row;
      });
      if (finished) {
        clearedCount++;
        await logTimerEvent(db, {
          userId: timerState.userId,
          event: "cron_park",
          source: "cron",
          versionBefore: timerState.version,
          versionAfter: timerState.version + 1,
          startTime: timerState.startTime,
          detail: {
            finishedSavedSession: true,
            sessionId: timerState.currentSessionId ?? undefined,
            intentFrom: timerState.intentFrom,
            intentAt: timerState.intentAt?.toISOString() ?? null,
          },
        });
        continue;
      }

      // Park the session as PAUSED — never resurrect it as running (old
      // behavior: adopted by every client, double-counted on next stop) and
      // never zero it (a claim whose client died before createTimeEntry —
      // killed MV3 popup, closed tab mid save-modal — has the ONLY copy of
      // the session here; zeroing would silently destroy unsaved work).
      // Paused is the safe middle: if the entry WAS saved and only the
      // confirm got lost, the user sees a paused leftover and can discard it
      // — visible possible-duplicate beats silent loss.
      const intentAtMs = timerState.intentAt?.getTime() ?? Date.now();
      const trackedSeconds =
        timerState.isRunning && timerState.startTime
          ? (timerState.baseSeconds ?? 0) +
            Math.max(
              0,
              Math.floor((intentAtMs - timerState.startTime.getTime()) / 1000),
            )
          : Math.max(
              timerState.elapsedSeconds ?? 0,
              timerState.baseSeconds ?? 0,
            );
      const [cleared] = await db
        .update(timerStates)
        .set({
          isRunning: false,
          startTime: null,
          elapsedSeconds: trackedSeconds,
          baseSeconds: trackedSeconds,
          isIdle: false,
          idleDetectedAt: null,
          intent: null,
          intentAt: null,
          intentFrom: null,
          // Uden tid er der intet at parkere: rækken er ryddet, og sessionen
          // kasseres (en ryddet række bærer aldrig en session)
          ...(trackedSeconds > 0 ? {} : { currentSessionId: null }),
          version: timerState.version + 1,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(timerStates.id, timerState.id),
            // Race guard: touch the row only if nothing else moved it since
            // we read it (a late confirm/cancel bumps the version).
            eq(timerStates.version, timerState.version),
          ),
        )
        .returning({ id: timerStates.id });

      if (cleared) {
        clearedCount++;
        // Sessionen lever videre som pauset (samme id) — eller kasseres,
        // når der ingen tid var
        if (timerState.currentSessionId) {
          await setSessionStatus(
            db,
            timerState.userId,
            timerState.currentSessionId,
            trackedSeconds > 0 ? "paused" : "discarded",
          );
        }
        await logTimerEvent(db, {
          userId: timerState.userId,
          event: "cron_park",
          source: "cron",
          versionBefore: timerState.version,
          versionAfter: timerState.version + 1,
          startTime: timerState.startTime,
          baseSeconds: trackedSeconds,
          detail: {
            trackedSeconds,
            wasRunning: !!timerState.isRunning,
            intentFrom: timerState.intentFrom,
            intentAt: timerState.intentAt?.toISOString() ?? null,
          },
        });
        console.warn(
          `[Timer Cleanup] Parked stale stopping timer as paused (${trackedSeconds}s) for user ${timerState.userId}, was stopping from ${timerState.intentFrom} since ${timerState.intentAt}`,
        );
      }
    } catch (err) {
      captureRouteError(err, {
        route: "/api/cron/timer-cleanup",
        type: "cron",
      });
      console.error("[Timer Cleanup] Error clearing intent:", err);
    }
  }

  // Rester af gemte sessioner (review P3): en række der ikke kører og ikke er
  // midt i et stop, men stadig bærer en gemt session. Dens tid ligger i
  // posten — ryd den, så ældre klienter kan starte igen. Atomisk.
  let savedLeftoverCount = 0;
  let savedLeftoverFailed = 0;
  try {
    const leftovers = await clearRowsWithSavedSession(db);
    savedLeftoverCount = leftovers.length;
    for (const r of leftovers) {
      await logTimerEvent(db, {
        userId: r.userId,
        event: "cron_park",
        source: "cron",
        versionBefore: r.version - 1,
        versionAfter: r.version,
        detail: { clearedSavedSessionLeftover: true },
      });
      console.warn(
        `[Timer Cleanup] Cleared leftover row of a saved session for user ${r.userId}`,
      );
    }
  } catch (err) {
    savedLeftoverFailed = 1;
    captureRouteError(err, {
      route: "/api/cron/timer-cleanup",
      type: "cron",
    });
    console.error("[Timer Cleanup] Error clearing saved-session rows:", err);
  }

  // Tomme pausede rester (review P3): quickStops nulstilling kan efterlade en
  // pauset række med 0 sekunder og en ny session. Ingen ugemt tid — ryd den.
  let emptyPausedCount = 0;
  let emptyPausedFailed = 0;
  try {
    const empties = await db.transaction((tx) => clearEmptyPausedRows(tx));
    emptyPausedCount = empties.length;
    for (const r of empties) {
      await logTimerEvent(db, {
        userId: r.userId,
        event: "cron_park",
        source: "cron",
        versionBefore: r.version - 1,
        versionAfter: r.version,
        detail: { clearedEmptyPausedRow: true },
      });
      console.warn(
        `[Timer Cleanup] Cleared empty paused row for user ${r.userId}`,
      );
    }
  } catch (err) {
    emptyPausedFailed = 1;
    captureRouteError(err, {
      route: "/api/cron/timer-cleanup",
      type: "cron",
    });
    console.error("[Timer Cleanup] Error clearing empty paused rows:", err);
  }

  // Zombie-timere: én atomisk UPDATE med prædikaterne i WHERE. Ingen
  // tidspost — ingen arbejder 7 døgn i træk. Stabilitetsvagten viser et
  // info-fund ud fra timer_events-loggen.
  let zombieCount = 0;
  let zombieFailed = 0;
  try {
    const now = new Date();
    const zombies = await clearZombieTimers(db, now);
    zombieCount = zombies.length;
    for (const z of zombies) {
      console.warn(
        `[Timer Cleanup] Cleared zombie timer for user ${z.userId} (running since ${z.startTime?.toISOString() ?? "?"}, ${Math.round(discardedSeconds(z, now) / 3600)} h discarded, last sync ${z.lastSyncedAt?.toISOString() ?? "never"} from ${z.lastSyncedFrom ?? "?"})`,
      );
    }
  } catch (err) {
    zombieFailed = 1;
    captureRouteError(err, {
      route: "/api/cron/timer-cleanup",
      type: "cron",
    });
    console.error("[Timer Cleanup] Error clearing zombie timers:", err);
  }

  return {
    itemsProcessed:
      staleIntents.length +
      savedLeftoverCount +
      savedLeftoverFailed +
      emptyPausedCount +
      emptyPausedFailed +
      zombieCount +
      zombieFailed,
    itemsSucceeded:
      clearedCount + savedLeftoverCount + emptyPausedCount + zombieCount,
    itemsFailed:
      staleIntents.length -
      clearedCount +
      savedLeftoverFailed +
      emptyPausedFailed +
      zombieFailed,
    metadata: {
      staleIntentsParked: clearedCount,
      savedSessionLeftoversCleared: savedLeftoverCount,
      emptyPausedRowsCleared: emptyPausedCount,
      zombiesCleared: zombieCount,
    },
  };
});
