import { describe, expect, it } from "vitest";
import {
  afterFailure,
  type CreateEntryInput,
  classifyError,
  clipEntry,
  enqueueOp,
  isNetworkError,
  nextRunnable,
  type QueueItem,
  type QueueOp,
  queueStatus,
} from "../queue";
import {
  drainQueue,
  type QueueStoreLike,
  type ReplayApi,
  type ServerTimer,
} from "../replay";

// =============================================
// Fake server med samme semantik som de rigtige procedurer:
// - sync med clientOpId: lander kun på en række der ikke kører; samme nøgle
//   to gange = én effekt (lastClientOpId)
// - claimForStop/confirmStop: version- og intent-predikater
// - time.create: unik clientEntryId → gentagelse returnerer eksisterende
// =============================================

const T0 = Date.UTC(2026, 9, 1, 8, 0, 0); // 10:00 dansk tid
const MIN = 60_000;
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

interface Row {
  isRunning: boolean;
  startTime: number | null;
  elapsedSeconds: number;
  baseSeconds: number;
  version: number;
  intent: string | null;
  intentFrom: string | null;
  lastClientOpId: string | null;
  /** Server-udstedt session (timer-sessioner); null på en ryddet række. */
  sessionId: string | null;
}

class FakeServer {
  row: Row = {
    isRunning: false,
    startTime: null,
    elapsedSeconds: 0,
    baseSeconds: 0,
    version: 0,
    intent: null,
    intentFrom: null,
    lastClientOpId: null,
    sessionId: null,
  };
  entries: CreateEntryInput[] = [];
  calls: string[] = [];
  /** Sessionen claim/confirm blev sendt for (#1333). */
  claimSessionIds: (string | undefined)[] = [];
  confirmSessionIds: (string | undefined)[] = [];
  /** Metoder hvis NÆSTE kald skal lykkes på serveren men miste svaret. */
  loseResponse = new Set<keyof ReplayApi>();
  /** Metoder hvis næste kald fejler før serveren nås. */
  failBefore = new Set<keyof ReplayApi>();
  /**
   * Serverens genopstandelses-guard: starten ligger inde i en allerede gemt
   * post (sessionen er stoppet og gemt et andet sted).
   */
  staleStart = false;
  /** Id, serveren udsteder til næste nye start (null: ingen sessioner). */
  nextSessionId: string | null = null;
  /** Sker på serveren lige før næste createEntry (en anden klient). */
  beforeCreate: (() => void) | null = null;

  /** En anden webfane starter B og claimer den for stop. */
  startAndClaimElsewhere(at: number, sessionId: string) {
    this.startElsewhere(at, sessionId);
    this.row = {
      ...this.row,
      intent: "stopping",
      intentFrom: "web",
      version: this.row.version + 1,
    };
  }

  /** En anden enhed starter en timer (online, uden kø). */
  startElsewhere(at: number, sessionId: string | null = null) {
    this.row = {
      ...this.row,
      isRunning: true,
      startTime: at,
      sessionId,
      version: this.row.version + 1,
    };
  }

  /** En anden enhed stopper og gemmer timeren. */
  stopElsewhere() {
    this.row = {
      ...this.row,
      isRunning: false,
      startTime: null,
      elapsedSeconds: 0,
      baseSeconds: 0,
      intent: null,
      intentFrom: null,
      sessionId: null,
      version: this.row.version + 2,
    };
  }

  private wrap<K extends keyof ReplayApi>(name: K, impl: ReplayApi[K]) {
    return (async (...args: unknown[]) => {
      this.calls.push(name);
      if (this.failBefore.delete(name)) throw new TypeError("Failed to fetch");
      const result = await (impl as (...a: unknown[]) => Promise<unknown>)(
        ...args,
      );
      if (this.loseResponse.delete(name))
        throw new TypeError("Failed to fetch");
      return result;
    }) as ReplayApi[K];
  }

