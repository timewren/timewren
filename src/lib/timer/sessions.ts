import { randomUUID } from "node:crypto";
import {
  and,
  eq,
  gte,
  inArray,
  isNull,
  lte,
  ne,
  type SQL,
  sql,
} from "drizzle-orm";
import type { db as dbType } from "@/lib/db";
import { timeEntries, timerSessions, timerStates } from "@/lib/db/schema";
import { SAME_SESSION_START_TOLERANCE_MS } from "@/lib/time/same-session";

/**
 * Server-udstedte timer-sessioner (fase 1) — se
 * docs/architecture/timer-sessions.md.
 *
 * Regler:
 * - `timer_states.current_session_id` ændres KUN i samme atomiske skrivning
 *   som resten af rækken (SET-udtrykkene nedenfor). Aldrig read-then-write.
 * - Et `sessionId` fra klienten er et PRÆDIKAT i den atomiske skrivning
 *   (`sessionMatchSql`). Matcher det ikke, skrives intet.
 * - `timer_sessions` skrives i samme transaktion som `timer_states`, EFTER
 *   den (rækkelåsen på timer_states serialiserer alle sessionsskift for en
 *   bruger, så det partielle unikke indeks "én aktiv session" aldrig rammes).
 */

export const TIMER_SESSION_STATUSES = [
  "running",
  "paused",
  "stopping",
  "saved",
  "discarded",
] as const;
export type TimerSessionStatus = (typeof TIMER_SESSION_STATUSES)[number];

export const ACTIVE_SESSION_STATUSES = [
  "running",
  "paused",
  "stopping",
] as const;

/**
 * Kastes i en posts transaktion, når et samtidigt gem af samme session
 * vandt: hele transaktionen rulles tilbage, og kalderen returnerer vinderens
 * post (ingen dobbelt forlængelse/klippekort-træk).
 */
export class SessionAlreadySavedError extends Error {}

/** Et id der aldrig findes — prædikatet mod det matcher intet. */
export const NIL_SESSION_ID = "00000000-0000-0000-0000-000000000000";

/** Afvisningsgrunden klienterne håndterer ved at adoptere serverens tilstand. */
export const SESSION_MISMATCH = "session_mismatch" as const;

type Tx = Parameters<Parameters<typeof dbType.transaction>[0]>[0];
/** db ELLER en transaktion */
export type SessionDb = Pick<Tx, "insert" | "update" | "query">;
type Db = SessionDb;

export function newSessionId(): string {
  return randomUUID();
}

/** Prædikat: rækken bærer netop denne session. */
export function sessionMatchSql(sessionId: string): SQL {
  return sql`${timerStates.currentSessionId} = ${sessionId}::uuid`;
}

/**
 * Hvad sker der med `current_session_id` i en skrivning?
 * - `new`: ny session (frisk start uden tidligere tid, køet start, quickStart)
 * - `keep`: samme session; en ældre række uden id får `candidate` (dovent)
 * - `clear`: rækken ryddes — ingen session
 */
export type SessionWriteMode = "new" | "keep" | "clear";

/**
 * Sessionsskiftet for en skrivning (timerSync.sync og extension):
 * - ingen tid og kører ikke → `clear`
 * - klienten bærer et sessionId → `keep` (prædikatet afgør om det lander)
 * - køet start → `new`
 * - frisk start uden tidligere tid → `new`; med tid (genoptag af en pause
 *   fra en ældre klient) → `keep`
 * - heartbeat, pause, adoption, kundeskift → `keep`
 */
export function timerSyncSessionMode(w: {
  isRunning: boolean;
  isPauseWrite: boolean;
  isQueuedStart: boolean;
  isFreshStart: boolean;
  isAdoption: boolean;
  baseSeconds: number;
  hasSessionId: boolean;
}): SessionWriteMode {
  if (!w.isRunning && !w.isPauseWrite) return "clear";
  if (w.hasSessionId) return "keep";
  if (w.isQueuedStart) return "new";
  if (w.isRunning && w.isFreshStart && !w.isAdoption) {
    return w.baseSeconds > 0 ? "keep" : "new";
  }
  return "keep";
}

