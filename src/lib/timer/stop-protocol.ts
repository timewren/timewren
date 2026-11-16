import { and, eq, sql } from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { timerStates } from "@/lib/db/schema";
import { publishTimerEvent } from "@/lib/realtime";
import { classifyClaimMiss, hasSomethingToStopSql } from "./claim";
import { logTimerEvent, timerEventOrigin } from "./events";
import {
  CLEARED_PREPAID_CHOICE,
  prepaidChoiceReturning,
  readReturnedPrepaidChoice,
} from "./prepaid-choice";
import { expectedStartSql } from "./session-match";
import {
  closeActiveSessions,
  currentSessionSavedSql,
  findOwnSession,
  NIL_SESSION_ID,
  newSessionId,
  recordSession,
  SESSION_MISMATCH,
  sessionIdSetSql,
  sessionMatchSql,
  sessionStartFromRow,
  setSessionStatus,
} from "./sessions";

/**
 * Stop-protokollen (claim → gem → confirm, eller cancel) — fælles for
 * `timerSync` (web/mobil) og `extension`, så sessionsreglerne kun står ét
 * sted. Alle skrivninger til timer_states er atomiske (prædikater i WHERE);
 * læsningerne bagefter klassificerer kun et udfald.
 *
 * `sessionId` (valgfrit, timer-sessioner fase 1): stop netop denne session.
 * Uden det opfører alt sig som før (ældre klienter).
 */

type Db = typeof dbType;
type Source = "web" | "extension";

interface Common {
  userId: string;
  orgId: string | null;
  headers: Pick<Headers, "get"> | null | undefined;
  source: Source;
  sessionId?: string;
}

/** Fælles stoplogik: rækken ryddes som ved confirmStop. */
function clearedRowSet(now: Date, source: Source) {
  return {
    isRunning: false,
    startTime: null,
    elapsedSeconds: 0,
    baseSeconds: 0,
    projectId: null,
    clientId: null,
    taskId: null,
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
  };
}

export async function claimStop(
  db: Db,
  input: Common & { expectedVersion: number; expectedStartTime?: number },
) {
  const { userId, orgId, source } = input;
  const now = new Date();
  const candidate = newSessionId();
  const origin = timerEventOrigin(input.headers, source);

  // ATOMIC claim: version + intent (+ session) er prædikater i UPDATE'en —
  // to klienter der stopper samtidig, kan aldrig begge vinde. En række der
  // kørte før sessionerne fandtes, får sit id her (dovent).
  const claimed = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(timerStates)
      .set({
        intent: "stopping",
        intentAt: now,
        intentFrom: source,
        currentSessionId: sessionIdSetSql("keep", candidate),
        version: sql`${timerStates.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(timerStates.userId, userId),
          eq(timerStates.version, input.expectedVersion),
          sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`,
          // Der skal være noget at stoppe: en RYDDET række er allerede
          // stoppet+gemt et andet sted (kunde A 1/10).
          hasSomethingToStopSql(),
          input.expectedStartTime !== undefined
            ? expectedStartSql(input.expectedStartTime)
            : undefined,
          input.sessionId ? sessionMatchSql(input.sessionId) : undefined,
        ),
      )
      .returning({
        version: timerStates.version,
        isRunning: timerStates.isRunning,
        startTime: timerStates.startTime,
        baseSeconds: timerStates.baseSeconds,
        projectId: timerStates.projectId,
        clientId: timerStates.clientId,
        taskId: timerStates.taskId,
        description: timerStates.description,
        currentSessionId: timerStates.currentSessionId,
        // Klippekort-valget der gælder for dette stop (#422)
        ...prepaidChoiceReturning,
      });
    if (row?.currentSessionId) {
      await recordSession(tx, {
        userId,
        organizationId: orgId,
        sessionId: row.currentSessionId,
        status: "stopping",
        startedAt: sessionStartFromRow(row, now),
        projectId: row.projectId,
        clientId: row.clientId,
        taskId: row.taskId,
        description: row.description,
        source: origin.source,
        clientHint: origin.clientHint,
      });
    }
    return row;
  });

  if (!claimed) {
    const existing = await db.query.timerStates.findFirst({
      where: eq(timerStates.userId, userId),
    });
    const miss = classifyClaimMiss(
      existing,
      input.expectedStartTime,
      input.sessionId,
    );
    await logTimerEvent(db, {
      userId,
      organizationId: orgId,
      event: "claim_rejected",
      ...origin,
      versionAfter: miss.version,
      detail: {
        reason: miss.reason,
        expectedVersion: input.expectedVersion,
        expectedStartTime: input.expectedStartTime,
        sessionId: input.sessionId,
        currentSessionId: existing?.currentSessionId ?? undefined,
        stoppedBy:
          miss.reason === "already_stopping" ? miss.stoppedBy : undefined,
      },
    });
    return {
      success: false as const,
      reason: miss.reason,
      version: miss.version,
      sessionId: existing?.currentSessionId ?? null,
      // Startnøglen fandt ingen session: starten nåede aldrig serveren, og
      // klientens lokale tid findes kun hos klienten (review P2-2)
      startNeverLanded: input.sessionId === NIL_SESSION_ID,
      stoppedBy:
        miss.reason === "already_stopping" ? miss.stoppedBy : undefined,
    };
  }

  const sessionId = claimed.currentSessionId;
  const session = sessionId
    ? await findOwnSession(db, userId, sessionId)
    : undefined;

  await logTimerEvent(db, {
    userId,
    organizationId: orgId,
    event: "claim_stop",
    ...origin,
    versionBefore: input.expectedVersion,
    versionAfter: claimed.version,
    projectId: claimed.projectId,
    clientId: claimed.clientId,
    detail: { sessionId: sessionId ?? undefined },
  });

  await publishTimerEvent(userId, orgId, {
    userId,
    type: "stopping",
    isRunning: claimed.isRunning ?? false,
    projectId: claimed.projectId,
    clientId: claimed.clientId,
    taskId: claimed.taskId,
    description: claimed.description ?? "",
    version: claimed.version,
  });

  return {
    success: true as const,
    version: claimed.version,
    prepaidChoice: readReturnedPrepaidChoice(claimed),
    sessionId,
    // Sessionens øjebliksbillede i stop-øjeblikket (#785): klienten gemmer
    // posten ud fra DETTE, ikke ud fra sin lokale (evt. forældede) kopi.
    session: {
      id: sessionId,
      projectId: claimed.projectId,
      clientId: claimed.clientId,
      taskId: claimed.taskId,
      description: claimed.description ?? "",
      startedAt: (
        session?.startedAt ?? sessionStartFromRow(claimed, now)
      ).toISOString(),
    },
  };
}