  api: ReplayApi = {
    syncStart: this.wrap("syncStart", async (p) => {
      if (this.staleStart && !this.row.isRunning) {
        return {
          success: false,
          reason: "stale_start",
          version: this.row.version,
        };
      }
      if (this.row.lastClientOpId === p.clientOpId) {
        return {
          success: true,
          version: this.row.version,
          deduplicated: true,
          startTime: this.row.startTime
            ? new Date(this.row.startTime).toISOString()
            : null,
        };
      }
      if (this.row.isRunning || this.row.intent === "stopping") {
        return {
          success: false,
          reason: "already_running",
          version: this.row.version,
          runningStartTime: this.row.startTime
            ? new Date(this.row.startTime).toISOString()
            : null,
        };
      }
      this.row = {
        ...this.row,
        isRunning: true,
        startTime: p.startTime,
        elapsedSeconds: p.elapsedSeconds,
        baseSeconds: p.baseSeconds,
        version: this.row.version + 1,
        lastClientOpId: p.clientOpId,
        sessionId: this.nextSessionId,
      };
      return {
        success: true,
        version: this.row.version,
        sessionId: this.row.sessionId,
      };
    }),
    getTimerState: this.wrap(
      "getTimerState",
      async (): Promise<ServerTimer> => ({
        isRunning: this.row.isRunning,
        startTime: this.row.startTime
          ? new Date(this.row.startTime).toISOString()
          : null,
        elapsedSeconds: this.row.elapsedSeconds,
        baseSeconds: this.row.baseSeconds,
        version: this.row.version,
        intent: this.row.intent,
        intentFrom: this.row.intentFrom,
        sessionId: this.row.sessionId,
      }),
    ),
    claimForStop: this.wrap(
      "claimForStop",
      async (expectedVersion, sessionId) => {
        this.claimSessionIds.push(sessionId);
        // Som serveren: med et sessionId lander claimet kun på netop den.
        if (sessionId !== undefined && this.row.sessionId !== sessionId) {
          return {
            success: false,
            reason: "session_mismatch",
            version: this.row.version,
          };
        }
        if (
          this.row.version !== expectedVersion ||
          this.row.intent === "stopping"
        ) {
          return {
            success: false,
            reason:
              this.row.intent === "stopping"
                ? "already_stopping"
                : "version_mismatch",
            version: this.row.version,
          };
        }
        this.row = {
          ...this.row,
          intent: "stopping",
          intentFrom: "web",
          version: this.row.version + 1,
        };
        return { success: true, version: this.row.version };
      },
    ),
    confirmStop: this.wrap("confirmStop", async (version, sessionId) => {
      this.confirmSessionIds.push(sessionId);
      if (sessionId !== undefined && this.row.sessionId !== sessionId) {
        return { success: false, reason: "session_mismatch" };
      }
      if (this.row.intent !== "stopping") {
        return { success: false, reason: "not_stopping" };
      }
      if (this.row.version !== version) {
        return {
          success: false,
          reason: "version_mismatch",
          version: this.row.version,
        };
      }
      this.row = {
        ...this.row,
        isRunning: false,
        startTime: null,
        elapsedSeconds: 0,
        baseSeconds: 0,
        intent: null,
        intentFrom: null,
        sessionId: null,
        version: this.row.version + 1,
      };
      return { success: true, version: this.row.version };
    }),
    createEntry: this.wrap("createEntry", async (entry) => {
      this.beforeCreate?.();
      this.beforeCreate = null;
      // Som time.create: samme nøgle eller samme timer-session = én post.
      const existing = this.entries.find(
        (e) =>
          (e.clientEntryId && e.clientEntryId === entry.clientEntryId) ||
          (e.timerSessionId && e.timerSessionId === entry.timerSessionId),
      );
      if (existing) return { ...existing, deduplicated: true };
      this.entries.push(entry);
      return { ...entry, deduplicated: false };
    }),
  };
}

class MemoryStore implements QueueStoreLike {
  items: QueueItem[] = [];
  inFlight: string | null = null;
  getItems = () => this.items;
  setItems = (items: QueueItem[]) => {
    this.items = items;
  };
  setInFlight = (opId: string | null) => {
    this.inFlight = opId;
  };
  add(op: QueueOp, now = T0) {
    this.items = enqueueOp(this.items, op, now, this.inFlight);
  }
}

