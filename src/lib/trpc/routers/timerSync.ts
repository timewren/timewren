import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { getAppUrl } from "@/lib/config";
import { clients, projects, tasks, timerStates } from "@/lib/db/schema";
import { sendNotification } from "@/lib/notifications";
import { publishTimerEvent } from "@/lib/realtime";
import { toUtcSql } from "@/lib/time/db-timestamp";
import {
  classifyTimerWrite,
  logTimerEvent,
  timerEventOrigin,
} from "@/lib/timer/events";
import { isHeartbeatVersionConflict } from "@/lib/timer/heartbeat-version";
import { claimIdleStamp, stampIdle } from "@/lib/timer/idle-claim";
import {
  CLEARED_PREPAID_CHOICE,
  readTimerPrepaidChoice,
  setTimerPrepaidChoice,
  timerPrepaidChoiceInputSchema,
  writeResetsPrepaidChoice,
} from "@/lib/timer/prepaid-choice";
import {
  isClearedTimerRow,
  noResurrectionGuardSql,
} from "@/lib/timer/resurrection";
import {
  expectedStartSql,
  heartbeatSessionGuardSql,
  isLegacyNativeAppRequest,
} from "@/lib/timer/session-match";
import {
  closeActiveSessions,
  currentSessionNotSavedSql,
  currentSessionSavedSql,
  findSessionByStartOp,
  NIL_SESSION_ID,
  newSessionId,
  recordSession,
  SESSION_MISMATCH,
  sessionIdInsertValue,
  sessionIdSetSql,
  sessionMatchSql,
  sessionStartFromRow,
  sessionStatusForRow,
  timerSyncSessionMode,
} from "@/lib/timer/sessions";
import { cancelStop, claimStop, confirmStop } from "@/lib/timer/stop-protocol";
import { protectedProcedure, router } from "../trpc";

// Timer states are per-user (personal timer), but project/client lookups use orgId
/**
 * Er to klient-operationsnøgler den samme? Kun ægte nøgler tæller — en tom
 * kolonne matcher aldrig (ellers ville enhver køet start uden historik se ud
 * som en afspilning).
 */
/** Et stop-claim ældre end dette uden confirm regnes for forladt (P2-1). */
const ABANDONED_STOP_MS = 60_000;

export function isSameClientOp(
  stored: string | null | undefined,
  incoming: string | null | undefined,
): boolean {
  return !!stored && !!incoming && stored === incoming;
}

/**
 * Klientens session for en skrivning: `sessionId`, ellers sessionen som
 * startnøglen (`sessionOpId`) oprettede — et nil-id hvis den ikke findes, så
 * det atomiske prædikat aldrig matcher. Ingen af delene: ældre klient.
 */
async function resolveClientSessionId(
  db: Parameters<typeof findSessionByStartOp>[0],
  userId: string,
  ids: { sessionId?: string; sessionOpId?: string },
): Promise<string | undefined> {
  if (ids.sessionId) return ids.sessionId;
  if (!ids.sessionOpId) return undefined;
  const session = await findSessionByStartOp(db, userId, ids.sessionOpId);
  return session?.id ?? NIL_SESSION_ID;
}

/**
 * Svar på en gentaget start (samme clientOpId): intet skrives. Med sessionen
 * startoperationen oprettede kan klienten se, om DENS session stadig er den
 * aktive (overtag den) eller er afsluttet i mellemtiden (nulstil).
 */
function dedupedStart(
  row:
    | {
        version: number;
        startTime: Date | null;
        currentSessionId: string | null;
      }
    | undefined,
  opSession: { id: string; status: string } | undefined,
) {
  return {
    success: true as const,
    deduplicated: true,
    syncedAt: new Date().toISOString(),
    version: row?.version ?? 0,
    // Rækken kan siden bære en anden session — klienten tjekker selv.
    startTime: row?.startTime?.toISOString() ?? null,
    sessionId: opSession?.id ?? null,
    sessionStatus: opSession?.status ?? null,
    sessionCurrent: !!opSession && row?.currentSessionId === opSession.id,
  };
}