/** SET-udtryk for `current_session_id` i en UPDATE/upsert. */
export function sessionIdSetSql(
  mode: SessionWriteMode,
  candidate: string,
): SQL | null {
  if (mode === "clear") return null;
  if (mode === "new") return sql`${candidate}::uuid`;
  // Dovent id til en række uden session. En session der allerede er gemt/
  // kasseret, er aldrig den aktive: lever rækken videre (en ældre klient
  // skriver til den), får den et NYT id — så klienter med det gamle id får
  // session_mismatch i stedet for at skrive videre på en afsluttet session.
  // Midt i et stop skifter sessionen ALDRIG id — så kan stoppets confirm
  // (der bærer id'et) altid lande, også efter at posten har gjort den gemt.
  return sql`CASE WHEN ${timerStates.currentSessionId} IS NULL THEN ${candidate}::uuid WHEN ${timerStates.intent} = 'stopping' THEN ${timerStates.currentSessionId} WHEN EXISTS (SELECT 1 FROM ${timerSessions} WHERE ${timerSessions.id} = ${timerStates.currentSessionId} AND ${timerSessions.status} IN ('saved', 'discarded')) THEN ${candidate}::uuid ELSE ${timerStates.currentSessionId} END`;
}

/** Værdien ved INSERT (ingen række endnu). */
export function sessionIdInsertValue(
  mode: SessionWriteMode,
  candidate: string,
): string | null {
  return mode === "clear" ? null : candidate;
}

/** Sessionsstatus ud fra den skrevne række. */
export function sessionStatusForRow(row: {
  isRunning: boolean | null;
  elapsedSeconds: number | null;
  baseSeconds: number | null;
  intent?: string | null;
}): TimerSessionStatus {
  if (row.intent === "stopping") return "stopping";
  if (row.isRunning) return "running";
  return "paused";
}

/** Sessionens rigtige start ud fra en række (start minus akkumuleret tid). */
export function sessionStartFromRow(
  row: { startTime: Date | null; baseSeconds: number | null },
  fallback: Date,
  explicitStart?: number | null,
): Date {
  if (explicitStart && Number.isFinite(explicitStart)) {
    return new Date(explicitStart);
  }
  if (row.startTime) {
    return new Date(row.startTime.getTime() - (row.baseSeconds ?? 0) * 1000);
  }
  return new Date(fallback.getTime() - (row.baseSeconds ?? 0) * 1000);
}

export interface SessionSnapshot {
  userId: string;
  organizationId: string | null;
  sessionId: string;
  status: TimerSessionStatus;
  startedAt: Date;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string | null;
  source?: string | null;
  clientHint?: string | null;
  startOpId?: string | null;
  continuesEntryId?: string | null;
}

/**
 * Registrér den session rækken nu bærer: luk andre aktive sessioner for
 * brugeren (der er kun én timer), og indsæt/opdatér denne. En session der er
 * gemt/kasseret, genoplives ALDRIG (WHERE i ON CONFLICT).
 *
 * Kaldes i samme transaktion som skrivningen til timer_states, efter den.
 */
export async function recordSession(db: Db, s: SessionSnapshot): Promise<void> {
  const now = new Date();
  await db
    .update(timerSessions)
    .set({ status: "discarded", endedAt: now, updatedAt: now })
    .where(
      and(
        eq(timerSessions.userId, s.userId),
        sql`${timerSessions.status} IN ('running', 'paused', 'stopping')`,
        sql`${timerSessions.id} <> ${s.sessionId}::uuid`,
      ),
    );
  await db
    .insert(timerSessions)
    .values({
      id: s.sessionId,
      userId: s.userId,
      organizationId: s.organizationId,
      status: s.status,
      startedAt: s.startedAt,
      projectId: s.projectId,
      clientId: s.clientId,
      taskId: s.taskId,
      description: s.description ?? "",
      source: s.source ?? null,
      clientHint: s.clientHint ? s.clientHint.slice(0, 64) : null,
      startOpId: s.startOpId ?? null,
      continuesEntryId: s.continuesEntryId ?? null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: timerSessions.id,
      set: {
        status: s.status,
        projectId: s.projectId,
        clientId: s.clientId,
        taskId: s.taskId,
        description: s.description ?? "",
        version: sql`${timerSessions.version} + 1`,
        updatedAt: now,
      },
      setWhere: and(
        eq(timerSessions.userId, s.userId),
        sql`${timerSessions.status} NOT IN ('saved', 'discarded')`,
        // Et uændret heartbeat skriver ikke sessionsrækken (ingen
        // skriveforstærkning hvert 30. sekund)
        sql`(${timerSessions.status}, ${timerSessions.projectId}, ${timerSessions.clientId}, ${timerSessions.taskId}, ${timerSessions.description}) IS DISTINCT FROM (excluded.status, excluded.project_id, excluded.client_id, excluded.task_id, excluded.description)`,
      ),
    });
}