function entry(overrides: Partial<CreateEntryInput> = {}): CreateEntryInput {
  return {
    description: "Support",
    date: "2026-10-01",
    hours: 1,
    startTime: new Date(T0).toISOString(),
    endTime: new Date(T0 + 60 * MIN).toISOString(),
    fromTimer: true,
    ...overrides,
  };
}

function startOp(opId: string, sessionStart = T0): QueueOp {
  return {
    kind: "timer.start",
    opId,
    payload: {
      startTime: sessionStart,
      sessionStartTime: sessionStart,
      elapsedSeconds: 0,
      baseSeconds: 0,
      projectId: null,
      clientId: null,
      taskId: null,
      description: "Support",
    },
  };
}

function stopOp(
  opId: string,
  opts: Partial<Extract<QueueOp, { kind: "timer.stop" }>> = {},
): QueueOp {
  return {
    kind: "timer.stop",
    opId,
    sessionStartTime: T0,
    serverStartTime: T0,
    knownVersion: null,
    serverKnown: true,
    entry: entry(),
    ...opts,
  };
}

const later = () => T0 + 24 * 60 * MIN; // ingen backoff i vejen

// =============================================
// Rækkefølge
// =============================================
describe("offline-kø: rækkefølge", () => {
  it("afspiller start → stop → oprettelse i den rækkefølge de skete", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    // Starten er undervejs, da stoppet lægges i køen → ingen komprimering.
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;
    store.add({
      kind: "time.create",
      opId: "33333333-3333-4333-8333-333333333333",
      entry: entry({ description: "Manuel" }),
    });

    const result = await drainQueue(store, server.api, later);

    expect(result.succeeded).toBe(3);
    expect(server.calls).toEqual([
      "syncStart",
      "getTimerState",
      "claimForStop",
      "createEntry",
      "confirmStop",
      "createEntry",
    ]);
    expect(server.entries.map((e) => e.description)).toEqual([
      "Support",
      "Manuel",
    ]);
    expect(server.row.isRunning).toBe(false);
    expect(store.items).toEqual([]);
  });

  it("lader et element i backoff blokere resten (et stop overhaler aldrig sin start)", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;

    server.failBefore.add("syncStart");
    const first = await drainQueue(store, server.api, () => T0);
    expect(first.stopped).toBe(true);
    expect(server.calls).toEqual(["syncStart"]);
    // Starten venter i backoff — stoppet må ikke køre før den.
    expect(nextRunnable(store.items, T0 + 1)).toBeNull();

    const second = await drainQueue(store, server.api, later);
    expect(second.succeeded).toBe(2);
    expect(server.entries).toHaveLength(1);
    expect(server.row.isRunning).toBe(false);
  });

  it("komprimerer start + stop af en offline-session til én oprettelse", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", { serverKnown: true }),
    );

    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      kind: "timer.stop",
      serverKnown: false,
    });

    await drainQueue(store, server.api, later);
    // Serverens timer røres slet ikke — den kan tilhøre en anden enhed.
    expect(server.calls).toEqual(["createEntry"]);
    expect(server.row.version).toBe(0);
    expect(server.entries).toHaveLength(1);
  });
});