export async function confirmStop(db: Db, input: Common & { version: number }) {
  const { userId, orgId, source } = input;
  const now = new Date();
  const origin = timerEventOrigin(input.headers, source);

  // ATOMIC confirm: intent, ejer, version (og session) i WHERE. En gensendt
  // confirm (tabt svar) kan aldrig rydde en NYERE session.
  const cleared = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(timerStates)
      .set(clearedRowSet(now, source))
      .where(
        and(
          eq(timerStates.userId, userId),
          eq(timerStates.intent, "stopping"),
          eq(timerStates.intentFrom, source),
          eq(timerStates.version, input.version),
          input.sessionId ? sessionMatchSql(input.sessionId) : undefined,
        ),
      )
      .returning({ version: timerStates.version });
    // Den aktive session er nu gemt (en ældre klient har gemt posten uden id;
    // med id er den allerede sat til saved af posten).
    if (row) await closeActiveSessions(tx, userId, "saved");
    return row;
  });

  if (!cleared) {
    const existing = await db.query.timerStates.findFirst({
      where: eq(timerStates.userId, userId),
      columns: {
        intent: true,
        intentFrom: true,
        version: true,
        currentSessionId: true,
      },
    });
    // Klientens session er allerede gemt med sin post, og rækken bærer den
    // ikke længere (ryddet eller afløst): stoppet ER gennemført — svar succes,
    // så klienten ikke efterlader noget hængende (review P1).
    if (input.sessionId && existing?.currentSessionId !== input.sessionId) {
      const own = await findOwnSession(db, userId, input.sessionId);
      if (own?.status === "saved") {
        await logTimerEvent(db, {
          userId,
          organizationId: orgId,
          event: "confirm_stop",
          ...origin,
          versionAfter: existing?.version ?? null,
          detail: { sessionId: input.sessionId, alreadyDone: true },
        });
        return {
          success: true as const,
          version: existing?.version ?? input.version,
          alreadyDone: true,
        };
      }
    }
    const reason = !existing
      ? "no_timer"
      : existing.intent !== "stopping"
        ? "not_stopping"
        : existing.intentFrom !== source
          ? "wrong_source"
          : input.sessionId && existing.currentSessionId !== input.sessionId
            ? SESSION_MISMATCH
            : "version_mismatch";
    await logTimerEvent(db, {
      userId,
      organizationId: orgId,
      event: "confirm_rejected",
      ...origin,
      versionAfter: existing?.version ?? null,
      detail: {
        reason,
        confirmVersion: input.version,
        sessionId: input.sessionId,
      },
    });
    if (reason === "version_mismatch") {
      // Vores eget stop venter stadig, men versionen er flyttet (fx en anden
      // fanes heartbeat). Giv den aktuelle version tilbage, så klienten
      // gentager confirm i stedet for at lade rækken hænge i "stopping".
      return {
        success: false as const,
        reason,
        version: existing?.version,
      };
    }
    return {
      success: false as const,
      reason,
      version: reason === SESSION_MISMATCH ? existing?.version : undefined,
    };
  }

  await logTimerEvent(db, {
    userId,
    organizationId: orgId,
    event: "confirm_stop",
    ...origin,
    versionBefore: input.version,
    versionAfter: cleared.version,
    detail: { sessionId: input.sessionId },
  });

  await publishTimerEvent(userId, orgId, {
    userId,
    type: "stopped",
    isRunning: false,
    projectId: null,
    clientId: null,
    taskId: null,
    description: "",
    version: cleared.version,
  });

  return { success: true as const, version: cleared.version };
}

