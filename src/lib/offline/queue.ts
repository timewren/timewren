import type { inferRouterInputs } from "@trpc/server";
import type { AppRouter } from "@/lib/trpc/routers";

/**
 * Offline-kø (#703) — ren logik, ingen React og ingen I/O.
 *
 * Timerstart, timerstop og oprettelse af tidsposter, der sker under et kort
 * netudfald, lægges i en persistent kø og afspilles i rækkefølge, når nettet
 * er tilbage. Hver operation har en klient-genereret idempotensnøgle (`opId`),
 * som serveren bruger til at genkende en afspilning: samme operation to gange
 * giver én effekt.
 *
 * Designet står i docs/offline-koe.md.
 */

/** Event der fortæller timer-synken, at køen er tømt og den må tage over. */
export const OFFLINE_QUEUE_DRAINED_EVENT = "offline-queue-drained";

export type CreateEntryInput = inferRouterInputs<AppRouter>["time"]["create"];

/** Øjebliksbillede af timeren, da den blev startet uden net. */
export interface TimerStartPayload {
  startTime: number;
  sessionStartTime: number;
  elapsedSeconds: number;
  baseSeconds: number;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
}

export type QueueOp =
  | {
      kind: "timer.start";
      opId: string;
      payload: TimerStartPayload;
    }
  | {
      kind: "timer.stop";
      opId: string;
      /** Sessionens oprindelige start — binder stoppet til sin start i køen. */
      sessionStartTime: number | null;
      /** Rækkens `startTime`, som serveren sidst fik den fra os. */
      serverStartTime: number | null;
      /** Rækkens version, som vi sidst så den (før nettet forsvandt). */
      knownVersion: number | null;
      /**
       * Kender serveren sessionen? Nej, når starten selv ligger i køen: så
       * gemmes posten direkte, og serverens timer røres ikke (den kan tilhøre
       * en anden enhed).
       */
      serverKnown: boolean;
      /** Sat lige før claimet sendes — et tabt svar efterlader os ellers blinde. */
      claiming?: boolean;
      /** Sat når claimet er taget — beviset på, at retten til at gemme er vores. */
      claimedVersion?: number;
      /** Posten, der gemmes. `clientEntryId` er altid `opId`. */
      entry: CreateEntryInput;
    }
  | {
      kind: "time.create";
      opId: string;
      entry: CreateEntryInput;
    };

export type QueueItem = QueueOp & {
  /** Epoch-ms for enqueue. */
  createdAt: number;
  attempts: number;
  lastError: string | null;
  /** Prøv ikke igen før (epoch-ms). */
  nextAttemptAt: number;
  /** Permanent afvist — springes over, kræver brugerens valg. */
  failed: boolean;
  /**
   * Den org, brugeren var i, da operationen blev lagt i køen. Afspilningen
   * sker i den org, også efter et orgskift. Mangler på ældre elementer
   * (afspilles så i den aktive org som før).
   */
  orgId?: string | null;
};

export const MAX_ATTEMPTS = 8;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 2 * 60_000;

/** Eksponentiel backoff: 2 s, 4 s, 8 s … (loft 2 min). */
export function backoffDelay(attempts: number): number {
  if (attempts <= 0) return 0;
  return Math.min(BASE_DELAY_MS * 2 ** (attempts - 1), MAX_DELAY_MS);
}

function withKey(op: QueueOp): QueueOp {
  // Posten bærer altid operationens nøgle, så serveren kan genkende den.
  if (op.kind === "timer.start") return op;
  return { ...op, entry: { ...op.entry, clientEntryId: op.opId } };
}

/**
 * Læg en operation i køen.
 *
 * - samme `opId` to gange → ingen ændring
 * - en start for en session, der allerede har en start i køen → ingen ændring
 * - et stop, hvis start stadig ligger i køen (og ikke er undervejs til
 *   serveren) → starten fjernes, og stoppet gemmer kun posten. Serveren har
 *   aldrig set sessionen, så der er ingen timer at stoppe — og en afspillet
 *   start efterfulgt af et stop ville bare blinke en timer frem på de andre
 *   enheder.
 */