// =============================================
// Idempotens: samme operation to gange = én effekt
// =============================================
describe("offline-kø: idempotens", () => {
  it("samme opId lagt i køen to gange giver ét element", () => {
    const op = stopOp("22222222-2222-4222-8222-222222222222");
    const once = enqueueOp([], op, T0);
    expect(enqueueOp(once, op, T0)).toHaveLength(1);
  });

  it("en start, hvis svar gik tabt, lander kun én gang", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));

    server.loseResponse.add("syncStart");
    await drainQueue(store, server.api, () => T0);
    expect(server.row.version).toBe(1); // serveren nåede at skrive

    const result = await drainQueue(store, server.api, later);
    expect(result.succeeded).toBe(1);
    expect(server.row.version).toBe(1); // genforsøget skrev IKKE igen
    expect(result.events).toEqual([]);
  });

  it("en afspillet start genkendes også efter at timeren er stoppet et andet sted", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    server.loseResponse.add("syncStart");
    await drainQueue(store, server.api, () => T0);

    server.stopElsewhere();
    const versionAfterStop = server.row.version;
    await drainQueue(store, server.api, later);

    // Ingen genoplivning af en stoppet timer.
    expect(server.row.isRunning).toBe(false);
    expect(server.row.version).toBe(versionAfterStop);
  });

  it("et stop, hvis oprettelse mistede svaret, gemmer posten én gang", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0); // vores session kører på serveren
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
      }),
    );

    server.loseResponse.add("createEntry");
    await drainQueue(store, server.api, () => T0);
    expect(server.entries).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ claimedVersion: 2 });

    await drainQueue(store, server.api, later);
    expect(server.entries).toHaveLength(1);
    expect(server.row.isRunning).toBe(false);
    expect(server.row.intent).toBeNull();
    expect(store.items).toEqual([]);
  });

  it("et claim, hvis svar gik tabt, gøres færdigt — tiden tabes ikke", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
      }),
    );

    server.loseResponse.add("claimForStop");
    await drainQueue(store, server.api, () => T0);
    expect(server.row.intent).toBe("stopping");
    expect(store.items[0]).toMatchObject({ claiming: true });

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toEqual([]);
    expect(server.entries).toHaveLength(1);
    expect(server.row.isRunning).toBe(false);
    expect(server.row.intent).toBeNull();
  });

  it("en online-start uden nøgle, hvis svar gik tabt, er ingen konflikt", async () => {
    const server = new FakeServer();
    // Den etablerende sync landede (uden clientOpId), men svaret forsvandt,
    // så starten blev lagt i køen med en ny nøgle.
    server.startElsewhere(T0);
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toEqual([]);
    expect(result.establishedSessions).toEqual([T0]);
    expect(server.entries).toHaveLength(0);
  });

  it("en afspilning, hvor rækken nu bærer en anden session, giver ikke dens version videre", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    server.loseResponse.add("syncStart");
    await drainQueue(store, server.api, () => T0);
    // Telefonen stoppede vores session og startede en ny.
    server.stopElsewhere();
    server.startElsewhere(T0 + 30 * MIN);

    const result = await drainQueue(store, server.api, later);
    expect(result.establishedSessions).toEqual([]);
    expect(server.row.startTime).toBe(T0 + 30 * MIN);
  });

  it("en oprettelse bærer altid operationens nøgle som clientEntryId", () => {
    const [item] = enqueueOp(
      [],
      {
        kind: "time.create",
        opId: "33333333-3333-4333-8333-333333333333",
        entry: entry(),
      },
      T0,
    );
    expect(item.kind === "time.create" && item.entry.clientEntryId).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
  });
});