export async function cancelStop(db: Db, input: Common & { version: number }) {
  const { userId, orgId, source } = input;
  const now = new Date();
  const origin = timerEventOrigin(input.headers, source);

  // ATOMISK annullering. Ny regel (#783): en session der ALLEREDE er gemt
  // (posten landede, svaret gik tabt) kan ikke annulleres — så ville den
  // køre videre og blive gemt igen.
  const cancelled = await db.transaction(async (tx) => {
    const [row] = await tx
      .update(timerStates)
      .set({
        intent: null,
        intentAt: null,
        intentFrom: null,
        version: sql`${timerStates.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(timerStates.userId, userId),
          eq(timerStates.intent, "stopping"),
          eq(timerStates.intentFrom, source),
          input.sessionId ? sessionMatchSql(input.sessionId) : undefined,
          sql`NOT ${currentSessionSavedSql()}`,
        ),
      )
      .returning({
        version: timerStates.version,
        isRunning: timerStates.isRunning,
        startTime: timerStates.startTime,
        baseSeconds: timerStates.baseSeconds,
        projectId: timerStates.projectId,
        clientId: timerStates.clientId,
        currentSessionId: timerStates.currentSessionId,
      });
    if (row?.currentSessionId) {
      await setSessionStatus(
        tx,
        userId,
        row.currentSessionId,
        row.isRunning ? "running" : "paused",
      );
    }
    return row;
  });

  if (cancelled) {
    await logTimerEvent(db, {
      userId,
      organizationId: orgId,
      event: "cancel_stop",
      ...origin,
      versionBefore: cancelled.version - 1,
      versionAfter: cancelled.version,
      startTime: cancelled.startTime,
      baseSeconds: cancelled.baseSeconds,
      projectId: cancelled.projectId,
      clientId: cancelled.clientId,
      detail: { sessionId: cancelled.currentSessionId ?? undefined },
    });
    return {
      success: true as const,
      version: cancelled.version,
      sessionId: cancelled.currentSessionId,
    };
  }

  // Klassificér (læsning EFTER den atomiske skrivning).
  const existing = await db.query.timerStates.findFirst({
    where: eq(timerStates.userId, userId),
  });
  const owned =
    existing?.intent === "stopping" && existing.intentFrom === source;
  const reason = !existing
    ? "no_timer"
    : !owned
      ? "not_owned"
      : input.sessionId && existing.currentSessionId !== input.sessionId
        ? SESSION_MISMATCH
        : "already_saved";

  if (reason === "already_saved" && existing?.currentSessionId) {
    // Sessionen er gemt, men stoppet blev aldrig bekræftet: fuldfør det i
    // stedet for at lade rækken hænge i "stopping" (som confirm, atomisk).
    const savedSessionId = existing.currentSessionId;
    const finished = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(timerStates)
        .set(clearedRowSet(now, source))
        .where(
          and(
            eq(timerStates.userId, userId),
            eq(timerStates.intent, "stopping"),
            eq(timerStates.intentFrom, source),
            sessionMatchSql(savedSessionId),
            currentSessionSavedSql(),
          ),
        )
        .returning({ version: timerStates.version });
      if (row) await closeActiveSessions(tx, userId, "saved");
      return row;
    });
    await logTimerEvent(db, {
      userId,
      organizationId: orgId,
      event: "cancel_rejected",
      ...origin,
      versionAfter: finished?.version ?? existing.version,
      detail: { reason, sessionId: savedSessionId, finished: !!finished },
    });
    if (finished) {
      await publishTimerEvent(userId, orgId, {
        userId,
        type: "stopped",
        isRunning: false,
        projectId: null,
        clientId: null,
        taskId: null,
        description: "",
        version: finished.version,
      });
    }
    return {
      success: false as const,
      reason,
      version: finished?.version ?? existing.version,
      sessionId: savedSessionId,
    };
  }

  await logTimerEvent(db, {
    userId,
    organizationId: orgId,
    event: "cancel_rejected",
    ...origin,
    versionAfter: existing?.version ?? null,
    detail: { reason, sessionId: input.sessionId },
  });
  return {
    success: false as const,
    reason,
    version: existing?.version,
    sessionId: existing?.currentSessionId ?? null,
  };
}