export function enqueueOp(
  items: readonly QueueItem[],
  op: QueueOp,
  now: number,
  inFlightOpId: string | null = null,
  orgId: string | null = null,
): QueueItem[] {
  if (items.some((i) => i.opId === op.opId)) return [...items];

  let next = [...items];
  let toAdd = withKey(op);

  if (toAdd.kind === "timer.start") {
    const sessionStart = toAdd.payload.sessionStartTime;
    if (
      next.some(
        (i) =>
          i.kind === "timer.start" &&
          i.payload.sessionStartTime === sessionStart,
      )
    ) {
      return next;
    }
  }

  if (toAdd.kind === "timer.stop" && toAdd.sessionStartTime !== null) {
    const sessionStart = toAdd.sessionStartTime;
    const pendingStart = next.find(
      (i) =>
        i.kind === "timer.start" &&
        !i.failed &&
        i.opId !== inFlightOpId &&
        i.payload.sessionStartTime === sessionStart,
    );
    if (pendingStart) {
      next = next.filter((i) => i.opId !== pendingStart.opId);
      toAdd = { ...toAdd, serverKnown: false };
    }
  }

  next.push({
    ...toAdd,
    createdAt: now,
    attempts: 0,
    lastError: null,
    nextAttemptAt: 0,
    failed: false,
    orgId,
  });
  return next;
}

/**
 * Næste element, der må køre nu — strengt i rækkefølge.
 *
 * Et element i backoff blokerer resten: et stop må aldrig overhale sin start,
 * og en post må ikke overhale den timer, den kom fra. Permanent fejlede
 * elementer springes over (de venter på brugeren og må ikke låse køen).
 */
export function nextRunnable(
  items: readonly QueueItem[],
  now: number,
): QueueItem | null {
  const head = items.find((i) => !i.failed);
  if (!head) return null;
  return head.nextAttemptAt <= now ? head : null;
}

/** Hvornår skal køen vågne igen (første ventende element i backoff)? */
export function nextWakeupAt(
  items: readonly QueueItem[],
  now: number,
): number | null {
  const head = items.find((i) => !i.failed);
  if (!head || head.nextAttemptAt <= now) return null;
  return head.nextAttemptAt;
}

export function pendingCount(items: readonly QueueItem[]): number {
  return items.filter((i) => !i.failed).length;
}

export function failedCount(items: readonly QueueItem[]): number {
  return items.filter((i) => i.failed).length;
}

export type ErrorKind = "permanent" | "transient";

const PERMANENT_CODES = new Set([
  "BAD_REQUEST",
  "FORBIDDEN",
  "NOT_FOUND",
  "UNPROCESSABLE_CONTENT",
  "PARSE_ERROR",
  "CONFLICT",
  "PRECONDITION_FAILED",
]);

function errorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined;
  const data = (error as { data?: { code?: unknown } }).data;
  return typeof data?.code === "string" ? data.code : undefined;
}

/**
 * Permanent = serveren afviste indholdet (validering, adgang, låst periode).
 * Alt andet — netværk, 5xx, udløbet session — er forbigående og prøves igen.
 */
export function classifyError(error: unknown): ErrorKind {
  const code = errorCode(error);
  return code && PERMANENT_CODES.has(code) ? "permanent" : "transient";
}

/**
 * Døde kaldet, fordi forbindelsen var væk (og ikke fordi serveren svarede)?
 * Kun de kald må lægges i køen i stedet for at vise en fejl.
 */