// =============================================
// Konflikter efter timer-sync-arkitekturen
// =============================================
describe("offline-kø: konflikter", () => {
  it("start afvist som allerede gemt (stale_start): sessionen gemmes ikke igen og meldes ikke som en kørende konflikt", async () => {
    const server = new FakeServer();
    server.staleStart = true;
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;

    const result = await drainQueue(store, server.api, later);

    expect(result.events.map((e) => e.type)).not.toContain("start_conflict");
    expect(result.events[0]).toMatchObject({ type: "stopped_elsewhere" });
    expect(server.entries).toHaveLength(0);
    expect(store.items).toEqual([]);
  });

  it("timer startet på anden enhed imens: den kørende vinder, vores tid klippes", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;

    // Mens vi var offline, startede telefonen en timer kl. 10:20.
    server.startElsewhere(T0 + 20 * MIN);
    const versionBefore = server.row.version;

    const result = await drainQueue(store, server.api, later);

    expect(result.events).toMatchObject([
      { type: "start_conflict", otherStart: T0 + 20 * MIN, droppedStops: 0 },
    ]);
    // Den anden enheds timer er urørt.
    expect(server.row.isRunning).toBe(true);
    expect(server.row.startTime).toBe(T0 + 20 * MIN);
    expect(server.row.version).toBe(versionBefore);
    // Vores session er gemt — men kun frem til 10:20.
    expect(server.entries).toHaveLength(1);
    expect(server.entries[0]).toMatchObject({
      hours: 0.33,
      endTime: new Date(T0 + 20 * MIN).toISOString(),
    });
  });

  it("anden timer kørte allerede før vores offline-start: intet dobbelt", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;
    server.startElsewhere(T0 - 30 * MIN);

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toMatchObject([
      { type: "start_conflict", droppedStops: 1 },
    ]);
    expect(server.entries).toHaveLength(0);
    expect(store.items).toEqual([]);
  });

  it("vores session stoppet på anden enhed imens: offline-stoppet gemmer ikke igen", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
      }),
    );
    server.stopElsewhere();

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toMatchObject([{ type: "stopped_elsewhere" }]);
    expect(server.entries).toHaveLength(0);
    expect(server.calls).not.toContain("claimForStop");
  });

  it("en ny session på anden enhed er ikke vores: den stoppes ikke", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
      }),
    );
    server.stopElsewhere();
    server.startElsewhere(T0 + 45 * MIN);

    await drainQueue(store, server.api, later);
    expect(server.row.isRunning).toBe(true);
    expect(server.row.intent).toBeNull();
    expect(server.entries).toHaveLength(0);
  });

  it("et offline-stop er bundet til sin session: claim og confirm sender id'et (#1333)", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
        sessionId: SESSION_A,
      }),
    );

    await drainQueue(store, server.api, later);
    expect(server.claimSessionIds).toEqual([SESSION_A]);
    expect(server.confirmSessionIds).toEqual([SESSION_A]);
    expect(server.entries).toHaveLength(1);
    expect(server.row.isRunning).toBe(false);
  });

  it("en ny session adopteret før gem bærer samme version: den stoppes ikke (#1333)", async () => {
    // A blev stoppet offline og gemt på en anden enhed; B kører nu. Fanen
    // kom online og adopterede B, så den kendte version er B's.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.stopElsewhere();
    server.startElsewhere(T0 + 45 * MIN, SESSION_B);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
        sessionId: SESSION_A,
      }),
    );

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toMatchObject([{ type: "stopped_elsewhere" }]);
    expect(server.calls).not.toContain("claimForStop");
    expect(server.row).toMatchObject({
      isRunning: true,
      intent: null,
      sessionId: SESSION_B,
    });
    expect(server.entries).toHaveLength(0);
  });

  it("et stop bag en afspillet start får startens id og bekræfter aldrig en anden fanes stop (#1333)", async () => {
    const server = new FakeServer();
    server.nextSessionId = SESSION_A;
    const store = new MemoryStore();
    // A startes og stoppes offline.
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;

    // Efter genforbindelse claimes A, men posten fejler midlertidigt.
    server.failBefore.add("createEntry");
    await drainQueue(store, server.api, () => T0);
    expect(server.claimSessionIds).toEqual([SESSION_A]);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({
      kind: "timer.stop",
      sessionId: SESSION_A,
      claimedVersion: 2,
    });

    // A kasseres; B startes, og en anden webfane claimer B for stop.
    server.stopElsewhere();
    server.startElsewhere(T0 + 45 * MIN, SESSION_B);
    server.row = { ...server.row, intent: "stopping", intentFrom: "web" };

    await drainQueue(store, server.api, later);
    expect(server.calls.filter((c) => c === "confirmStop")).toEqual([]);
    expect(server.row).toMatchObject({
      isRunning: true,
      intent: "stopping",
      sessionId: SESSION_B,
    });
  });

  it("et ældre claimet stop uden id bekræfter ikke en anden sessions stop (#1333)", async () => {
    // Vores claim af A gav version 2; siden er A ryddet, og B er startet og
    // claimet af en anden webfane (en senere version).
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = { ...server.row, version: server.row.version + 1 };
    server.stopElsewhere();
    server.startAndClaimElsewhere(T0 + 45 * MIN, SESSION_B);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", { claimedVersion: 2 }),
    );

    await drainQueue(store, server.api, later);
    expect(server.calls).not.toContain("confirmStop");
    expect(server.row).toMatchObject({ intent: "stopping" });
  });

  it("et ældre claimet stop uden id bekræfter med id'et fra rækken, det matchede (#1333)", async () => {
    // A er claimet af køen (svaret kom); elementet har intet id.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = {
      ...server.row,
      intent: "stopping",
      intentFrom: "web",
      version: server.row.version + 1,
    };
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        claimedVersion: server.row.version,
      }),
    );
    // Mens posten gemmes, kasseres A, og en anden webfane claimer B.
    server.beforeCreate = () => {
      server.stopElsewhere();
      server.startAndClaimElsewhere(T0 + 45 * MIN, SESSION_B);
    };

    await drainQueue(store, server.api, later);
    expect(server.confirmSessionIds.every((id) => id === SESSION_A)).toBe(true);
    expect(server.entries).toMatchObject([{ timerSessionId: SESSION_A }]);
    expect(server.row).toMatchObject({
      isRunning: true,
      intent: "stopping",
      sessionId: SESSION_B,
    });
  });

  it("et stop uden id rydder ikke en anden sessions stop efter sit claim (#1333)", async () => {
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
      }),
    );
    server.beforeCreate = () => {
      server.stopElsewhere();
      server.startAndClaimElsewhere(T0 + 45 * MIN, SESSION_B);
    };

    await drainQueue(store, server.api, later);
    expect(server.confirmSessionIds.every((id) => id === SESSION_A)).toBe(true);
    expect(server.row).toMatchObject({
      isRunning: true,
      intent: "stopping",
      sessionId: SESSION_B,
    });
  });

  it("et stop bag en afspillet start gemmes ikke igen, når en anden klient har gemt sessionen (#1333)", async () => {
    const server = new FakeServer();
    server.nextSessionId = SESSION_A;
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;

    // A claimes af køen, men posten fejler midlertidigt.
    server.failBefore.add("createEntry");
    await drainQueue(store, server.api, () => T0);
    expect(store.items).toMatchObject([
      {
        kind: "timer.stop",
        entry: { timerSessionId: SESSION_A },
      },
    ]);

    // En anden klient gemmer A (sin egen nøgle, samme session).
    server.entries.push(
      entry({ clientEntryId: undefined, timerSessionId: SESSION_A }),
    );
    server.stopElsewhere();

    await drainQueue(store, server.api, later);
    expect(store.items).toHaveLength(0);
    expect(server.entries).toHaveLength(1);
  });

  it("et ældre claimet stop uden id gemmer bindingen, før posten sendes (#1333)", async () => {
    // A er claimet af køen (svaret kom); elementet har intet id.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = {
      ...server.row,
      intent: "stopping",
      intentFrom: "web",
      version: server.row.version + 1,
    };
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        claimedVersion: server.row.version,
      }),
    );

    // Posten fejler midlertidigt.
    server.failBefore.add("createEntry");
    await drainQueue(store, server.api, () => T0);
    expect(store.items).toMatchObject([
      {
        kind: "timer.stop",
        sessionId: SESSION_A,
        entry: { timerSessionId: SESSION_A },
      },
    ]);

    // En anden klient gemmer A og rydder rækken inden næste forsøg.
    server.entries.push(
      entry({ clientEntryId: undefined, timerSessionId: SESSION_A }),
    );
    server.stopElsewhere();

    await drainQueue(store, server.api, later);
    expect(store.items).toHaveLength(0);
    expect(server.entries).toHaveLength(1);
  });

  it("et ældre claimet stop uden id binder en pauset A på den claimede version (#1333)", async () => {
    // A er pauset (ingen starttid, opsparet tid) og claimet af køen; elementet
    // har intet id. Rækken står præcis på den claimede version.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = {
      ...server.row,
      isRunning: false,
      startTime: null,
      baseSeconds: 1800,
      intent: "stopping",
      intentFrom: "web",
      version: server.row.version + 2,
    };
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        claimedVersion: server.row.version,
      }),
    );

    // Posten fejler midlertidigt.
    server.failBefore.add("createEntry");
    await drainQueue(store, server.api, () => T0);
    expect(store.items).toMatchObject([
      {
        kind: "timer.stop",
        sessionId: SESSION_A,
        entry: { timerSessionId: SESSION_A },
      },
    ]);

    // En anden klient gemmer A og rydder rækken inden næste forsøg.
    server.entries.push(
      entry({ clientEntryId: undefined, timerSessionId: SESSION_A }),
    );
    server.stopElsewhere();

    await drainQueue(store, server.api, later);
    expect(store.items).toHaveLength(0);
    expect(server.entries).toHaveLength(1);
  });

  it("et stop for en pauset A gemmes, selv om en anden klient har skrevet på A siden (#1333)", async () => {
    // A er pauset, da den stoppes offline. Bagefter ændrer en anden klient
    // beskrivelsen på A, så versionen stiger; A er stadig pauset.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = {
      ...server.row,
      isRunning: false,
      startTime: null,
      baseSeconds: 1800,
      version: server.row.version + 1,
    };
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
        sessionId: SESSION_A,
      }),
    );
    server.row = { ...server.row, version: server.row.version + 1 };

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toEqual([]);
    expect(server.claimSessionIds).toEqual([SESSION_A]);
    expect(server.confirmSessionIds).toEqual([SESSION_A]);
    expect(server.entries).toMatchObject([{ timerSessionId: SESSION_A }]);
    expect(server.row).toMatchObject({ intent: null, sessionId: null });
  });

  it("et stop overtager ikke en anden webfanes claim af en pauset A (#1333)", async () => {
    // Køens claim når aldrig frem. En anden webfane claimer den pausede A og
    // har sin gemmedialog åben: det er dens stop, ikke køens.
    const server = new FakeServer();
    server.startElsewhere(T0, SESSION_A);
    server.row = {
      ...server.row,
      isRunning: false,
      startTime: null,
      baseSeconds: 1800,
      version: server.row.version + 1,
    };
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        knownVersion: server.row.version,
        sessionId: SESSION_A,
      }),
    );
    server.failBefore.add("claimForStop");
    await drainQueue(store, server.api, () => T0);
    expect(store.items[0]).toMatchObject({ claiming: true });

    server.row = {
      ...server.row,
      intent: "stopping",
      intentFrom: "web",
      version: server.row.version + 1,
    };
    await drainQueue(store, server.api, later);
    expect(server.entries).toEqual([]);
    expect(server.confirmSessionIds).toEqual([]);
    expect(server.row).toMatchObject({
      intent: "stopping",
      sessionId: SESSION_A,
    });
  });

  it("et køelement med id, men uden id på posten, sender posten med id'et (#1333)", async () => {
    // Fra den forrige implementation: sessionId sat, entry.timerSessionId ikke.
    // En anden klient har allerede gemt A og ryddet rækken.
    const server = new FakeServer();
    server.entries.push(
      entry({ clientEntryId: undefined, timerSessionId: SESSION_A }),
    );
    const store = new MemoryStore();
    store.add(
      stopOp("22222222-2222-4222-8222-222222222222", {
        sessionId: SESSION_A,
        claimedVersion: 2,
      }),
    );

    await drainQueue(store, server.api, later);
    expect(store.items).toHaveLength(0);
    expect(server.entries).toHaveLength(1);
  });

  it("en permanent afvist start gør sit stop til en ren oprettelse", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.add(startOp("11111111-1111-4111-8111-111111111111"));
    store.inFlight = "11111111-1111-4111-8111-111111111111";
    store.add(stopOp("22222222-2222-4222-8222-222222222222"));
    store.inFlight = null;
    server.api.syncStart = async () => {
      throw Object.assign(new Error("Projekt ikke fundet"), {
        data: { code: "NOT_FOUND" },
      });
    };

    const result = await drainQueue(store, server.api, later);
    expect(result.events).toMatchObject([{ type: "failed" }]);
    // Stoppet led ikke efter en session, serveren aldrig fik — tiden er gemt.
    expect(server.entries).toHaveLength(1);
    expect(store.items).toHaveLength(1);
    expect(store.items[0]).toMatchObject({ kind: "timer.start", failed: true });
  });
});