/**
 * Luk brugerens aktive session(er) — efter en skrivning der har ryddet
 * rækken (confirm → `saved`, rydning → `discarded`). Der er højst én.
 */
export async function closeActiveSessions(
  db: Db,
  userId: string,
  status: "saved" | "discarded",
): Promise<void> {
  const now = new Date();
  await db
    .update(timerSessions)
    .set({ status, endedAt: now, updatedAt: now })
    .where(
      and(
        eq(timerSessions.userId, userId),
        sql`${timerSessions.status} IN ('running', 'paused', 'stopping')`,
      ),
    );
}

/** Sæt én sessions status (fx `stopping` ved claim, aktiv igen ved cancel). */
export async function setSessionStatus(
  db: Db,
  userId: string,
  sessionId: string,
  status: TimerSessionStatus,
): Promise<void> {
  const now = new Date();
  await db
    .update(timerSessions)
    .set({
      status,
      updatedAt: now,
      version: sql`${timerSessions.version} + 1`,
    })
    .where(
      and(
        eq(timerSessions.id, sessionId),
        eq(timerSessions.userId, userId),
        sql`${timerSessions.status} NOT IN ('saved', 'discarded')`,
      ),
    );
}

/**
 * Posten for en ældre apps stop bygges på sessionens projekt/kunde/opgave
 * (#785) — ALTID, også når målet matcher, så en forældet kunde/opgave i
 * appens lokale kopi aldrig lander på posten. Med et projekt skal både
 * projektet og den EFFEKTIVE kunde matche (sessionens egen, ellers
 * projektets — CodeRabbit, PR #858: uden `projectClientId` bypassede en
 * session uden egen kunde tjekket helt, og appens klippekort/sats/
 * fakturerbar-valg kunne lande på en helt anden kunde end projektets).
 * Skiftede målet, hører de valg til den gamle kunde og droppes, så
 * serverens regler afgør dem.
 */
export function withLegacyStopTarget<
  T extends {
    projectId?: string;
    clientId?: string;
    taskId?: string;
    prepaidPackageId?: string;
    prepaidHoursOverride?: number;
    billableRate?: string;
    isBillable?: boolean;
  },
>(
  input: T,
  session: {
    sessionId: string;
    projectId: string | null;
    clientId: string | null;
    taskId: string | null;
    /** Projektets kunde — bruges kun når sessionen ikke selv har en. */
    projectClientId?: string | null;
  },
): T & { timerSessionId: string } {
  // Et projekt kan være flyttet til en anden kunde, mens appen kørte: så
  // hører appens faktureringsvalg til den gamle kunde (CodeRabbit, PR #858).
  const effectiveClientId = session.clientId ?? session.projectClientId ?? null;
  const sameTarget = session.projectId
    ? input.projectId === session.projectId &&
      input.clientId === (effectiveClientId ?? undefined)
    : input.clientId === (session.clientId ?? undefined);
  // Projekt, kunde og opgave følger ALTID sessionen — appens kopi kan være
  // forældet selv når målet matcher (CodeRabbit, PR #858): en kunde eller
  // opgave der ikke længere hører til projektet, ville ellers lande på
  // posten uændret.
  const target = {
    projectId: session.projectId ?? undefined,
    clientId: session.clientId ?? undefined,
    taskId: session.taskId ?? undefined,
  };
  if (sameTarget)
    return { ...input, ...target, timerSessionId: session.sessionId };
  return {
    ...input,
    ...target,
    timerSessionId: session.sessionId,
    prepaidPackageId: undefined,
    prepaidHoursOverride: undefined,
    billableRate: undefined,
    isBillable: undefined,
  };
}

/** Brugerens session (eller undefined — et fremmed/ukendt id ignoreres). */
export async function findOwnSession(
  db: Pick<typeof dbType, "query">,
  userId: string,
  sessionId: string,
) {
  return db.query.timerSessions.findFirst({
    where: and(
      eq(timerSessions.id, sessionId),
      eq(timerSessions.userId, userId),
    ),
  });
}