export function isNetworkError(error: unknown): boolean {
  if (errorCode(error)) return false;
  const message =
    error instanceof Error
      ? `${error.message} ${(error as { cause?: Error }).cause?.message ?? ""}`
      : String(error);
  return /failed to fetch|networkerror|network request failed|load failed|fetch failed|err_internet_disconnected|offline/i.test(
    message,
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message || error.name;
  return String(error);
}

/** Ny tilstand for et element efter et mislykket forsøg. */
export function afterFailure(
  item: QueueItem,
  error: unknown,
  now: number,
): QueueItem {
  const attempts = item.attempts + 1;
  const failed =
    classifyError(error) === "permanent" || attempts >= MAX_ATTEMPTS;
  return {
    ...item,
    attempts,
    lastError: describeError(error),
    failed,
    nextAttemptAt: failed
      ? Number.MAX_SAFE_INTEGER
      : now + backoffDelay(attempts),
  };
}

/** "Prøv igen" på et fejlet element: nulstil, behold pladsen i køen. */
export function resetForRetry(item: QueueItem): QueueItem {
  return {
    ...item,
    attempts: 0,
    lastError: null,
    failed: false,
    nextAttemptAt: 0,
  };
}

/**
 * Starten er landet: et stop for samme session, der blev lagt i køen mens
 * starten var undervejs, skal claime den version, starten gav — ellers
 * kan det ikke genkende rækken som sin egen.
 */
export function afterStartApplied(
  items: readonly QueueItem[],
  start: Extract<QueueOp, { kind: "timer.start" }>,
  version: number,
): QueueItem[] {
  return items.map((i) =>
    i.kind === "timer.stop" &&
    i.sessionStartTime === start.payload.sessionStartTime
      ? {
          ...i,
          knownVersion: version,
          serverStartTime: start.payload.startTime,
          serverKnown: true,
        }
      : i,
  );
}

/**
 * Starten kom aldrig ind (permanent afvist): et stop for samme session må så
 * ikke lede efter den på serveren — det ville erklære den "stoppet et andet
 * sted" og tabe tiden. Stoppet gemmer i stedet kun posten.
 */
export function afterStartRejected(
  items: readonly QueueItem[],
  start: Extract<QueueOp, { kind: "timer.start" }>,
): QueueItem[] {
  return items.map((i) =>
    i.kind === "timer.stop" &&
    i.sessionStartTime === start.payload.sessionStartTime
      ? { ...i, serverKnown: false }
      : i,
  );
}

/**
 * Klip en post, så den slutter `clipAt` (epoch-ms). Bruges ved konflikt: en
 * offline-session, der overlapper en timer startet på en anden enhed, må kun
 * tælle tiden FØR den anden timer startede — én kørende timer pr. bruger.
 * Returnerer null, når der ikke er noget tilbage.
 */
export function clipEntry(
  entry: CreateEntryInput,
  sessionStart: number,
  clipAt: number,
): CreateEntryInput | null {
  const available = (clipAt - sessionStart) / 3_600_000;
  if (!(available > 0)) return null;
  const hours = Math.max(
    0.01,
    Math.round(Math.min(entry.hours, available) * 100) / 100,
  );
  const endTime = entry.endTime
    ? new Date(
        Math.min(new Date(entry.endTime).getTime(), clipAt),
      ).toISOString()
    : entry.endTime;
  return { ...entry, hours, endTime };
}

/**
 * Konflikt på en køet start: en anden enhed fik en timer i gang, mens vi var
 * offline. Efter timer-sync-arkitekturen vinder den kørende timer på serveren.
 * Vores session tabes ikke, men den må ikke overlappe: et stop for samme
 * session i køen bliver til en ren oprettelse, klippet til det øjeblik den
 * anden timer startede. Er der intet tilbage, fjernes stoppet.
 */
export function afterStartConflict(
  items: readonly QueueItem[],
  start: Extract<QueueOp, { kind: "timer.start" }>,
  otherStart: number | null,
): { items: QueueItem[]; droppedStops: number } {
  const sessionStart = start.payload.sessionStartTime;
  let droppedStops = 0;
  const next: QueueItem[] = [];
  for (const item of items) {
    if (item.opId === start.opId) continue;
    if (item.kind === "timer.stop" && item.sessionStartTime === sessionStart) {
      const clipped =
        otherStart === null
          ? item.entry
          : clipEntry(item.entry, sessionStart, otherStart);
      if (!clipped) {
        droppedStops++;
        continue;
      }
      next.push({ ...item, serverKnown: false, entry: clipped });
      continue;
    }
    next.push(item);
  }
  return { items: next, droppedStops };
}

export interface StatusInput {
  online: boolean;
  pending: number;
  failed: number;
  syncing: boolean;
  /** Er der netop synkroniseret (vises kort)? */
  justSynced: boolean;
}

export type StatusTone = "offline" | "pending" | "error" | "ok";

function changes(n: number): string {
  return n === 1 ? "1 ændring" : `${n} ændringer`;
}

/** Tekst og tone til status-chippen — null betyder: vis ingenting. */
export function queueStatus(
  input: StatusInput,
): { label: string; tone: StatusTone } | null {
  if (!input.online) {
    return {
      label:
        input.pending > 0
          ? `Offline – ${changes(input.pending)} venter`
          : "Offline",
      tone: "offline",
    };
  }
  if (input.failed > 0) {
    return {
      label: `${changes(input.failed)} kunne ikke synkroniseres`,
      tone: "error",
    };
  }
  if (input.pending > 0) {
    return {
      label: input.syncing
        ? `Synkroniserer ${changes(input.pending)}…`
        : `${changes(input.pending)} venter`,
      tone: "pending",
    };
  }
  if (input.justSynced) return { label: "Synkroniseret", tone: "ok" };
  return null;
}