// =============================================
// Hjælpere
// =============================================
describe("offline-kø: hjælpere", () => {
  it("klassificerer netværksfejl som forbigående og afvisninger som permanente", () => {
    expect(isNetworkError(new TypeError("Failed to fetch"))).toBe(true);
    expect(
      isNetworkError(
        Object.assign(new Error("x"), { data: { code: "BAD_REQUEST" } }),
      ),
    ).toBe(false);
    expect(classifyError(new TypeError("Failed to fetch"))).toBe("transient");
    expect(
      classifyError(
        Object.assign(new Error("låst"), { data: { code: "FORBIDDEN" } }),
      ),
    ).toBe("permanent");
    expect(
      classifyError(
        Object.assign(new Error("udløbet"), { data: { code: "UNAUTHORIZED" } }),
      ),
    ).toBe("transient");
  });

  it("giver backoff efter forbigående fejl og markerer permanente som fejlet", () => {
    const [item] = enqueueOp(
      [],
      { kind: "time.create", opId: "a", entry: entry() },
      T0,
    );
    const transient = afterFailure(item, new TypeError("Failed to fetch"), T0);
    expect(transient).toMatchObject({
      failed: false,
      nextAttemptAt: T0 + 2000,
    });
    const permanent = afterFailure(
      item,
      Object.assign(new Error("nej"), { data: { code: "BAD_REQUEST" } }),
      T0,
    );
    expect(permanent.failed).toBe(true);
  });

  it("klipper en post til et tidspunkt og afviser tomme", () => {
    expect(clipEntry(entry(), T0, T0 + 30 * MIN)).toMatchObject({
      hours: 0.5,
    });
    expect(clipEntry(entry(), T0, T0)).toBeNull();
    expect(clipEntry(entry(), T0, T0 + 120 * MIN)?.hours).toBe(1);
  });

  it("viser status-chippens tekster", () => {
    const base = { failed: 0, syncing: false, justSynced: false };
    expect(queueStatus({ ...base, online: false, pending: 3 })?.label).toBe(
      "Offline – 3 ændringer venter",
    );
    expect(queueStatus({ ...base, online: false, pending: 1 })?.label).toBe(
      "Offline – 1 ændring venter",
    );
    expect(
      queueStatus({ ...base, online: true, pending: 0, justSynced: true })
        ?.label,
    ).toBe("Synkroniseret");
    expect(queueStatus({ ...base, online: true, pending: 0 })).toBeNull();
    expect(
      queueStatus({ ...base, online: true, pending: 0, failed: 2 })?.tone,
    ).toBe("error");
  });
});