/** Sessionen en køet/gentaget start (samme opId) oprettede. */
export async function findSessionByStartOp(
  db: Pick<typeof dbType, "query">,
  userId: string,
  startOpId: string,
) {
  return db.query.timerSessions.findFirst({
    where: and(
      eq(timerSessions.userId, userId),
      eq(timerSessions.startOpId, startOpId),
    ),
    columns: { id: true, status: true, startedAt: true },
  });
}

/**
 * Den session en ældre app (build ≤ 5) gemmer, når den gemmer sit stop UDEN
 * timerSessionId: rækken står i `stopping` på en ugemt session, og posten
 * starter hvor rækken (eller sessionen) startede (±2 s). Appen bygger posten
 * ud fra sin lokale tilstand, så serveren bruger sessionens øjebliksbillede
 * fra claimet (#785) og gemmer posten MED sessionen, så et cancelStop efter
 * et tabt svar afvises som `already_saved` (#783). Ingen match → undefined.
 */
export async function findStoppingSessionForLegacySave(
  db: Pick<typeof dbType, "query">,
  userId: string,
  entryStart: Date,
) {
  const row = await db.query.timerStates.findFirst({
    where: and(
      eq(timerStates.userId, userId),
      eq(timerStates.intent, "stopping"),
      // Et stop extensionen har claimet, gemmer extensionen selv
      ne(timerStates.intentFrom, "extension"),
    ),
    columns: {
      currentSessionId: true,
      startTime: true,
      baseSeconds: true,
      projectId: true,
      clientId: true,
      taskId: true,
    },
  });
  if (!row?.currentSessionId || !row.startTime) return undefined;
  const starts = [
    row.startTime.getTime(),
    sessionStartFromRow(row, row.startTime).getTime(),
  ];
  if (
    !starts.some(
      (s) =>
        Math.abs(s - entryStart.getTime()) <= SAME_SESSION_START_TOLERANCE_MS,
    )
  ) {
    return undefined;
  }
  const session = await findOwnSession(db, userId, row.currentSessionId);
  if (session?.status !== "stopping" || session.savedEntryId) return undefined;
  return {
    sessionId: session.id,
    projectId: row.projectId,
    clientId: row.clientId,
    taskId: row.taskId,
  };
}

/**
 * Markér sessionen gemt med posten — i SAMME transaktion som posten.
 * Kun hvis den ikke allerede er gemt med en anden post.
 *
 * `requireStatus` (CodeRabbit, PR #858): et ekstra atomisk prædikat for den
 * ældre apps stop-gem, der er claimet FØR transaktionen (findStoppingSession-
 * ForLegacySave). Når en cancelStop når at genoptage timeren i mellemtiden,
 * står sessionen ikke længere i `stopping`, og WHERE rammer intet — hele
 * transaktionen ruller tilbage (kalderen kaster SessionAlreadySavedError), så
 * den genoptagne session aldrig fejlagtigt markeres gemt. Andre kaldere (der
 * ikke går via claim/stopping) sender den ikke.
 */
export async function markSessionSaved(
  db: Db,
  userId: string,
  sessionId: string,
  entryId: string,
  requireStatus?: TimerSessionStatus,
): Promise<boolean> {
  const now = new Date();
  const rows = await db
    .update(timerSessions)
    .set({
      status: "saved",
      savedEntryId: entryId,
      endedAt: sql`COALESCE(${timerSessions.endedAt}, ${now.toISOString()}::timestamptz)`,
      updatedAt: now,
      version: sql`${timerSessions.version} + 1`,
    })
    .where(
      and(
        eq(timerSessions.id, sessionId),
        eq(timerSessions.userId, userId),
        sql`${timerSessions.savedEntryId} IS NULL`,
        requireStatus ? eq(timerSessions.status, requireStatus) : undefined,
      ),
    )
    .returning({ id: timerSessions.id });
  return rows.length > 0;
}

/**
 * Efter en session er gemt UDEN for stop-protokollen (fx gem-dialogen efter
 * at oprydnings-cron'en har parkeret claimet som pauset): bærer rækken stadig
 * sessionen, er dens tid nu gemt. En pauset rest ryddes (den ER posten); en
 * række der er genoptaget, får et nyt sessionId, så ingen skriver videre på
 * den gemte session. Under et igangværende stop røres intet — confirm
 * rydder. Samme transaktion som posten.
 */
