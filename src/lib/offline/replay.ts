import {
  afterFailure,
  afterStartApplied,
  afterStartConflict,
  afterStartRejected,
  bindStopToSession,
  type CreateEntryInput,
  classifyError,
  nextRunnable,
  type QueueItem,
  type QueueOp,
  type TimerStartPayload,
} from "./queue";

/**
 * Afspilning af offline-køen (#703) mod serveren.
 *
 * Alle skrivninger går gennem de samme atomiske procedurer som resten af
 * timer-synken — aldrig read-then-write på timerStates:
 *  - start: `timerSync.sync` med `clientOpId` (atomisk guard: lander kun på en
 *    række der ikke kører; samme nøgle to gange = én effekt)
 *  - stop: `claimForStop` (version-predikat) → `time.create` med
 *    `clientEntryId` (unikt indeks) → `confirmStop` (version-predikat)
 *  - oprettelse: `time.create` med `clientEntryId`
 * Læsningerne her afgør kun, HVILKEN atomisk skrivning vi forsøger.
 */

export interface ServerTimer {
  isRunning: boolean | null;
  startTime: string | null;
  elapsedSeconds: number;
  baseSeconds: number;
  version: number;
  intent: string | null;
  intentFrom: string | null;
  /** Rækkens aktuelle session (timer-sessioner); null på en ryddet række. */
  sessionId?: string | null;
}

export type SyncStartResult =
  | {
      success: true;
      version: number;
      deduplicated?: boolean;
      /** Rækkens startTime ved en afspilning (deduplicated). */
      startTime?: string | null;
      /** Server-udstedt id på startens session (#1333). */
      sessionId?: string | null;
    }
  | {
      success: false;
      reason?: string;
      version?: number;
      runningStartTime?: string | null;
    };

export interface ReplayApi {
  syncStart(
    payload: TimerStartPayload & { clientOpId: string },
  ): Promise<SyncStartResult>;
  getTimerState(): Promise<ServerTimer>;
  /** Med `sessionId` lander claimet kun på netop den session (#1333). */
  claimForStop(
    expectedVersion: number,
    sessionId?: string,
  ): Promise<{
    success: boolean;
    version?: number;
    reason?: string;
    sessionId?: string | null;
  }>;
  confirmStop(
    version: number,
    sessionId?: string,
  ): Promise<{ success: boolean; version?: number; reason?: string }>;
  createEntry(entry: CreateEntryInput): Promise<unknown>;
}

export type ReplayOutcome =
  | { kind: "done"; version?: number; sessionId?: string }
  | { kind: "start_conflict"; otherStart: number | null }
  | { kind: "stopped_elsewhere" };

/** En forbigående tilstand på serveren — prøv igen senere. */
export class RetryLaterError extends Error {}

const SAME_START_TOLERANCE_MS = 1_000;

function toMs(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function isCleared(server: ServerTimer): boolean {
  return (
    !server.isRunning &&
    !server.elapsedSeconds &&
    !server.baseSeconds &&
    !server.intent
  );
}

/**
 * Bærer rækken en ANDEN server-udstedt session end den, vi stoppede (#1333)?
 * Versionen kan ikke afgøre det: kom fanen online og adopterede den nye
 * session, før stoppet blev gemt, er den kendte version den nyes.
 */
function isOtherSession(
  server: ServerTimer,
  op: Extract<QueueOp, { kind: "timer.stop" }>,
): boolean {
  return (
    !!op.sessionId && !!server.sessionId && server.sessionId !== op.sessionId
  );
}

/** Bærer rækken netop den server-udstedte session, vi stoppede (#1333)? */
function isSameSession(
  server: ServerTimer,
  op: Extract<QueueOp, { kind: "timer.stop" }>,
): boolean {
  return !!op.sessionId && server.sessionId === op.sessionId;
}

/**
 * Er serverens række stadig den session, vi stoppede offline?
 * - en anden session (id) er aldrig vores; samme id altid, også på en pauset
 *   række, som en anden klient har skrevet på siden (fx beskrivelsen)
 * - versionen er uændret siden vi sidst så den → ingen har skrevet, den er vores
 * - eller den kører med samme startTime (en anden enhed har blot sendt
 *   heartbeats på samme session)
 * En ryddet række eller en anden session er ikke vores: den blev stoppet (og
 * gemt) et andet sted, og en post herfra ville tælle tiden to gange.
 */
export function isOurSession(
  server: ServerTimer,
  op: Extract<QueueOp, { kind: "timer.stop" }>,
): boolean {
  if (isCleared(server) || isOtherSession(server, op)) return false;
  if (isSameSession(server, op)) return true;
  if (op.knownVersion !== null && server.version === op.knownVersion) {
    return true;
  }
  const serverStart = toMs(server.startTime);
  return (
    !!server.isRunning &&
    serverStart !== null &&
    op.serverStartTime !== null &&
    Math.abs(serverStart - op.serverStartTime) < SAME_START_TOLERANCE_MS
  );
}

async function confirmWithRetry(
  api: ReplayApi,
  version: number,
  sessionId: string | undefined,
) {
  let next = version;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await api.confirmStop(next, sessionId);
    if (result.success) return true;
    // En nyere version må kun prøves med sessionens id: uden id kan den
    // tilhøre en anden sessions stop, og confirm ville rydde den (#1333).
    if (
      result.reason === "version_mismatch" &&
      typeof result.version === "number" &&
      sessionId
    ) {
      next = result.version;
      continue;
    }
    // no_timer / not_stopping: intet tilbage at bekræfte (cron'en har evt.
    // parkeret claimet) — posten er gemt, så stoppet er alligevel færdigt.
    return false;
  }
  return false;
}