// =============================================
// Orgskift: elementer afspilles i den org, de blev lagt i køen i
// =============================================
describe("offline-kø: orgskift", () => {
  it("husker den org, elementet blev lagt i køen i", () => {
    const op: QueueOp = {
      kind: "time.create",
      opId: "33333333-3333-4333-8333-333333333333",
      entry: entry(),
    };
    const [item] = enqueueOp([], op, T0, null, "org-a");
    expect(item.orgId).toBe("org-a");
  });

  it("afspiller hvert element med sin egen org", async () => {
    const server = new FakeServer();
    const store = new MemoryStore();
    store.items = enqueueOp(
      enqueueOp(
        [],
        {
          kind: "time.create",
          opId: "44444444-4444-4444-8444-444444444444",
          entry: entry(),
        },
        T0,
        null,
        "org-a",
      ),
      {
        kind: "time.create",
        opId: "55555555-5555-4555-8555-555555555555",
        entry: entry({ description: "Andet" }),
      },
      T0,
      null,
      "org-b",
    );

    const usedOrgs: (string | null | undefined)[] = [];
    const result = await drainQueue(
      store,
      (item) => {
        usedOrgs.push(item.orgId);
        return server.api;
      },
      later,
    );

    expect(result.succeeded).toBe(2);
    expect(result.failed).toBe(0);
    expect(usedOrgs).toEqual(["org-a", "org-b"]);
    expect(store.items).toEqual([]);
  });
});