export const timerSyncRouter = router({
  // Get server timer state for current user
  getState: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const timerState = await ctx.db.query.timerStates.findFirst({
      where: eq(timerStates.userId, userId),
      with: {
        project: {
          columns: {
            id: true,
            name: true,
            clientId: true,
          },
        },
        client: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!timerState) {
      return {
        isRunning: false,
        startTime: null,
        sessionStartTime: null,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: null,
        clientId: null,
        taskId: null,
        description: "",
        project: null,
        client: null,
        lastSyncedAt: null,
        lastSyncedFrom: null,
        version: 0,
        intent: null,
        intentFrom: null,
        prepaidChoice: null,
        sessionId: null as string | null,
      };
    }

    return {
      isRunning: timerState.isRunning,
      startTime: timerState.startTime?.toISOString() || null,
      sessionStartTime: timerState.startTime?.toISOString() || null,
      elapsedSeconds: timerState.elapsedSeconds || 0,
      baseSeconds: timerState.baseSeconds || 0,
      projectId: timerState.projectId,
      clientId: timerState.clientId,
      taskId: timerState.taskId,
      description: timerState.description || "",
      project: timerState.project,
      client: timerState.client,
      lastSyncedAt: timerState.lastSyncedAt?.toISOString() || null,
      lastSyncedFrom: timerState.lastSyncedFrom,
      version: timerState.version,
      intent: timerState.intent,
      intentFrom: timerState.intentFrom,
      // Klippekort-valg for den kørende timer (#422); null = automatisk
      prepaidChoice: readTimerPrepaidChoice(timerState),
      // Server-udstedt session (fase 1); null på en ryddet/ældre række
      sessionId: timerState.currentSessionId ?? null,
    };
  }),

  // Get state with version (for intent-based sync)
  getStateWithVersion: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const timerState = await ctx.db.query.timerStates.findFirst({
      where: eq(timerStates.userId, userId),
      with: {
        project: {
          columns: {
            id: true,
            name: true,
            clientId: true,
          },
        },
        client: {
          columns: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!timerState) {
      return {
        isRunning: false,
        startTime: null,
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: null,
        clientId: null,
        description: "",
        project: null,
        client: null,
        version: 0,
        intent: null,
        intentAt: null,
        intentFrom: null,
        prepaidChoice: null,
        sessionId: null as string | null,
      };
    }

    return {
      isRunning: timerState.isRunning,
      startTime: timerState.startTime?.toISOString() || null,
      elapsedSeconds: timerState.elapsedSeconds || 0,
      baseSeconds: timerState.baseSeconds || 0,
      projectId: timerState.projectId,
      clientId: timerState.clientId,
      description: timerState.description || "",
      project: timerState.project,
      client: timerState.client,
      version: timerState.version,
      intent: timerState.intent,
      intentAt: timerState.intentAt?.toISOString() || null,
      intentFrom: timerState.intentFrom,
      prepaidChoice: readTimerPrepaidChoice(timerState),
      // Server-udstedt session (fase 1); null på en ryddet/ældre række
      sessionId: timerState.currentSessionId ?? null,
    };
  }),

  // Klippekort-valg for den kørende timer (#422): gemmes på serveren, så
  // stop fra web, extension og app trækker fra samme kort. "auto" rydder
  // valget (udløber-først-reglen afgør så kortet ved stop).
  setPrepaidChoice: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
        choice: timerPrepaidChoiceInputSchema,
      }),
    )
    .mutation(async ({ ctx, input }) =>
      setTimerPrepaidChoice(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        clientId: input.clientId,
        choice: input.choice,
      }),
    ),

  // Claim timer for stopping - atomic operation before stop
  claimForStop: protectedProcedure
    .input(
      z.object({
        expectedVersion: z.number(),
        source: z.enum(["web", "extension"]),
        // Mobil (A7 S2): starttiden (ms) på den session klienten vil stoppe.
        // Claimet lander kun på netop den session — ikke en anden, der er
        // startet et andet sted siden klientens sidste afstemning.
        expectedStartTime: z.number().optional(),
        // Server-udstedt session (fase 1): claimet lander kun på netop den.
        sessionId: z.string().uuid().optional(),
        // Ukendt id (tabt svar på starten): sessionen startnøglen oprettede
        sessionOpId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      claimStop(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        headers: ctx.headers,
        source: input.source,
        expectedVersion: input.expectedVersion,
        expectedStartTime: input.expectedStartTime,
        sessionId: await resolveClientSessionId(
          ctx.db,
          ctx.session.user.id,
          input,
        ),
      }),
    ),

  // Confirm stop - called after successfully saving time entry
  confirmStop: protectedProcedure
    .input(
      z.object({
        version: z.number(),
        source: z.enum(["web", "extension"]),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      confirmStop(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        headers: ctx.headers,
        source: input.source,
        version: input.version,
        sessionId: input.sessionId,
      }),
    ),

  // Cancel stop - called when user cancels from save modal. Afvises med
  // `already_saved` når sessionen allerede er gemt (#783).
  cancelStop: protectedProcedure
    .input(
      z.object({
        version: z.number(),
        source: z.enum(["web", "extension"]),
        sessionId: z.string().uuid().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      cancelStop(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        headers: ctx.headers,
        source: input.source,
        version: input.version,
        sessionId: input.sessionId,
      }),
    ),

  // Sync timer state to server (called periodically from client)
  sync: protectedProcedure
    .input(
      z.object({
        isRunning: z.boolean(),
        startTime: z.number().nullable(), // Unix timestamp in ms
        sessionStartTime: z.number().nullable(), // Original session start
        elapsedSeconds: z.number().int().min(0),
        baseSeconds: z.number().int().min(0),
        projectId: z.string().uuid().nullable(),
        clientId: z.string().uuid().nullable(),
        taskId: z.string().uuid().nullable(),
        description: z.string(),
        source: z.enum(["web", "extension"]).optional().default("web"),
        // True only on the user's explicit "start a fresh timer" action (not
        // periodic heartbeats or recovery). Kept for wire-compat and telemetry;
        // the one-running-timer guard below now applies to EVERY write that
        // sets isRunning=true (except adoption), not just fresh starts.
        isFreshStart: z.boolean().optional().default(false),
        // True only on the first sync after this client adopted the server's
        // already-running timer (recovery/reconcile). Lets that sync take
        // ownership (lastSyncedFrom) of the SAME timer without tripping the
        // one-running-timer guard below.
        isAdoption: z.boolean().optional().default(false),
        // Offline-kø (#703): klient-genereret idempotensnøgle på en køet
        // timerstart. Gør skrivningen til en "køet start" — se nedenfor.
        clientOpId: z.string().uuid().optional(),
        // Versionstjek på et rent keep-alive-heartbeat fra web (audit A5,
        // P1-4): er rækken skrevet siden (fx af en anden fane med samme
        // `source`), afvises heartbeatet med `version_conflict` i stedet for
        // at overskrive nyere detaljer med fanens forældede. Mobil og ældre
        // klienter sender den ikke og opfører sig som før.
        expectedVersion: z.number().int().min(0).optional(),
        // Mobil (A7 M3/S1): starttiden (ms) på den session klienten tror
        // kører. Et heartbeat (fx projektskift) lander kun på netop den.
        expectedStartTime: z.number().optional(),
        // Server-udstedt session (fase 1, docs/architecture/timer-sessions.md):
        // skrivningen lander kun på netop den session — ellers
        // `session_mismatch`, og klienten adopterer serverens tilstand.
        sessionId: z.string().uuid().optional(),
        // En start hvis svar gik tabt, kendes kun på sin idempotensnøgle:
        // skrivninger til den session bærer nøglen, indtil id'et er kendt.
        sessionOpId: z.string().uuid().optional(),
        // En adoption/pause der ikke ændrer projekt/kunde/opgave/beskrivelse
        // (fanens kopi er den serveren sidst bekræftede): rækkens værdier
        // bevares, så en fane med forældede detaljer ikke overskriver et
        // nyere skift (#786).
        keepDetails: z.boolean().optional(),
        // "Fortsæt" (#767): den nye session forlænger denne post ved gem.
        continuesEntryId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project/client/task belong to this user/org before persisting —
      // otherwise an authenticated user could store another tenant's ids on
      // their own timerState and later copy them onto a new time entry.
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
          columns: { id: true },
        });
        if (!project) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.projectNotFound"),
          });
        }
      }
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
          columns: { id: true },
        });
        if (!client) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.clientNotFound"),
          });
        }
      }
      if (input.taskId) {
        const task = await ctx.db.query.tasks.findFirst({
          where: and(
            eq(tasks.id, input.taskId),
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, userId),
          ),
          columns: { id: true },
        });
        if (!task) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "common.taskNotFound"),
          });
        }
      }

      // Get existing timer state
      const existing = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
      });

      // Klientens session: id'et, eller (ukendt id) sessionen dens start-
      // nøgle oprettede. Findes den ikke, matcher prædikatet intet.
      const clientSessionId = await resolveClientSessionId(ctx.db, userId, {
        sessionId: input.sessionId,
        sessionOpId: input.sessionOpId,
      });

      // Afspilning af en køet start, der allerede er landet (svaret gik tabt):
      // samme operation to gange = én effekt. Intet skrives — heller ikke når
      // timeren siden er stoppet, for nøglen ryddes aldrig af andre skrivninger.
      const isQueuedStart =
        !!input.clientOpId && input.isRunning && !input.isAdoption;

      // Hændelseslog (A6): skrives EFTER hver afgørelse, aldrig i en guard.
      const eventBase = {
        userId,
        organizationId: ctx.orgId,
        ...timerEventOrigin(ctx.headers, input.source),
        startTime: input.startTime ? new Date(input.startTime) : null,
        baseSeconds: input.baseSeconds,
        projectId: input.projectId,
        clientId: input.clientId,
      };
      const writeKind = input.isAdoption
        ? "adoption"
        : isQueuedStart
          ? "queued_start"
          : input.isRunning
            ? input.isFreshStart
              ? "fresh_start"
              : "heartbeat"
            : input.elapsedSeconds > 0 || input.baseSeconds > 0
              ? "pause"
              : "clear";

      // Sessionen en tidligere landet start med samme nøgle oprettede —
      // også når en senere køet start har overskrevet lastClientOpId.
      const opSession =
        isQueuedStart && input.clientOpId
          ? await findSessionByStartOp(ctx.db, userId, input.clientOpId)
          : undefined;
      if (
        isQueuedStart &&
        (isSameClientOp(existing?.lastClientOpId, input.clientOpId) ||
          !!opSession)
      ) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: "start_deduplicated",
          versionAfter: existing?.version ?? null,
          detail: {
            kind: writeKind,
            clientOpId: input.clientOpId,
            sessionId: opSession?.id,
          },
        });
        return dedupedStart(existing, opSession);
      }

      // En sessionsbevidst skrivning uden nogen række har intet at lande på.
      if (clientSessionId && !existing) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: input.isRunning ? "heartbeat_rejected" : "pause_rejected",
          detail: {
            kind: writeKind,
            reason: SESSION_MISMATCH,
            sessionId: clientSessionId,
          },
        });
        return {
          success: false,
          reason: SESSION_MISMATCH,
          sessionId: null,
          isRunning: false,
          version: 0,
        };
      }

      // If timer is being stopped by someone else, reject the sync
      if (
        existing?.intent === "stopping" &&
        existing.intentFrom !== input.source
      ) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: "blocked_stopping",
          versionAfter: existing.version,
          detail: { kind: writeKind, stoppedBy: existing.intentFrom },
        });
        return {
          success: false,
          reason: "stopping_in_progress",
          stoppedBy: existing.intentFrom,
          version: existing.version,
        };
      }

      const now = new Date();

      const timerData = {
        isRunning: input.isRunning,
        startTime: input.startTime ? new Date(input.startTime) : null,
        elapsedSeconds: input.elapsedSeconds,
        baseSeconds: input.baseSeconds,
        projectId: input.projectId,
        clientId: input.clientId,
        taskId: input.taskId,
        description: input.description,
        lastSyncedAt: now,
        lastSyncedFrom: input.source,
        lastActivityAt: now,
        updatedAt: now,
      };

      // Only ONE running timer per user across all clients (web + extension).
      // The rule is enforced ATOMICALLY in the upsert below via `setWhere` —
      // a read-then-write pre-check is not enough (two clients writing at the
      // same moment would both pass it). Write classes:
      //
      // - FRESH START (user-initiated): may start on a stopped/cleared row,
      //   blocked only when another client owns a running timer.
      // - HEARTBEAT (periodic sync of an already-running timer): may ONLY land
      //   while the row is STILL running and not owned by another client. A
      //   heartbeat must never RESURRECT a row that a stop on another client
      //   just cleared — that exact race (in-flight web heartbeat landing after
      //   the extension's confirmStop) revived stopped timers and inflated
      //   their elapsed time.
      // - ADOPTION (taking over the server's own running timer): only while the
      //   row is still running, otherwise adoption_stale.
      // - PAUSE (not running, but carries elapsed/base time): must not revive a
      //   fully CLEARED row — a late pause write after a stop+save would
      //   re-materialize already-saved time, which a later save double-counts.
      // - CLEAR (not running, no time): always allowed (idempotent reset).
      const isHeartbeat =
        input.isRunning &&
        !input.isFreshStart &&
        !input.isAdoption &&
        !isQueuedStart;
      const isPauseWrite =
        !input.isRunning && (input.elapsedSeconds > 0 || input.baseSeconds > 0);
      const otherOwnerGuard = sql`NOT (COALESCE(${timerStates.isRunning}, false) AND ${timerStates.lastSyncedFrom} IS NOT NULL AND ${timerStates.lastSyncedFrom} <> ${input.source})`;
      const stillRunningGuard = sql`(COALESCE(${timerStates.isRunning}, false) AND NOT (${timerStates.lastSyncedFrom} IS NOT NULL AND ${timerStates.lastSyncedFrom} <> ${input.source}))`;
      const adoptionGuard = sql`COALESCE(${timerStates.isRunning}, false)`;
      const notClearedGuard = sql`(COALESCE(${timerStates.isRunning}, false) OR COALESCE(${timerStates.elapsedSeconds}, 0) > 0 OR COALESCE(${timerStates.baseSeconds}, 0) > 0)`;

      // A heartbeat/pause with no row at all has nothing to keep alive — the
      // upsert's insert path would CREATE a running/paused row out of thin air.
      if ((isHeartbeat || isPauseWrite) && !existing) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: isHeartbeat ? "heartbeat_rejected" : "pause_rejected",
          detail: { kind: writeKind, reason: "no_row" },
        });
        return {
          success: false,
          reason: isHeartbeat
            ? ("not_running" as const)
            : ("not_active" as const),
          version: 0,
        };
      }

      // KØET START (offline-kø, #703): strengere end en almindelig fresh
      // start. Den må kun lande på en række, der IKKE kører og ikke er midt i
      // et stop — også når den kørende timer har samme `source` (web og mobil
      // sender begge "web", og en anden fane/enhed kan have startet imens).
      // Og den må ikke være landet før (samme nøgle). Alt i samme atomiske
      // upsert som resten — aldrig read-then-write.
      // Review P2-1: et FORLADT stop (claim ældre end 60 s) af en session der
      // allerede er GEMT, blokerer ikke en ny start — dens tid ligger i
      // posten, så intet går tabt. Et forladt stop med ugemt tid blokerer
      // fortsat (oprydnings-cron'en parkerer det som pauset).
      const abandonedSavedStopSql = sql`(${timerStates.intent} = 'stopping' AND ${timerStates.intentAt} < ${toUtcSql(new Date(Date.now() - ABANDONED_STOP_MS))}::timestamp AND ${currentSessionSavedSql()})`;
      const queuedStartGuard = sql`(((NOT COALESCE(${timerStates.isRunning}, false) AND (${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')) OR ${abandonedSavedStopSql}) AND ${timerStates.lastClientOpId} IS DISTINCT FROM ${input.clientOpId ?? null})`;

      // GENOPSTANDELSE (kunde A 1/10): en start med en starttid fra FØR
      // rækken blev ryddet, er en forældet lokal kopi af en session der
      // allerede er stoppet og gemt — fx en web-fane der genindlæser sin
      // localStorage. Den må ikke genoplive rækken (gammel start + gammel
      // kunde → samme session gemt to gange). Se lib/timer/resurrection.ts.
      const noResurrectionGuard = noResurrectionGuardSql();

      // Et heartbeat må ikke omskrive en ANDEN session end klientens (en
      // forældet telefon der skifter projekt, ville ellers sætte en ny
      // web-sessions start og kunde tilbage). Web/extension: uændret.
      const sessionGuard = isHeartbeat
        ? heartbeatSessionGuardSql({
            expectedStartTime: input.expectedStartTime,
            legacyNativeApp: isLegacyNativeAppRequest(ctx.headers),
          })
        : undefined;
      // Versionstjekket (web, A5) og sessionstjekket (mobil, A7) er
      // uafhængige; hvert prædikat tilføjes kun når klienten sender det.
      const versionGuard =
        isHeartbeat && input.expectedVersion !== undefined
          ? eq(timerStates.version, input.expectedVersion)
          : undefined;
      const heartbeatGuard =
        and(stillRunningGuard, versionGuard, sessionGuard) ?? stillRunningGuard;

      const guardWhere = input.isRunning
        ? input.isAdoption
          ? adoptionGuard
          : isQueuedStart
            ? sql`(${queuedStartGuard}) AND (${noResurrectionGuard})`
            : isHeartbeat
              ? heartbeatGuard
              : sql`(${otherOwnerGuard}) AND (${noResurrectionGuard})`
        : isPauseWrite
          ? notClearedGuard
          : undefined;

      // Timer-sessioner (fase 1): hvad sker der med rækkens session, og lander
      // skrivningen kun på klientens session? Begge dele i SAMME upsert.
      const sessionMode = timerSyncSessionMode({
        isRunning: input.isRunning,
        isPauseWrite,
        isQueuedStart,
        isFreshStart: input.isFreshStart,
        isAdoption: input.isAdoption,
        baseSeconds: input.baseSeconds,
        hasSessionId: !!clientSessionId,
      });
      // En sessionsbevidst skrivning lander heller ikke midt i et stop af
      // sessionen — heller ikke fra samme kilde (en anden fane/enhed): så
      // ville sessionen sidst stå på én kunde, mens stoppet gemmer en anden
      // (#787 K6 for web). Ældre klienter: uændret.
      const sessionPredicate = clientSessionId
        ? sessionMode === "clear"
          ? sql`(${timerStates.currentSessionId} IS NULL OR ${sessionMatchSql(clientSessionId)})`
          : sql`${sessionMatchSql(clientSessionId)} AND (${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`
        : undefined;
      // Review P1: en ÆLDRE klients skrivning (uden sessionId) lander aldrig
      // på en session der allerede er gemt (post oprettet, confirm undervejs)
      // — den kunne ellers genoptage/parkere den gemte tid.
      const legacyPredicate =
        !clientSessionId && sessionMode !== "clear" && !isQueuedStart
          ? currentSessionNotSavedSql()
          : undefined;
      const setWhere =
        and(
          guardWhere ? sql`(${guardWhere})` : undefined,
          sessionPredicate,
          legacyPredicate,
        ) ?? undefined;
      const candidateSessionId = newSessionId();

      // Klippekort-valget (#422) hører til sessionen: en ny session (frisk
      // eller køet start) og en fuld nulstilling starter forfra på automatisk.
      // Heartbeats, pauser og adoption rører det ikke.
      const sessionData = writeResetsPrepaidChoice({ ...input, isQueuedStart })
        ? { ...timerData, ...CLEARED_PREPAID_CHOICE }
        : timerData;
      // En køet start kan afløse et forladt stop (P2-1): stop-intentet dør
      // med den gamle session.
      const writeData = isQueuedStart
        ? {
            ...sessionData,
            lastClientOpId: input.clientOpId,
            intent: null,
            intentAt: null,
            intentFrom: null,
          }
        : sessionData;
      // En sessionsbevidst adoption/pause med uændrede detaljer rører dem
      // ikke (kun ved opdatering — en ny række får klientens værdier).
      const keepDetails =
        !!input.keepDetails && !!clientSessionId && sessionMode !== "clear";
      const {
        projectId: _p,
        clientId: _c,
        taskId: _t,
        description: _d,
        ...updateWithoutDetails
      } = writeData;
      const updateData = keepDetails ? updateWithoutDetails : writeData;

      const row = await ctx.db.transaction(async (tx) => {
        const [written] = await tx
          .insert(timerStates)
          .values({
            userId,
            ...writeData,
            currentSessionId: sessionIdInsertValue(
              sessionMode,
              candidateSessionId,
            ),
            version: 1,
          })
          .onConflictDoUpdate({
            target: timerStates.userId,
            set: {
              ...updateData,
              currentSessionId: sessionIdSetSql(
                sessionMode,
                candidateSessionId,
              ),
              version: sql`${timerStates.version} + 1`,
            },
            ...(setWhere ? { setWhere } : {}),
          })
          .returning({
            version: timerStates.version,
            currentSessionId: timerStates.currentSessionId,
            isRunning: timerStates.isRunning,
            startTime: timerStates.startTime,
            baseSeconds: timerStates.baseSeconds,
            elapsedSeconds: timerStates.elapsedSeconds,
            intent: timerStates.intent,
            projectId: timerStates.projectId,
            clientId: timerStates.clientId,
            taskId: timerStates.taskId,
            description: timerStates.description,
          });
        if (!written) return written;
        if (sessionMode === "clear" || !written.currentSessionId) {
          await closeActiveSessions(tx, userId, "discarded");
        } else {
          const isNew = written.currentSessionId === candidateSessionId;
          await recordSession(tx, {
            userId,
            organizationId: ctx.orgId,
            sessionId: written.currentSessionId,
            status: sessionStatusForRow(written),
            startedAt: sessionStartFromRow(
              written,
              now,
              input.sessionStartTime,
            ),
            projectId: written.projectId,
            clientId: written.clientId,
            taskId: written.taskId,
            description: written.description,
            source: eventBase.source,
            clientHint: eventBase.clientHint,
            startOpId: isNew && isQueuedStart ? input.clientOpId : null,
            continuesEntryId: isNew ? input.continuesEntryId : null,
          });
        }
        return written;
      });

      if (!row && clientSessionId) {
        // Klassificér (læsning EFTER den atomiske skrivning): bærer rækken en
        // anden session, er klientens session afsluttet et andet sted — den
        // skal adoptere serverens tilstand, aldrig genoplive sin egen.
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          columns: {
            version: true,
            isRunning: true,
            currentSessionId: true,
            intent: true,
            intentFrom: true,
          },
        });
        if (
          sessionMode !== "clear" &&
          current?.intent === "stopping" &&
          current.currentSessionId === clientSessionId
        ) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "blocked_stopping",
            versionAfter: current.version,
            detail: {
              kind: writeKind,
              stoppedBy: current.intentFrom,
              sessionId: clientSessionId,
            },
          });
          return {
            success: false,
            reason: "stopping_in_progress",
            stoppedBy: current.intentFrom,
            version: current.version,
          };
        }
        const mismatch =
          sessionMode === "clear"
            ? current?.currentSessionId != null &&
              current.currentSessionId !== clientSessionId
            : current?.currentSessionId !== clientSessionId;
        if (mismatch) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event:
              isHeartbeat || input.isAdoption
                ? "heartbeat_rejected"
                : input.isRunning
                  ? "blocked_resurrection"
                  : "pause_rejected",
            versionAfter: current?.version ?? null,
            detail: {
              kind: writeKind,
              reason: SESSION_MISMATCH,
              sessionId: clientSessionId,
              currentSessionId: current?.currentSessionId ?? null,
            },
          });
          return {
            success: false,
            reason: SESSION_MISMATCH,
            sessionId: current?.currentSessionId ?? null,
            isRunning: !!current?.isRunning,
            version: current?.version ?? 0,
            // Startnøglen fandt ingen session (review P2-2)
            startNeverLanded: clientSessionId === NIL_SESSION_ID,
          };
        }
      }

      if (!row && !isQueuedStart && sessionMode !== "clear") {
        // Midt i et stop (også fra samme kilde, når sessionen er gemt): ikke
        // en fejl — klienten stopper sin lokale kopi og afstemmer.
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          columns: { intent: true, intentFrom: true, version: true },
        });
        if (current?.intent === "stopping") {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "blocked_stopping",
            versionAfter: current.version,
            detail: { kind: writeKind, stoppedBy: current.intentFrom },
          });
          return {
            success: false,
            reason: "stopping_in_progress",
            stoppedBy: current.intentFrom,
            version: current.version,
          };
        }
      }

      if (!row && isQueuedStart) {
        // Klassificér afvisningen (læsning EFTER den atomiske skrivning — den
        // afgør ikke selv nogen skrivning). En samtidig afspilning af samme
        // nøgle kan have vundet: så er det stadig én effekt.
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          with: {
            project: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
          },
        });
        if (isSameClientOp(current?.lastClientOpId, input.clientOpId)) {
          const raceSession = input.clientOpId
            ? await findSessionByStartOp(ctx.db, userId, input.clientOpId)
            : undefined;
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "start_deduplicated",
            versionAfter: current?.version ?? null,
            detail: {
              kind: writeKind,
              clientOpId: input.clientOpId,
              sessionId: raceSession?.id,
            },
          });
          return dedupedStart(current, raceSession);
        }
        // Rækken kører ikke og er ikke midt i et stop: kun genopstandelses-
        // guarden kan have afvist starten — sessionen er allerede gemt. Det
        // er IKKE en kørende timer et andet sted (offline-køen dropper den).
        if (!current?.isRunning && current?.intent !== "stopping") {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "blocked_resurrection",
            versionAfter: current?.version ?? null,
            detail: { kind: writeKind, clientOpId: input.clientOpId },
          });
          return {
            success: false,
            reason: "stale_start" as const,
            version: current?.version ?? 0,
          };
        }
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event:
            current?.intent === "stopping"
              ? "blocked_stopping"
              : "blocked_other_owner",
          versionAfter: current?.version ?? null,
          detail: {
            kind: writeKind,
            runningFrom: current?.lastSyncedFrom ?? null,
            stoppedBy:
              current?.intent === "stopping" ? current.intentFrom : undefined,
          },
        });
        return {
          success: false,
          reason: "already_running" as const,
          runningFrom: current?.lastSyncedFrom ?? null,
          runningStartTime: current?.startTime?.toISOString() ?? null,
          running: {
            projectId: current?.projectId ?? null,
            clientId: current?.clientId ?? null,
            description: current?.description ?? "",
            project: current?.project ?? null,
            client: current?.client ?? null,
          },
          version: current?.version ?? 0,
        };
      }

      if (!row && input.isAdoption) {
        // The timer we were adopting was stopped/paused before our takeover
        // landed. Tell the client to drop its local copy and reconcile.
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          columns: { version: true },
        });
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: "adopt_rejected",
          versionAfter: current?.version ?? existing?.version ?? null,
          detail: { kind: writeKind, reason: "adoption_stale" },
        });
        return {
          success: false,
          reason: "adoption_stale" as const,
          version: current?.version ?? existing?.version ?? 0,
        };
      }

      // Fresh start (ikke køet, ikke adoption): kan nu også afvises af
      // genopstandelses-guarden på en ryddet række.
      const isFreshStartWrite =
        input.isRunning && !input.isAdoption && !isQueuedStart && !isHeartbeat;

      if (!row && (isHeartbeat || isPauseWrite || isFreshStartWrite)) {
        // Blocked heartbeat/pause: the row was stopped/cleared under us (or a
        // running heartbeat found another owner). Tell the client to drop its
        // local state and reconcile — unless another client genuinely owns a
        // running timer, which falls through to the already_running response.
        // A blocked fresh start on a row that is NOT running can only be the
        // resurrection guard: same answer — the session was already saved
        // elsewhere, the client must drop its stale copy (web: resetTimer +
        // reconcile; mobil: "blocked").
        const current = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          columns: { version: true, isRunning: true, lastSyncedFrom: true },
        });
        if (
          isHeartbeat &&
          isHeartbeatVersionConflict({
            expectedVersion: input.expectedVersion,
            current: current ?? null,
            source: input.source,
          })
        ) {
          // Rækken kører stadig hos samme kilde, men er skrevet siden fanen
          // sidst så den. Intet er skrevet — klienten afstemmer i stedet.
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "version_conflict",
            versionAfter: current?.version ?? null,
            detail: {
              kind: writeKind,
              expectedVersion: input.expectedVersion ?? null,
            },
          });
          return {
            success: false,
            reason: "version_conflict" as const,
            version: current?.version ?? 0,
          };
        }
        if (!current?.isRunning) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: isFreshStartWrite
              ? "blocked_resurrection"
              : isPauseWrite
                ? "pause_rejected"
                : "heartbeat_rejected",
            versionAfter: current?.version ?? null,
            detail: {
              kind: writeKind,
              reason: isPauseWrite ? "not_active" : "not_running",
            },
          });
          return {
            success: false,
            reason: isPauseWrite
              ? ("not_active" as const)
              : ("not_running" as const),
            // Fresh start afvist af genopstandelses-guarden: samme svar som
            // før (ældre klienter nulstiller), men web kan vise hvorfor.
            staleStart: isFreshStartWrite,
            version: current?.version ?? 0,
          };
        }
        // Rækken kører, men bærer en ANDEN session end heartbeatets (mobil
        // med forældet tilstand): klienten skal droppe sin lokale kopi og
        // afstemme — samme svar som et stop et andet sted.
        if (
          isHeartbeat &&
          sessionGuard &&
          (current.lastSyncedFrom == null ||
            current.lastSyncedFrom === input.source)
        ) {
          await logTimerEvent(ctx.db, {
            ...eventBase,
            event: "heartbeat_rejected",
            versionAfter: current.version,
            detail: {
              kind: writeKind,
              reason: "session_mismatch",
              expectedStartTime: input.expectedStartTime,
            },
          });
          return {
            success: false,
            reason: "not_running" as const,
            sessionMismatch: true,
            version: current.version,
          };
        }
        // Row is running but owned elsewhere → fall through to already_running.
      }

      if (!row) {
        // The guard blocked the write: another client owns the running timer.
        // Relations are loaded lazily here (only on the rare conflict) so the
        // 30s heartbeat write above stays cheap. The blocked client reconciles
        // to the running timer and tells the user to stop it first.
        const running = await ctx.db.query.timerStates.findFirst({
          where: eq(timerStates.userId, userId),
          with: {
            project: { columns: { id: true, name: true } },
            client: { columns: { id: true, name: true } },
          },
        });
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: isHeartbeat ? "heartbeat_rejected" : "blocked_other_owner",
          versionAfter: running?.version ?? existing?.version ?? null,
          detail: {
            kind: writeKind,
            reason: "other_owner",
            runningFrom: running?.lastSyncedFrom ?? null,
          },
        });
        return {
          success: false,
          reason: "already_running" as const,
          runningFrom: running?.lastSyncedFrom ?? null,
          running: {
            projectId: running?.projectId ?? null,
            clientId: running?.clientId ?? null,
            description: running?.description ?? "",
            project: running?.project ?? null,
            client: running?.client ?? null,
          },
          version: running?.version ?? existing?.version ?? 0,
        };
      }

      const newVersion = row.version;

      // Vellykkede heartbeats uden ændring logges ikke (classify → null).
      const successEvent = input.isAdoption
        ? ("adopt" as const)
        : (classifyTimerWrite(existing, {
            isRunning: input.isRunning,
            startTime: timerData.startTime,
            elapsedSeconds: input.elapsedSeconds,
            baseSeconds: input.baseSeconds,
            projectId: input.projectId,
            clientId: input.clientId,
          }) ??
          (isFreshStartWrite || isQueuedStart ? ("start" as const) : null));
      if (successEvent) {
        await logTimerEvent(ctx.db, {
          ...eventBase,
          event: successEvent,
          versionBefore: existing ? newVersion - 1 : null,
          versionAfter: newVersion,
          detail: {
            kind: writeKind,
            clientOpId: input.clientOpId,
            sessionId: row.currentSessionId ?? undefined,
            prevProjectId:
              successEvent === "client_change"
                ? (existing?.projectId ?? null)
                : undefined,
            prevClientId:
              successEvent === "client_change"
                ? (existing?.clientId ?? null)
                : undefined,
            prevStartTime:
              successEvent === "time_change"
                ? (existing?.startTime?.toISOString() ?? null)
                : undefined,
            prevBaseSeconds:
              successEvent === "time_change"
                ? (existing?.baseSeconds ?? null)
                : undefined,
          },
        });
      }

      await publishTimerEvent(userId, ctx.orgId, {
        userId,
        type: "sync",
        isRunning: input.isRunning,
        projectId: row.projectId,
        clientId: row.clientId,
        taskId: row.taskId,
        description: row.description ?? "",
        version: newVersion,
      });

      return {
        success: true,
        syncedAt: now.toISOString(),
        version: newVersion,
        // Den session rækken nu bærer (ny ved start, uændret ellers)
        sessionId: row.currentSessionId ?? null,
        // Rækkens detaljer efter skrivningen — med keepDetails kan de være
        // nyere end klientens (et skift fra en anden fane/enhed)
        details: {
          projectId: row.projectId,
          clientId: row.clientId,
          taskId: row.taskId,
          description: row.description ?? "",
        },
      };
    }),

  // Clear server timer state (called when timer is reset/discarded)
  clear: protectedProcedure
    .input(
      z
        .object({
          source: z.enum(["web", "extension"]).optional().default("web"),
          // Mobil (A7 M1/S2): starttiden (ms) på den session klienten vil
          // kassere. Rydningen lander kun på netop den session — en anden
          // session (eller en pause), startet et andet sted, røres ikke.
          expectedStartTime: z.number().optional(),
          // Server-udstedt session (fase 1): ryd kun netop den (eller en
          // række der kørte før sessionerne fandtes).
          sessionId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const source = input?.source || "web";
      const expectedStartTime = input?.expectedStartTime;
      const sessionId = input?.sessionId;
      const now = new Date();

      const expectedStart = and(
        expectedStartTime !== undefined
          ? expectedStartSql(expectedStartTime)
          : undefined,
        sessionId
          ? sql`(${timerStates.currentSessionId} IS NULL OR ${sessionMatchSql(sessionId)})`
          : undefined,
      );

      // ATOMISK: den forventede session indgår i UPDATE'ens WHERE og
      // versionen tælles op i samme sætning — aldrig read-then-write.
      // CTE'en `prev` låser rækken (FOR UPDATE) og leverer de kasserede
      // værdier til hændelsesloggen via RETURNING. Sessionsprædikatet står
      // også i UPDATE'ens WHERE, fordi EvalPlanQual kun gen-tjekker den
      // (samme mønster som claimIdleStamp i lib/timer/idle-claim.ts).
      const prev = ctx.db.$with("prev").as(
        ctx.db
          .select({
            id: timerStates.id,
            version: timerStates.version,
            isRunning: timerStates.isRunning,
            startTime: timerStates.startTime,
            elapsedSeconds: timerStates.elapsedSeconds,
            baseSeconds: timerStates.baseSeconds,
            projectId: timerStates.projectId,
            clientId: timerStates.clientId,
            intent: timerStates.intent,
            currentSessionId: timerStates.currentSessionId,
          })
          .from(timerStates)
          .where(and(eq(timerStates.userId, userId), expectedStart))
          .for("update"),
      );
      const cleared = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .with(prev)
          .update(timerStates)
          .set({
            isRunning: false,
            startTime: null,
            elapsedSeconds: 0,
            baseSeconds: 0,
            projectId: null,
            clientId: null,
            description: "",
            intent: null,
            intentAt: null,
            intentFrom: null,
            ...CLEARED_PREPAID_CHOICE,
            currentSessionId: null,
            version: sql`${timerStates.version} + 1`,
            lastSyncedAt: now,
            lastSyncedFrom: source,
            isIdle: false,
            idleDetectedAt: null,
            updatedAt: now,
          })
          .from(prev)
          .where(and(eq(timerStates.id, prev.id), expectedStart))
          .returning({
            version: timerStates.version,
            prevVersion: prev.version,
            prevIsRunning: prev.isRunning,
            prevStartTime: prev.startTime,
            prevElapsedSeconds: prev.elapsedSeconds,
            prevBaseSeconds: prev.baseSeconds,
            prevProjectId: prev.projectId,
            prevClientId: prev.clientId,
            prevIntent: prev.intent,
            prevSessionId: prev.currentSessionId,
          });
        // Den kasserede session lukkes i samme transaktion
        if (row) await closeActiveSessions(tx, userId, "discarded");
        return row;
      });

      if (cleared) {
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: ctx.orgId,
          event: "clear",
          ...timerEventOrigin(ctx.headers, source),
          versionBefore: cleared.prevVersion,
          versionAfter: cleared.version,
          // Det der blev kasseret — så en "forsvundet" timer kan forklares.
          startTime: cleared.prevStartTime,
          baseSeconds: cleared.prevBaseSeconds,
          projectId: cleared.prevProjectId,
          clientId: cleared.prevClientId,
          detail: {
            wasRunning: !!cleared.prevIsRunning,
            elapsedSeconds: cleared.prevElapsedSeconds ?? 0,
            intent: cleared.prevIntent ?? undefined,
            expectedStartTime,
            sessionId: cleared.prevSessionId ?? undefined,
          },
        });

        await publishTimerEvent(userId, ctx.orgId, {
          userId,
          type: "cleared",
          isRunning: false,
          projectId: null,
          clientId: null,
          taskId: null,
          description: "",
          version: cleared.version,
        });

        return { success: true, version: cleared.version };
      }

      if (expectedStartTime === undefined && !sessionId) {
        // Ingen række: intet at rydde.
        return { success: true, version: 0 };
      }

      // Klassificér afvisningen (læsning EFTER den atomiske skrivning).
      const existing = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
      });
      if (!existing || isClearedTimerRow(existing)) {
        // Sessionen er allerede væk — kassationen har sin effekt.
        return { success: true, version: existing?.version ?? 0 };
      }
      return {
        success: false,
        reason: "session_mismatch" as const,
        version: existing.version,
        sessionId: existing.currentSessionId ?? null,
      };
    }),

  // Idle settings for the web app's inactivity alert. The threshold lives on
  // timer_states.idleThresholdMinutes and is shared with the extension (which
  // reads it via extension.getIdleSettings).
  getIdleSettings: protectedProcedure.query(async ({ ctx }) => {
    const timerState = await ctx.db.query.timerStates.findFirst({
      where: eq(timerStates.userId, ctx.session.user.id),
      columns: {
        idleThresholdMinutes: true,
        autoPauseAfterMinutes: true,
        isIdle: true,
        idleDetectedAt: true,
      },
    });

    return {
      idleThresholdMinutes: timerState?.idleThresholdMinutes || 5,
      // Hård auto-pause efter lang stilstand. null = slået fra. Findes rækken
      // ikke endnu, gælder schemaets default (120 min).
      autoPauseAfterMinutes: timerState
        ? (timerState.autoPauseAfterMinutes ?? null)
        : 120,
      isCurrentlyIdle: timerState?.isIdle || false,
      idleDetectedAt: timerState?.idleDetectedAt?.toISOString() || null,
    };
  }),

  updateIdleThreshold: protectedProcedure
    .input(
      z.object({
        thresholdMinutes: z.number().int().min(1).max(60),
        // Hård auto-pause efter lang stilstand. null = slået fra. Udelades
        // feltet, røres indstillingen ikke.
        autoPauseAfterMinutes: z
          .number()
          .int()
          .min(15)
          .max(1440)
          .nullable()
          .optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const touchesAutoPause = input.autoPauseAfterMinutes !== undefined;
      const autoPauseValue = input.autoPauseAfterMinutes ?? null;

      // Svaret skal ekko den GEMTE række, ikke inputtet: udelades
      // autoPauseAfterMinutes, rører vi ikke indstillingen — og må derfor
      // heller ikke rapportere den som "fra".
      const [saved] = await ctx.db
        .insert(timerStates)
        .values({
          userId,
          idleThresholdMinutes: input.thresholdMinutes,
          ...(touchesAutoPause
            ? { autoPauseAfterMinutes: autoPauseValue }
            : {}),
        })
        .onConflictDoUpdate({
          target: timerStates.userId,
          set: {
            idleThresholdMinutes: input.thresholdMinutes,
            ...(touchesAutoPause
              ? { autoPauseAfterMinutes: autoPauseValue }
              : {}),
            updatedAt: new Date(),
          },
        })
        .returning({
          idleThresholdMinutes: timerStates.idleThresholdMinutes,
          autoPauseAfterMinutes: timerStates.autoPauseAfterMinutes,
        });

      return {
        success: true,
        thresholdMinutes: saved?.idleThresholdMinutes ?? input.thresholdMinutes,
        autoPauseAfterMinutes: saved?.autoPauseAfterMinutes ?? null,
      };
    }),

  // Persist idle transitions from the web app (mirrors
  // extension.reportIdleState).
  //
  // Inaktivitet pauser IKKE længere timeren (#588). Den FØRSTE detektor —
  // web eller extension — der ser inaktivitet stempler `idleDetectedAt`; en
  // senere detektor må ikke overskrive stemplet, ellers krymper det målte
  // fravær. Ved tilbagekomst KLIPPER den første klient stemplet ud (atomisk
  // UPDATE ... RETURNING på det GAMLE felt), så den anden klient ikke
  // spørger om det samme fravær én gang til.
  reportIdle: protectedProcedure
    .input(
      z.object({
        isIdle: z.boolean(),
        // Client-observed run-state at idle-detection. The client's own state
        // push and this call race each other, so the row's isRunning may lag —
        // without this flag the idle notification would be skipped.
        wasRunning: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const now = new Date();

      if (!input.isIdle) {
        // Tilbage ved tasterne: klip stemplet ud atomisk. Vinderen af
        // kapløbet får tidspunktet, taberen får null og spørger derfor ikke.
        const claimedAt = await claimIdleStamp(ctx.db, userId);
        if (claimedAt) {
          await logTimerEvent(ctx.db, {
            userId,
            organizationId: ctx.orgId,
            event: "idle_claim",
            ...timerEventOrigin(ctx.headers, "web"),
            detail: { idleDetectedAt: claimedAt.toISOString() },
          });
        }

        return {
          success: true,
          action: "activity_detected" as const,
          idleDetectedAt: claimedAt ? claimedAt.toISOString() : null,
        };
      }

      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        columns: {
          id: true,
          isRunning: true,
          isIdle: true,
          elapsedSeconds: true,
        },
      });

      if (!timerState) {
        return {
          success: true,
          action: "none" as const,
          idleDetectedAt: null,
        };
      }

      const wasRunning = timerState.isRunning || input.wasRunning === true;

      // Første detektor vinder stemplet; senere detektorer rører det ikke.
      const stampedAt = await stampIdle(ctx.db, userId);
      if (!timerState.isIdle) {
        await logTimerEvent(ctx.db, {
          userId,
          organizationId: ctx.orgId,
          event: "idle_stamp",
          ...timerEventOrigin(ctx.headers, "web"),
          detail: {
            idleDetectedAt: stampedAt?.toISOString() ?? null,
            wasRunning,
          },
        });
      }

      if (wasRunning && !timerState.isIdle) {
        const elapsedMinutes = Math.round(
          (timerState.elapsedSeconds || 0) / 60,
        );
        sendNotification({
          type: "idle_detected",
          userId,
          i18n: {
            key: "idleDetected",
            values: { minutes: elapsedMinutes },
          },
          url: `${getAppUrl()}/dashboard/time`,
        }).catch((err) => {
          console.error("Failed to send idle notification:", err);
        });
      }

      return {
        success: true,
        action: "idle_detected" as const,
        idleDetectedAt: (stampedAt ?? now).toISOString(),
      };
    }),

  // Check if server has newer timer state (for recovery on page load)
  checkRecovery: protectedProcedure
    .input(
      z.object({
        localLastSync: z.string().nullable(), // ISO timestamp of last local sync
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const timerState = await ctx.db.query.timerStates.findFirst({
        where: eq(timerStates.userId, userId),
        with: {
          project: {
            columns: {
              id: true,
              name: true,
            },
          },
          client: {
            columns: {
              id: true,
              name: true,
            },
          },
        },
      });

      // No server state
      if (!timerState) {
        return {
          hasServerState: false,
          shouldRecover: false,
          serverState: null,
          version: 0,
          intent: null,
        };
      }

      // If timer is being stopped, don't offer recovery
      if (timerState.intent === "stopping") {
        return {
          hasServerState: true,
          shouldRecover: false,
          serverState: null,
          version: timerState.version,
          intent: timerState.intent,
          intentFrom: timerState.intentFrom,
        };
      }

      // Server timer is not running, no recovery needed
      if (!timerState.isRunning) {
        return {
          hasServerState: true,
          shouldRecover: false,
          serverState: null,
          version: timerState.version,
          intent: null,
        };
      }

      // Check if server state is newer
      const localLastSync = input.localLastSync
        ? new Date(input.localLastSync)
        : null;
      const serverLastSync = timerState.lastSyncedAt;

      // If local sync is missing or server is newer, offer recovery
      const shouldRecover =
        !localLastSync || (serverLastSync && serverLastSync > localLastSync);

      if (shouldRecover) {
        // Calculate current elapsed time
        let elapsedSeconds = timerState.elapsedSeconds || 0;
        if (timerState.startTime && timerState.isRunning) {
          const now = new Date();
          const sessionSeconds = Math.floor(
            (now.getTime() - timerState.startTime.getTime()) / 1000,
          );
          elapsedSeconds = (timerState.baseSeconds || 0) + sessionSeconds;
        }

        return {
          hasServerState: true,
          shouldRecover: true,
          serverState: {
            isRunning: timerState.isRunning,
            startTime: timerState.startTime?.getTime() || null,
            sessionStartTime: timerState.startTime?.getTime() || null,
            elapsedSeconds,
            baseSeconds: timerState.baseSeconds || 0,
            projectId: timerState.projectId,
            clientId: timerState.clientId,
            description: timerState.description || "",
            project: timerState.project,
            client: timerState.client,
            lastSyncedAt: timerState.lastSyncedAt?.toISOString() || null,
            lastSyncedFrom: timerState.lastSyncedFrom,
            version: timerState.version,
            sessionId: timerState.currentSessionId ?? null,
          },
          version: timerState.version,
          intent: null,
        };
      }

      return {
        hasServerState: true,
        shouldRecover: false,
        serverState: null,
        version: timerState.version,
        intent: null,
      };
    }),
});