export interface ReplayHooks {
  /** Lige FØR claimForStop sendes — markér elementet (overlever tabt svar). */
  onClaiming?: () => void;
  /**
   * Claimet er vores — gem versionen på elementet, og sessionens id, hvis
   * elementet ikke selv havde det (#1333).
   */
  onClaimed?: (version: number, sessionId?: string) => void;
}

function sameStart(
  serverStartTime: string | null | undefined,
  startMs: number | null,
): boolean {
  const serverStart = toMs(serverStartTime ?? null);
  return (
    serverStart !== null &&
    startMs !== null &&
    Math.abs(serverStart - startMs) < SAME_START_TOLERANCE_MS
  );
}

async function replayStop(
  queued: Extract<QueueOp, { kind: "timer.stop" }>,
  api: ReplayApi,
  hooks: ReplayHooks,
): Promise<ReplayOutcome> {
  // Et element med id, men en post uden (fra før #1333), sender id'et med.
  const op = bindStopToSession(queued, queued.sessionId);
  const sessionId = op.sessionId ?? undefined;
  // Sessionen fandtes kun lokalt: gem posten, rør ikke serverens timer.
  if (!op.serverKnown) {
    await api.createEntry(op.entry);
    return { kind: "done" };
  }

  // Claimet er allerede vores (et tidligere forsøg døde efter claim): gør
  // stoppet færdigt. Posten er idempotent via clientEntryId.
  if (op.claimedVersion !== undefined) {
    const server = await api.getTimerState();
    // Kun vores eget claim bekræftes: rækken kan siden bære en anden
    // sessions stop fra en anden webfane (#1333). Uden id afgør den claimede
    // version (ingen har skrevet siden; virker også på en pauset række uden
    // starttid) eller starten, og id'et fra den række, der matchede, binder
    // posten og confirm til den.
    const ours =
      server.intent === "stopping" &&
      server.intentFrom === "web" &&
      (op.sessionId
        ? !isOtherSession(server, op)
        : server.version === op.claimedVersion ||
          sameStart(server.startTime, op.serverStartTime));
    const bound = ours ? bindStopToSession(op, server.sessionId) : op;
    // Gem bindingen på elementet før posten: fejler den, og rydder en anden
    // klient rækken imens, kender næste forsøg ellers ikke sessionen.
    if (bound !== op) {
      hooks.onClaimed?.(op.claimedVersion, bound.sessionId ?? undefined);
    }
    await api.createEntry(bound.entry);
    if (ours) {
      await confirmWithRetry(api, server.version, bound.sessionId ?? undefined);
    }
    return { kind: "done" };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    const server = await api.getTimerState();
    // Claimet blev sendt, men svaret gik tabt: rækken står i 'stopping' fra
    // web på vores session. Det er vores eget claim — gør stoppet færdigt i
    // stedet for at kalde det "stoppet et andet sted" og tabe tiden.
    // Kun på en kørende række med vores start: `claiming` beviser kun et
    // forsøg, og id'et kun sessionen. En pauset A i 'stopping' kan være en
    // anden webfanes claim med gemmedialogen åben, så den overtages ikke på
    // id'et alene; den fanes stop (eller cron'ens parkering) afgør den (#1333).
    if (
      op.claiming &&
      server.intent === "stopping" &&
      server.intentFrom === "web" &&
      sameStart(server.startTime, op.serverStartTime) &&
      !isOtherSession(server, op)
    ) {
      const bound = bindStopToSession(op, server.sessionId);
      hooks.onClaimed?.(server.version, bound.sessionId ?? undefined);
      await api.createEntry(bound.entry);
      await confirmWithRetry(api, server.version, bound.sessionId ?? undefined);
      return { kind: "done" };
    }
    if (!isOurSession(server, op)) return { kind: "stopped_elsewhere" };
    // En anden klient er midt i at stoppe den: den gemmer tiden.
    if (server.intent === "stopping") return { kind: "stopped_elsewhere" };

    hooks.onClaiming?.();
    const claim = await api.claimForStop(server.version, sessionId);
    if (!claim.success || claim.version === undefined) {
      // Versionen flyttede sig mellem læsning og claim — læs igen én gang.
      if (claim.reason === "version_mismatch") continue;
      return { kind: "stopped_elsewhere" };
    }
    // Claimet ramte rækken, vi læste (versions-prædikat): dens id er vores.
    const bound = bindStopToSession(op, claim.sessionId ?? server.sessionId);
    hooks.onClaimed?.(claim.version, bound.sessionId ?? undefined);
    await api.createEntry(bound.entry);
    await confirmWithRetry(api, claim.version, bound.sessionId ?? undefined);
    return { kind: "done" };
  }
  throw new RetryLaterError("Timeren ændrede sig under stop — prøver igen");
}