export async function settleRowForSavedSession(
  db: Db,
  args: {
    userId: string;
    organizationId: string | null;
    sessionId: string;
    /**
     * quickStop (review P3): den stoppede tid. En pauset rest ryddes kun,
     * når den er præcis den tid, posten gemmer; har et quick-add lagt
     * minutter til imens, bliver de stående som en ny pauset session.
     */
    expectedElapsedSeconds?: number;
  },
): Promise<void> {
  const now = new Date();
  const notStopping = sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`;
  await db
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
      prepaidChoice: null,
      prepaidPackageId: null,
      prepaidChoiceClientId: null,
      isIdle: false,
      idleDetectedAt: null,
      currentSessionId: null,
      version: sql`${timerStates.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(timerStates.userId, args.userId),
        sessionMatchSql(args.sessionId),
        sql`NOT COALESCE(${timerStates.isRunning}, false)`,
        notStopping,
        args.expectedElapsedSeconds !== undefined
          ? sql`COALESCE(${timerStates.elapsedSeconds}, 0) = ${args.expectedElapsedSeconds}`
          : undefined,
      ),
    );
  const fresh = newSessionId();
  if (args.expectedElapsedSeconds !== undefined) {
    // Resten efter den gemte tid (et quick-add der landede imens) bliver
    // stående som en ny pauset session — aldrig den gemte tid igen.
    const saved = args.expectedElapsedSeconds;
    const [rest] = await db
      .update(timerStates)
      .set({
        elapsedSeconds: sql`GREATEST(COALESCE(${timerStates.elapsedSeconds}, 0) - ${saved}, 0)`,
        baseSeconds: sql`GREATEST(COALESCE(${timerStates.elapsedSeconds}, 0) - ${saved}, 0)`,
        currentSessionId: sql`${fresh}::uuid`,
        version: sql`${timerStates.version} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(timerStates.userId, args.userId),
          sessionMatchSql(args.sessionId),
          sql`NOT COALESCE(${timerStates.isRunning}, false)`,
          notStopping,
        ),
      )
      .returning({
        elapsedSeconds: timerStates.elapsedSeconds,
        projectId: timerStates.projectId,
        clientId: timerStates.clientId,
        taskId: timerStates.taskId,
        description: timerStates.description,
      });
    if (rest) {
      await recordSession(db, {
        userId: args.userId,
        organizationId: args.organizationId,
        sessionId: fresh,
        status: "paused",
        startedAt: new Date(now.getTime() - (rest.elapsedSeconds ?? 0) * 1000),
        projectId: rest.projectId,
        clientId: rest.clientId,
        taskId: rest.taskId,
        description: rest.description,
        source: "server",
      });
    }
  }
  const [resumed] = await db
    .update(timerStates)
    .set({
      currentSessionId: sql`${fresh}::uuid`,
      version: sql`${timerStates.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        eq(timerStates.userId, args.userId),
        sessionMatchSql(args.sessionId),
        sql`COALESCE(${timerStates.isRunning}, false)`,
        notStopping,
      ),
    )
    .returning({
      isRunning: timerStates.isRunning,
      startTime: timerStates.startTime,
      baseSeconds: timerStates.baseSeconds,
      projectId: timerStates.projectId,
      clientId: timerStates.clientId,
      taskId: timerStates.taskId,
      description: timerStates.description,
    });
  if (resumed) {
    await recordSession(db, {
      userId: args.userId,
      organizationId: args.organizationId,
      sessionId: fresh,
      status: "running",
      startedAt: sessionStartFromRow(resumed, now),
      projectId: resumed.projectId,
      clientId: resumed.clientId,
      taskId: resumed.taskId,
      description: resumed.description,
      source: "server",
    });
  }
}

/**
 * Gem en session med dens post (i postens transaktion): først rækken, så
 * sessionen — samme låserækkefølge som alle andre timer-skrivninger
 * (timer_states før timer_sessions), så to transaktioner aldrig venter på
 * hinanden i ring. Returnerer false, hvis sessionen allerede var gemt med en
 * anden post (kalderen ruller tilbage eller returnerer den eksisterende).
 */
export async function saveSessionEntry(
  db: Db,
  args: {
    userId: string;
    organizationId: string | null;
    sessionId: string;
    entryId: string;
    /** quickStop: den stoppede tid (se settleRowForSavedSession) */
    expectedElapsedSeconds?: number;
    /** Se markSessionSaved — kun den ældre apps legacy-stop sender denne. */
    requireStatus?: TimerSessionStatus;
  },
): Promise<boolean> {
  await settleRowForSavedSession(db, args);
  return markSessionSaved(
    db,
    args.userId,
    args.sessionId,
    args.entryId,
    args.requireStatus,
  );
}

/**
 * Prædikat for en ÆLDRE klients skrivning (uden sessionId), der holder en
 * session i live eller ændrer den: rækkens session må ikke være gemt. En gemt
 * session — posten er oprettet, confirm er undervejs — må ikke genoptages,
 * pauses eller få nyt id; så ville den gemte tid kunne gemmes igen (review P1).
 */
export function currentSessionNotSavedSql(): SQL {
  return sql`NOT ${currentSessionSavedSql()}`;
}

/**
 * Oprydning (review P3): en række der IKKE kører og ikke er midt i et stop,
 * men stadig bærer en GEMT session, er en rest af en session hvis tid ligger
 * i posten — fx et quickStop hvis nulstilling tabte et kapløb. Den blokerer
 * ældre klienters starter (de lander aldrig på en gemt session) og ryddes
 * ikke af nogen anden regel. Én atomisk UPDATE med prædikaterne i WHERE.
 */
export async function clearRowsWithSavedSession(
  db: Pick<Tx, "update">,
  now: Date = new Date(),
): Promise<Array<{ userId: string; version: number }>> {
  return db
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
      prepaidChoice: null,
      prepaidPackageId: null,
      prepaidChoiceClientId: null,
      currentSessionId: null,
      version: sql`${timerStates.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        sql`NOT COALESCE(${timerStates.isRunning}, false)`,
        sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`,
        currentSessionSavedSql(),
      ),
    )
    .returning({
      userId: timerStates.userId,
      version: timerStates.version,
    });
}

/** En tom pauset række skal have stået så længe, før oprydningen rører den. */
export const EMPTY_PAUSED_ROW_GRACE_MINUTES = 10;

/**
 * Oprydning (review P3): quickStops nulstilling efterlader en pauset række
 * med 0 sekunder og en ny session, når rækkens tid faldt UNDER den stoppede
 * tid imens (resten bliver GREATEST(…, 0) = 0). Der er ingen ugemt tid —
 * ryd rækken og kassér den forældreløse pausede session. Kun rækker der ikke
 * kører, ikke er midt i et stop, har 0 sekunder, bærer en session og ikke er
 * rørt i EMPTY_PAUSED_ROW_GRACE_MINUTES (så et øjebliks pause→genoptag ikke
 * rammes). Én atomisk UPDATE med prædikaterne i WHERE; sessionerne derefter
 * (samme låserækkefølge: timer_states før timer_sessions).
 */
export async function clearEmptyPausedRows(
  db: Pick<Tx, "update">,
  now: Date = new Date(),
): Promise<Array<{ userId: string; version: number }>> {
  const cutoff = new Date(
    now.getTime() - EMPTY_PAUSED_ROW_GRACE_MINUTES * 60_000,
  );
  const cleared = await db
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
      prepaidChoice: null,
      prepaidPackageId: null,
      prepaidChoiceClientId: null,
      currentSessionId: null,
      version: sql`${timerStates.version} + 1`,
      updatedAt: now,
    })
    .where(
      and(
        sql`NOT COALESCE(${timerStates.isRunning}, false)`,
        sql`(${timerStates.intent} IS NULL OR ${timerStates.intent} <> 'stopping')`,
        sql`${timerStates.currentSessionId} IS NOT NULL`,
        sql`COALESCE(${timerStates.elapsedSeconds}, 0) = 0`,
        sql`COALESCE(${timerStates.baseSeconds}, 0) = 0`,
        lte(timerStates.updatedAt, cutoff),
      ),
    )
    .returning({
      userId: timerStates.userId,
      version: timerStates.version,
    });
  if (cleared.length > 0) {
    // En pauset session som ingen række bærer, kan aldrig genoptages
    await db
      .update(timerSessions)
      .set({
        status: "discarded",
        endedAt: sql`COALESCE(${timerSessions.endedAt}, ${now.toISOString()}::timestamptz)`,
        updatedAt: now,
        version: sql`${timerSessions.version} + 1`,
      })
      .where(
        and(
          inArray(
            timerSessions.userId,
            cleared.map((r) => r.userId),
          ),
          eq(timerSessions.status, "paused"),
          sql`NOT EXISTS (SELECT 1 FROM ${timerStates} WHERE ${timerStates.userId} = ${timerSessions.userId} AND ${timerStates.currentSessionId} = ${timerSessions.id})`,
        ),
      );
  }
  return cleared;
}