async function replayStart(
  op: Extract<QueueOp, { kind: "timer.start" }>,
  api: ReplayApi,
): Promise<ReplayOutcome> {
  const result = await api.syncStart({ ...op.payload, clientOpId: op.opId });
  const ownStart = op.payload.startTime;
  if (result.success) {
    // En afspilning (samme nøgle), men rækken bærer nu en ANDEN session:
    // vores blev stoppet et andet sted, og en ny er startet. Versionen hører
    // til den nye, så den må ikke bruges til at stoppe noget på vores vegne.
    const otherSession =
      result.deduplicated &&
      result.startTime !== undefined &&
      !sameStart(result.startTime, ownStart);
    return otherSession
      ? { kind: "done" }
      : {
          kind: "done",
          version: result.version,
          sessionId: result.sessionId ?? undefined,
        };
  }
  if (result.reason === "already_running") {
    // Rækken kører vores egen session: starten landede online, men svaret
    // gik tabt, før den kom i køen (uden nøgle). Det er ingen konflikt.
    if (sameStart(result.runningStartTime, ownStart)) {
      return { kind: "done", version: result.version };
    }
    return {
      kind: "start_conflict",
      otherStart: toMs(result.runningStartTime ?? null),
    };
  }
  // Serverens genopstandelses-guard: starten ligger inde i en post, der
  // allerede er gemt — sessionen er stoppet og gemt et andet sted. Den må
  // hverken startes eller gemmes igen (og der kører ingen anden timer).
  if (result.reason === "stale_start") {
    return { kind: "stopped_elsewhere" };
  }
  // stopping_in_progress m.fl.: et stop på en anden enhed er undervejs.
  throw new RetryLaterError(
    `Timerstart afvist midlertidigt (${result.reason ?? "ukendt"})`,
  );
}

/** Udfør én operation. Kaster ved fejl (klassificeres af `drainQueue`). */
export async function executeOp(
  op: QueueOp,
  api: ReplayApi,
  hooks: ReplayHooks = {},
): Promise<ReplayOutcome> {
  switch (op.kind) {
    case "timer.start":
      return replayStart(op, api);
    case "timer.stop":
      return replayStop(op, api, hooks);
    case "time.create":
      await api.createEntry(op.entry);
      return { kind: "done" };
  }
}

/** Minimal store-flade, så dræningen kan testes uden zustand/localStorage. */
export interface QueueStoreLike {
  getItems(): QueueItem[];
  setItems(items: QueueItem[]): void;
  setInFlight(opId: string | null): void;
}

export interface DrainEvent {
  type: "start_conflict" | "stopped_elsewhere" | "failed";
  item: QueueItem;
  otherStart?: number | null;
  droppedStops?: number;
}