/** Prædikat: rækkens session er gemt (bruges af cancelStop og oprydning). */
export function currentSessionSavedSql(): SQL {
  return sql`EXISTS (SELECT 1 FROM ${timerSessions} WHERE ${timerSessions.id} = ${timerStates.currentSessionId} AND ${timerSessions.status} = 'saved')`;
}

/** Kilder en timer-post fra en ældre klient kan have (extension, quickStop). */
const LEGACY_TIMER_SOURCES = ["auto_track", "timer"] as const;
/** Posten skal slutte højst så langt fra stoppet (ur-skævhed + confirm). */
const LEGACY_MATCH_END_MS = 2 * 60_000;
/** … og have samme varighed som det sene gem (± ca. 1 min). */
const LEGACY_MATCH_HOURS = 0.02;

/**
 * En session der er `saved` UDEN post-id, er gemt af en ældre klient (uden
 * timerSessionId) — confirmStop lukkede den. Find den post, der gemte den,
 * men KUN hvis den er entydig (review P1): ingen timer_session_id, samme
 * organisation, projekt og kunde som sessionen, fra en timer (extension/
 * quickStop), sluttet inden for ±2 min af stoppet og med samme varighed som
 * det sene gem (±0,02 t). Mere end én kandidat → ingen match.
 *
 * Findes den, kobles den til sessionen (så senere gentagelser kortsluttes),
 * og det sene gem returnerer den i stedet for at gemme tiden igen. En miss
 * gemmer tiden normalt — hellere en mulig dublet (stabilitetsvagten fanger
 * den) end en forkert match, der taber tid.
 */
export async function findLegacySavedEntry(
  db: Pick<typeof dbType, "query" | "update">,
  userId: string,
  session: {
    id: string;
    status: string;
    savedEntryId: string | null;
    organizationId: string | null;
    projectId: string | null;
    clientId: string | null;
    endedAt: Date | null;
  },
  incoming: { hours: number },
) {
  if (session.status !== "saved" || session.savedEntryId || !session.endedAt) {
    return undefined;
  }
  const stopMs = session.endedAt.getTime();
  const candidates = await db.query.timeEntries.findMany({
    where: and(
      eq(timeEntries.userId, userId),
      isNull(timeEntries.timerSessionId),
      session.organizationId
        ? eq(timeEntries.organizationId, session.organizationId)
        : isNull(timeEntries.organizationId),
      session.projectId
        ? eq(timeEntries.projectId, session.projectId)
        : isNull(timeEntries.projectId),
      session.clientId
        ? eq(timeEntries.clientId, session.clientId)
        : isNull(timeEntries.clientId),
      inArray(timeEntries.source, [...LEGACY_TIMER_SOURCES]),
      gte(timeEntries.endTime, new Date(stopMs - LEGACY_MATCH_END_MS)),
      lte(timeEntries.endTime, new Date(stopMs + LEGACY_MATCH_END_MS)),
      sql`ABS(${timeEntries.hours}::numeric - ${incoming.hours}) <= ${LEGACY_MATCH_HOURS}`,
    ),
    columns: { id: true },
    limit: 2,
  });
  if (candidates.length !== 1) return undefined;
  const entry = await db.query.timeEntries.findFirst({
    where: eq(timeEntries.id, candidates[0].id),
  });
  if (!entry) return undefined;
  await db
    .update(timerSessions)
    .set({ savedEntryId: entry.id, updatedAt: new Date() })
    .where(
      and(
        eq(timerSessions.id, session.id),
        eq(timerSessions.userId, userId),
        sql`${timerSessions.savedEntryId} IS NULL`,
      ),
    );
  return entry;
}