export interface DrainResult {
  succeeded: number;
  failed: number;
  /** Stoppede på en forbigående fejl (sandsynligvis offline igen). */
  stopped: boolean;
  events: DrainEvent[];
  /** Sessionsstarter, som en afspillet start fik etableret på serveren. */
  establishedSessions: number[];
}

function replaceItem(
  items: readonly QueueItem[],
  opId: string,
  patch: (i: QueueItem) => QueueItem,
): QueueItem[] {
  return items.map((i) => (i.opId === opId ? patch(i) : i));
}

/**
 * Afspil køen i rækkefølge. Første forbigående fejl stopper dræningen —
 * elementet får backoff og prøves ved næste online-/vågn-signal. Permanente
 * fejl markeres og springes over, så resten ikke blokeres.
 */
export async function drainQueue(
  store: QueueStoreLike,
  /** Fast API, eller ét pr. element (fx bundet til elementets org). */
  api: ReplayApi | ((item: QueueItem) => ReplayApi),
  now: () => number = Date.now,
): Promise<DrainResult> {
  const result: DrainResult = {
    succeeded: 0,
    failed: 0,
    stopped: false,
    events: [],
    establishedSessions: [],
  };

  // Loft mod uendelige løkker, hvis et element af en eller anden grund ikke
  // forlader køens hoved.
  for (let guard = 0; guard < 500; guard++) {
    const item = nextRunnable(store.getItems(), now());
    if (!item) break;
    store.setInFlight(item.opId);
    try {
      const patchStop = (
        patch: Partial<Extract<QueueOp, { kind: "timer.stop" }>>,
      ) =>
        store.setItems(
          replaceItem(store.getItems(), item.opId, (i) =>
            i.kind === "timer.stop" ? { ...i, ...patch } : i,
          ),
        );
      const itemApi = typeof api === "function" ? api(item) : api;
      const outcome = await executeOp(item, itemApi, {
        onClaiming: () => patchStop({ claiming: true }),
        onClaimed: (version, sessionId) => {
          const current = store.getItems().find((i) => i.opId === item.opId);
          patchStop(
            current?.kind === "timer.stop"
              ? {
                  ...bindStopToSession(current, sessionId),
                  claimedVersion: version,
                }
              : { claimedVersion: version },
          );
        },
      });
      const remaining = store.getItems().filter((i) => i.opId !== item.opId);
      if (outcome.kind === "done") {
        result.succeeded++;
        if (item.kind === "timer.start" && outcome.version !== undefined) {
          store.setItems(
            afterStartApplied(
              remaining,
              item,
              outcome.version,
              outcome.sessionId,
            ),
          );
          result.establishedSessions.push(item.payload.sessionStartTime);
        } else {
          store.setItems(remaining);
        }
      } else if (
        outcome.kind === "start_conflict" &&
        item.kind === "timer.start"
      ) {
        const resolved = afterStartConflict(
          store.getItems(),
          item,
          outcome.otherStart,
        );
        store.setItems(resolved.items);
        result.events.push({
          type: "start_conflict",
          item,
          otherStart: outcome.otherStart,
          droppedStops: resolved.droppedStops,
        });
      } else {
        // En start der allerede er gemt et andet sted: dens køede stop må
        // ikke gemme samme session igen.
        store.setItems(
          item.kind === "timer.start"
            ? remaining.filter(
                (i) =>
                  !(
                    i.kind === "timer.stop" &&
                    i.sessionStartTime === item.payload.sessionStartTime
                  ),
              )
            : remaining,
        );
        result.events.push({ type: "stopped_elsewhere", item });
      }
    } catch (error) {
      // Byg på den AKTUELLE kopi — et claim taget undervejs (claimedVersion)
      // skal overleve fejlen, ellers claimes der forfra ved næste forsøg.
      const current =
        store.getItems().find((i) => i.opId === item.opId) ?? item;
      const failedItem = afterFailure(current, error, now());
      let items = replaceItem(store.getItems(), item.opId, () => failedItem);
      if (failedItem.failed && item.kind === "timer.start") {
        items = afterStartRejected(items, item);
      }
      store.setItems(items);
      result.failed++;
      if (failedItem.failed) {
        result.events.push({ type: "failed", item: failedItem });
      }
      if (
        error instanceof RetryLaterError ||
        classifyError(error) === "transient"
      ) {
        result.stopped = true;
        break;
      }
    } finally {
      store.setInFlight(null);
    }
  }
  return result;
}
