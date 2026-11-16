/**
 * Simulerede klienter + invarianter for timer-protokollen.
 *
 * Klienterne opfører sig som den rigtige klientkode (web: useTimerSync +
 * TimeTrackingBar, extension: timerStore + offline-kø, mobil: timetrack-app
 * timer-service) — men forenklet til netværkskoreografien. Alle kald går
 * gennem de RIGTIGE tRPC-routere mod en rigtig Postgres.
 *
 * Fejlmodel:
 * - Tabt svar: serveren har committet, klienten ser en netværksfejl.
 *   Klienten reagerer som sin rigtige kode (web: prøv igen/vis fejl,
 *   extension: læg updateTimerState i offline-køen og afspil senere).
 * - Forsinket levering: en tidligere sendt skrivning lander igen senere
 *   ("ghost"-afspilning) — dækker gamle builds, offline-køer og omordning.
 * - Ur-skævhed: hver klient har en fast forskydning af sit ur.
 * - Samtidighed: to klienters handlinger køres samtidig (Promise.all).
 */

import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  isPureKeepAlive,
  observerKeepAliveDecision,
  sawOwnerActivity,
} from "../heartbeat-observer";
import type { Fixture, ModelCaller, SimClock, TargetKey } from "./world";
import {
  readEntries,
  readPrepaid,
  readSessions,
  readTimerRow,
  sessionCaller,
  tokenCaller,
} from "./world";

export type ClientKind = "web" | "ext" | "mobile";

export interface ClientSpec {
  id: string;
  kind: ClientKind;
  skewMs: number;
  /**
   * Ældre klient: extension 2.5.x (uden sessionId/clientOpId) eller
   * Expo-appen build 4/5 (uden sessionId). Uden flaget er klienten
   * sessionsbevidst (extension 2.6.0, appen fra timetrack-app#18).
   */
  legacy?: boolean;
}

interface Local {
  running: boolean;
  paused: boolean;
  /** web: start på hele sessionen (gem bruger den); ellers = segStart */
  sessionStart: number | null;
  /** start på det nuværende kørende segment (serverens startTime) */
  segStart: number | null;
  baseSec: number;
  target: TargetKey | null;
  continuing?: { entryId: string; hours: number; date: string };
}

const IDLE: Local = {
  running: false,
  paused: false,
  sessionStart: null,
  segStart: null,
  baseSec: 0,
  target: null,
};

interface PendingSave {
  startMs: number;
  endMs: number;
  activeSec: number;
  target: TargetKey;
  continuing?: Local["continuing"];
  /** serverens segment-starter for den claimede session (til invarianterne) */
  serverStarts: number[];
  /** Et gem-forsøg er landet på serveren (også hvis svaret blev tabt) */
  saveCommitted?: boolean;
}

type SentWrite = { via: "sync"; payload: Record<string, unknown> };

class SimClient {
  local: Local = { ...IDLE };
  knownVersion = 0;
  established = false;
  adoptNext = false;
  /** Målet serveren sidst bekræftede (useTimerSync.lastServerDetailsRef) */
  lastServerTarget: TargetKey | null = null;
  /**
   * web: server-udstedt session (timerStore.sessionId, persisteret i
   * localStorage — overlever genindlæsning).
   */
  sessionId: string | null = null;
  /**
   * web: idempotensnøglen på en ny start, indtil serveren har svaret
   * (timerStore.startOpId, persisteret)
   */
  startOpId: string | null = null;
  pending?: PendingSave;
  /**
   * web: observatør (useTimerSync.observerRef) — fanens keep-alive tabte til
   * en anden aktiv skriver; den sender ikke keep-alive, før den ændrer noget
   * selv, eller ejeren ikke er set i OWNER_STALE_MS.
   */
  observer = false;
  /** web: klientens ur da en fremmed skrivning sidst blev set */
  ownerSeenAt = 0;
  /** web: antal version_conflict-svar (til tests af konfliktløkker) */
  versionConflicts = 0;
  /** web: antal keep-alive der blev sprunget over som observatør */
  skippedKeepAlives = 0;
  /**
   * web: et kundeskift fanen har valgt, men som serveren endnu ikke har
   * modtaget (useTimerSync.unsyncedSelectionRef) — fx fordi skrivningen gik
   * tabt eller blev sendt som den endnu ubekræftede start (deduplikeret).
   * Valget holdes lokalt og når serveren med en senere skrivning.
   */
  unsynced?: Explicit;
  saveKey: { session: number | null; key?: string } = { session: null };
  history: SentWrite[] = [];
  /** web-offline-køen (#703): køede starter hvis svar gik tabt */
  webQueue: Record<string, unknown>[] = [];
  /** extensionens write-ahead-kø: et ubekræftet confirmStop afspilles */
  extQueue: Array<
    | { type: "confirm"; version: number; sessionId?: string }
    | {
        type: "create";
        payload: Record<string, unknown>;
        serverStarts: number[];
      }
  > = [];
  /**
   * mobil (ny): stop-journalen — et claim hvis gem gik tabt, bevares, og
   * journalen gør stoppet færdigt (time.create med samme timerSessionId →
   * confirm). Afspilles af `tøm-kø` og ved næste stop.
   */
  mobileJournal?: {
    payload: Record<string, unknown>;
    serverStarts: number[];
    version: number;
    sessionId?: string;
  };
  constructor(readonly spec: ClientSpec) {}
}

/** En eksplicit brugerhandling der vælger kunde for sessionen ved `starts`. */
interface Explicit {
  starts: Array<number | null>;
  key: TargetKey;
}

const LOST = Symbol("lost");
type Lossy<T> = T | typeof LOST;

export class Violation extends Error {}

function round2(h: number): number {
  return Math.round(h * 100) / 100;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class Sim {
  readonly clients: SimClient[];
  readonly web: ModelCaller;
  readonly mobile: ModelCaller;
  /** Expo-appen build 4/5 (ældre klient) */
  readonly mobileLegacy: ModelCaller;
  /** extension 2.6.0 (sessionsbevidst) */
  readonly ext: ModelCaller;
  /** extension 2.5.x (ældre klient) */
  readonly extLegacy: ModelCaller;
  readonly trace: string[] = [];
  // Invariant-tilstand
  private maxVersion = 0;
  private currentServerStarts = new Set<number>();
  private closedStarts = new Set<number>();
  private explicit = new Map<number, string>();
  /** post-id → updatedAt ved sidste tjek (en opdateret post tjekkes igen) */
  private checkedEntries = new Map<string, number>();
  /** Serialiserer start/genoptag når kendt fejl K2 skal undgås */
  private startGate: Promise<void> = Promise.resolve();
  readonly maxSkewMs: number;
  errors = 0;

  constructor(
    readonly fx: Fixture,
    readonly clock: SimClock,
    specs: ClientSpec[],
    readonly cron: () => Promise<void>,
    /**
     * Undgå de KENDTE fejl (se KNOWN_BUGS i timer-protocol.dbtest.ts), så de
     * tilfældige properties kan finde NYE fejl. Hver kendt fejl har sin egen
     * deterministiske `it.fails`-test med modeksemplet.
     */
    readonly avoidKnownBugs = true,
  ) {
    this.clients = specs.map((s) => new SimClient(s));
    // x-timetrack-client som de rigtige klienter sender (#781)
    this.web = sessionCaller(fx, { "x-timetrack-client": "web/model" });
    this.mobile = sessionCaller(fx, {
      "x-timetrack-client": "mobile/1.0.0+6",
      authorization: "Bearer model",
    });
    this.mobileLegacy = sessionCaller(fx, {
      "x-timetrack-client": "mobile/1.0.0+5",
      authorization: "Bearer model",
    });
    this.ext = tokenCaller("2.6.0");
    this.extLegacy = tokenCaller("2.5.2");
    this.maxSkewMs = Math.max(0, ...specs.map((s) => Math.abs(s.skewMs)));
  }

  // ── hjælpere ─────────────────────────────────────────────────────────

  private apiFor(c: SimClient): ModelCaller {
    if (c.spec.kind !== "mobile") return this.web;
    return c.spec.legacy ? this.mobileLegacy : this.mobile;
  }

  private extApi(c: SimClient): ModelCaller {
    return c.spec.legacy ? this.extLegacy : this.ext;
  }

  /**
   * Sessionsbevidst klient (fase 1: web, fase 2: extension 2.6.0 og appen
   * fra timetrack-app#18): sender sessionId på alle skrivninger. De kendte
   * fejl K1/K3/K5/K6 gælder ikke — ingen undvigelser.
   */
  private sessionAware(c: SimClient): boolean {
    return !c.spec.legacy;
  }

  /**
   * Starter med idempotensnøgle (web, extension 2.6.0) lander kun på en række
   * uden aktiv session. Appen starter stadig uden nøgle (læser serveren
   * først), så K2 undviges for den.
   */
  private startsWithKey(c: SimClient): boolean {
    return c.spec.kind !== "mobile" && !c.spec.legacy;
  }

  private log(line: string) {
    this.trace.push(
      `[t+${Math.round((this.clock.now - this.clock.start) / 1000)}s] ${line}`,
    );
  }

  private nowOf(c: SimClient): number {
    return this.clock.now + c.spec.skewMs;
  }

  private target(key: TargetKey) {
    return this.fx.targets[key];
  }

  private keyForClientId(
    clientId: string | null | undefined,
  ): TargetKey | null {
    if (!clientId) return null;
    if (clientId === this.fx.targets.A.clientId) return "A";
    if (clientId === this.fx.targets.B.clientId) return "B";
    return null;
  }

  private keyForProject(
    projectId: string | null | undefined,
  ): TargetKey | null {
    if (!projectId) return null;
    if (projectId === this.fx.targets.A.projectId) return "A";
    if (projectId === this.fx.targets.B.projectId) return "B";
    return null;
  }

  /** En bruger-handling vælger eksplicit kunde for sessionen der starter ved `starts`. */
  private recordExplicit(starts: Array<number | null>, key: TargetKey) {
    for (const s of starts) {
      if (s !== null) this.explicit.set(s, this.target(key).clientId);
    }
  }

  /**
   * Kør et kald. Ved `lost` udføres kaldet fuldt (serveren committer), men
   * klienten får en netværksfejl i stedet for svaret. Uventede serverfejl
   * (500, ikke-TRPC-fejl) er altid en invariant-brud.
   */
  private async call<T>(
    label: string,
    lost: boolean,
    fn: () => Promise<T>,
    /** Kaldes når serveren har committet — også når svaret "tabes". */
    onCommit?: (res: T) => void,
  ): Promise<Lossy<T> | TRPCError> {
    try {
      const res = await fn();
      onCommit?.(res);
      this.log(`${label}${lost ? " [SVAR TABT]" : ""} → ${short(res)}`);
      return lost ? LOST : res;
    } catch (err) {
      if (err instanceof TRPCError && err.code !== "INTERNAL_SERVER_ERROR") {
        this.log(`${label} → ${err.code}: ${err.message}`);
        this.errors++;
        return lost ? LOST : err;
      }
      this.log(`${label} → SERVERFEJL ${String(err)}`);
      throw new Violation(
        `Serverfejl på ${label}: ${err instanceof Error ? err.stack : String(err)}`,
      );
    }
  }

  private elapsedSec(c: SimClient, at: number): number {
    const l = c.local;
    if (l.running && l.segStart !== null) {
      return l.baseSec + Math.max(0, Math.floor((at - l.segStart) / 1000));
    }
    return l.baseSec;
  }

  // ── web-klient ───────────────────────────────────────────────────────

  private webSyncPayload(c: SimClient, extra: Record<string, unknown> = {}) {
    const l = c.local;
    const t = l.target ? this.target(l.target) : null;
    const isFreshStart = l.running && !c.established && !c.adoptNext;
    const elapsed = this.elapsedSec(c, this.nowOf(c));
    // useTimerSync: en NY session (intet id, ingen tidligere tid) startes med
    // en idempotensnøgle, der genbruges indtil serveren har svaret
    const isNewSessionStart =
      c.spec.kind === "web" && isFreshStart && !c.sessionId && l.baseSec === 0;
    if (isNewSessionStart && !c.startOpId) c.startOpId = randomUUID();
    const web = c.spec.kind === "web";
    return {
      isRunning: l.running,
      startTime: l.running ? l.segStart : null,
      sessionStartTime: l.sessionStart,
      elapsedSeconds: elapsed,
      baseSeconds: l.running ? l.baseSec : elapsed,
      projectId: t?.projectId ?? null,
      clientId: t?.clientId ?? null,
      taskId: null,
      description: "",
      source: "web" as const,
      isFreshStart,
      isAdoption: l.running && c.adoptNext,
      // heartbeatExpectedVersion (lib/timer/heartbeat-version.ts): kun et
      // uændret heartbeat på en etableret session sender versionen
      expectedVersion:
        l.running &&
        c.established &&
        !c.adoptNext &&
        !isFreshStart &&
        c.knownVersion > 0 &&
        c.lastServerTarget === l.target
          ? c.knownVersion
          : undefined,
      ...(web
        ? {
            sessionId: c.sessionId ?? undefined,
            // Ukendt id, men en start der måske landede: skriv kun til DEN
            sessionOpId:
              !isNewSessionStart && !c.sessionId && c.startOpId
                ? c.startOpId
                : undefined,
            clientOpId: isNewSessionStart
              ? (c.startOpId ?? undefined)
              : undefined,
            // Adoption og pause ændrer ikke detaljerne, når fanens kopi er den
            // serveren sidst bekræftede — så et nyere skift ikke overskrives
            keepDetails:
              ((l.running && c.adoptNext) || (!l.running && elapsed > 0)) &&
              c.lastServerTarget === l.target,
            continuesEntryId:
              isNewSessionStart && l.continuing
                ? l.continuing.entryId
                : undefined,
          }
        : {}),
      ...extra,
    };
  }

  private async webSync(
    c: SimClient,
    payload: Record<string, unknown>,
    lost: boolean,
    explicit?: Explicit,
    depth = 0,
  ) {
    await this.drainWebQueue(c);
    c.history.push({ via: "sync", payload });
    const res = await this.call(
      `${c.spec.id} sync`,
      lost,
      () => this.apiFor(c).timerSync.sync(payload as never),
      (r) => {
        const o = r as { success: boolean; deduplicated?: boolean };
        if (explicit && o.success && !o.deduplicated) {
          this.recordExplicit(explicit.starts, explicit.key);
        }
        // Et ventende (usynket) valg når serveren med denne skrivning: det er
        // stadig brugerens eksplicitte valg for sessionen
        const held = c.unsynced;
        if (
          held &&
          o.success &&
          !o.deduplicated &&
          payload.clientId === this.target(held.key).clientId
        ) {
          this.recordExplicit(held.starts, held.key);
          c.unsynced = undefined;
        }
      },
    );
    if (res === LOST && typeof payload.clientOpId === "string") {
      // Tabt svar: nøglen beholdes (genforsøg = samme start), og starten
      // lægges i offline-køen med SAMME nøgle (queueStartIfUnestablished)
      c.webQueue.push(payload);
    }
    if (res === LOST || res instanceof TRPCError) return;
    // Serveren har svaret — nøglen er ikke længere sessionens identitet
    if (
      c.startOpId &&
      (payload.clientOpId === c.startOpId ||
        payload.sessionOpId === c.startOpId)
    ) {
      c.startOpId = null;
    }
    const r = res as {
      success: boolean;
      reason?: string;
      version?: number;
      sessionId?: string | null;
      deduplicated?: boolean;
      sessionStatus?: string | null;
      sessionCurrent?: boolean;
      details?: { projectId: string | null; clientId: string | null };
    };
    if (r.version !== undefined) c.knownVersion = r.version;
    if (r.success && r.deduplicated) {
      // #786: starten var allerede landet. Kører sessionen stadig, overtages
      // den med serverens detaljer; ellers droppes den lokale kopi.
      const active =
        r.sessionStatus === "running" ||
        r.sessionStatus === "paused" ||
        r.sessionStatus === "stopping";
      if (r.sessionId && r.sessionCurrent && active) {
        c.sessionId = r.sessionId;
        c.established = true;
      } else {
        c.local = { ...IDLE };
        c.sessionId = null;
        c.startOpId = null;
        c.established = false;
      }
      c.adoptNext = false;
      if (depth < 2) await this.reconcile(c, depth + 1);
      return;
    }
    if (r.success) {
      c.observer = false;
      if (r.sessionId && (payload.isRunning || c.local.paused)) {
        c.sessionId = r.sessionId;
      }
      // keepDetails: rækken beholdt sine (evt. nyere) detaljer — spejl dem
      const kept = payload.keepDetails
        ? (this.keyForClientId(r.details?.clientId) ??
          this.keyForProject(r.details?.projectId))
        : null;
      if (kept && kept !== c.local.target) {
        c.local = { ...c.local, target: kept };
      }
      if (payload.isRunning) {
        c.established = true;
        c.lastServerTarget = c.local.target;
      }
      c.adoptNext = false;
      return;
    }
    switch (r.reason) {
      case "stopping_in_progress":
        // useTimerSync: den lokale timer stoppes (parkeret kopi); sessionen
        // afgøres af næste afstemning (gemt → nulstil, annulleret → adoptér)
        if (c.spec.kind === "web") {
          c.local = { ...IDLE };
          c.established = false;
        }
        return;
      case "session_mismatch":
      case "not_running":
      case "not_active":
      case "stale_start":
      case "adoption_stale":
        c.local = { ...IDLE };
        c.sessionId = null;
        c.startOpId = null;
        c.established = false;
        if (depth < 2) await this.reconcile(c, depth + 1);
        return;
      case "version_conflict":
        // useTimerSync: en anden aktiv skriver holder timeren i live — fanen
        // bliver observatør i stedet for at kæmpe hvert 30. sekund
        c.versionConflicts++;
        c.observer = true;
        c.ownerSeenAt = this.nowOf(c);
        if (depth < 2) await this.reconcile(c, depth + 1);
        return;
      default:
        // already_running → afstem med serveren
        if (depth < 2) await this.reconcile(c, depth + 1);
    }
  }

  private webStart(
    c: SimClient,
    key: TargetKey,
    viaQueue: boolean,
    lost: boolean,
    continuing?: Local["continuing"],
  ) {
    const t = this.nowOf(c);
    c.local = {
      running: true,
      paused: false,
      sessionStart: t,
      segStart: t,
      baseSec: 0,
      target: key,
      continuing,
    };
    c.established = false;
    c.adoptNext = false;
    // timerStore.startTimer: ny session, intet id endnu. Alle web-starter
    // bærer nu en idempotensnøgle (også uden "kø"), så `viaQueue` er kun en
    // etiket.
    c.sessionId = null;
    c.startOpId = null;
    c.unsynced = undefined;
    void viaQueue;
    const payload = this.webSyncPayload(c);
    return this.webSync(c, payload, lost, { starts: [t], key });
  }

  // ── kommandoer (offentlige) ──────────────────────────────────────────

  /**
   * K2 (#784): en fresh start/genoptag fra SAMME kilde (to web-enheder, to
   * extension-instanser) overskriver en kørende session. Med avoidKnownBugs
   * starter brugeren kun, når serveren ikke har en kørende timer, og to
   * starter afgøres ikke samtidigt.
   */
  private async serial(run: () => Promise<void>): Promise<void> {
    if (!this.avoidKnownBugs) return run();
    const prev = this.startGate;
    let release: () => void = () => {};
    this.startGate = new Promise<void>((r) => {
      release = r;
    });
    await prev;
    try {
      await run();
    } finally {
      release();
    }
  }

  private startGuarded(
    run: () => Promise<void>,
    aware: boolean,
  ): Promise<void> {
    return this.serial(async () => {
      // Rettet for web (fase 1) og extension 2.6.0 (fase 2): en ny start
      // bærer en idempotensnøgle og lander kun på en række uden aktiv
      // session. Mobil og extension 2.5.x: undgås.
      if (this.avoidKnownBugs && !aware) {
        const row = await readTimerRow(this.fx.userId);
        if (row?.isRunning || row?.intent === "stopping") {
          this.log(
            "(start/genoptag springes over: der kører allerede en timer — K2/K6)",
          );
          return;
        }
      }
      await run();
    });
  }

  async start(i: number, key: TargetKey, viaQueue: boolean, lost: boolean) {
    const c = this.clients[i];
    if (c.local.running || c.local.paused || c.pending) return;
    return this.startGuarded(
      () => this.startUnguarded(c, key, viaQueue, lost),
      this.startsWithKey(c),
    );
  }

  private async startUnguarded(
    c: SimClient,
    key: TargetKey,
    viaQueue: boolean,
    lost: boolean,
  ) {
    if (c.spec.kind === "web") return this.webStart(c, key, viaQueue, lost);
    if (c.spec.kind === "mobile") return this.mobileStart(c, key, lost);
    return this.extStart(c, key, lost);
  }

  async heartbeat(i: number, lost: boolean) {
    const c = this.clients[i];
    if (!c.local.running || c.pending) return;
    if (c.spec.kind === "web") {
      if (await this.webObserverSkips(c)) return;
      return this.webSync(c, this.webSyncPayload(c), lost);
    }
    // Extensionen og mobilen sender ikke periodiske skrivninger — de poller.
    return this.reconcile(c);
  }

  /**
   * useTimerSync: en observatør sender ikke et rent keep-alive, mens en anden
   * skriver holder timeren i live. Er ejeren ikke set i OWNER_STALE_MS,
   * afstemmes der først; er den stadig væk, overtager fanen keep-alive.
   */
  private async webObserverSkips(c: SimClient): Promise<boolean> {
    if (!c.observer) return false;
    const decide = () =>
      observerKeepAliveDecision({
        observer: c.observer,
        pureKeepAlive: isPureKeepAlive({
          isRunning: c.local.running,
          isFreshStart: false,
          sessionEstablished: c.established,
          lastServerDetails: c.lastServerTarget
            ? simDetails(c.lastServerTarget)
            : null,
          local: simDetails(c.local.target),
          hasUnsyncedSelection: !!c.unsynced,
        }),
        ownerSeenAt: c.ownerSeenAt,
        now: this.nowOf(c),
      });
    const decision = decide();
    if (decision === "skip") {
      c.skippedKeepAlives++;
      this.log(`${c.spec.id} keep-alive sprunget over (observatør)`);
      return true;
    }
    if (decision === "check-owner") {
      await this.reconcile(c);
      if (decide() !== "check-owner") return true;
      this.log(`${c.spec.id} ejeren er væk — genoptager keep-alive`);
      c.observer = false;
    }
    return false;
  }

  async switchTarget(i: number, key: TargetKey, lost: boolean) {
    return this.serial(() => this.switchUnguarded(i, key, lost));
  }

  private async switchUnguarded(i: number, key: TargetKey, lost: boolean) {
    const c = this.clients[i];
    if (!c.local.running || c.pending || c.local.target === key) return;
    // K5 (#787): et kundeskift fra en forældet visning (extension uden versionstjek)
    // lander på den session der kører NU — også når det er en anden. Undgås:
    // se serveren først. Web er rettet (fase 1): skiftet bærer sessionId og
    // lander kun på fanens egen session. Extension 2.6.0 er rettet (fase 2).
    // Mobil og extension 2.5.x: undgås.
    if (this.avoidKnownBugs && !this.sessionAware(c)) {
      await this.reconcile(c);
      if (!c.local.running || c.pending || c.local.target === key) return;
      // K6 (#787): skrivninger fra extensionen og fra andre web-faner/enheder (samme
      // kilde) blokeres ikke af et igangværende stop
      const row = await readTimerRow(this.fx.userId);
      if (row?.intent === "stopping") return;
    }
    const prev = c.local;
    const explicit: Explicit = {
      starts: [c.local.segStart, c.local.sessionStart],
      key,
    };
    c.local = { ...c.local, target: key };
    const t = this.target(key);
    if (c.spec.kind === "web") {
      c.unsynced = explicit;
      return this.webSync(c, this.webSyncPayload(c), lost, explicit);
    }
    if (c.spec.kind === "mobile") {
      // timetrack-app updateTimerOnServer. Ny app: læs serveren, rør kun
      // vores egen session, og send sessionId + version + start (sessionGuard).
      // Build 4/5: heartbeat uden versions-/sessionstjek.
      let guard: Record<string, unknown> = { expectedVersion: undefined };
      if (!c.spec.legacy) {
        const s = await this.call(`${c.spec.id} getState`, false, () =>
          this.apiFor(c).timerSync.getStateWithVersion(),
        );
        if (s === LOST || s instanceof TRPCError) {
          c.local = prev;
          return;
        }
        const server = s as ServerState;
        if (!this.isMobileSession(c, server)) {
          c.local = prev;
          await this.reconcile(c);
          return;
        }
        if (!c.sessionId) c.sessionId = server.sessionId ?? null;
        guard = {
          expectedVersion: server.version,
          expectedStartTime: c.local.segStart ?? undefined,
          ...(c.sessionId ? { sessionId: c.sessionId } : {}),
        };
      }
      const payload = this.webSyncPayload(c, {
        isFreshStart: false,
        isAdoption: false,
        ...guard,
      });
      c.history.push({ via: "sync", payload });
      const res = await this.call(
        `${c.spec.id} update`,
        lost,
        () => this.apiFor(c).timerSync.sync(payload as never),
        (r) => {
          if ((r as { success: boolean }).success) {
            this.recordExplicit(explicit.starts, explicit.key);
          }
        },
      );
      if (res === LOST || res instanceof TRPCError) return;
      const r = res as {
        success: boolean;
        version?: number;
        sessionId?: string | null;
      };
      if (r.success && r.version !== undefined) c.knownVersion = r.version;
      if (r.success && !c.spec.legacy && r.sessionId) c.sessionId = r.sessionId;
      if (!r.success) await this.reconcile(c);
      return;
    }
    return this.extUpdate(
      c,
      { projectId: t.projectId, clientId: t.clientId },
      lost,
      prev,
      explicit,
    );
  }

  async pause(i: number, lost: boolean) {
    return this.serial(() => this.pauseUnguarded(i, lost));
  }

  private async pauseUnguarded(i: number, lost: boolean) {
    const c = this.clients[i];
    if (!c.local.running || c.pending || c.spec.kind === "mobile") return;
    // K6 (#787): extensionens skrivninger midt i et stop. Web er rettet
    // (fase 1), extension 2.6.0 (fase 2): en sessionsbevidst skrivning
    // afvises under et stop.
    if (this.avoidKnownBugs && !this.sessionAware(c)) {
      // K5 (#787, fase 2): en pause fra extensionens forældede visning (uden
      // session/version) lander på den session der kører NU og lægger den
      // gamle sessions tid på den. Undgås: se serveren først.
      await this.reconcile(c);
      if (!c.local.running || c.pending) return;
      const row = await readTimerRow(this.fx.userId);
      if (row?.intent === "stopping") return; // K6
    }
    const elapsed = this.elapsedSec(c, this.nowOf(c));
    const prev = c.local;
    c.local = {
      ...c.local,
      running: false,
      paused: true,
      segStart: null,
      baseSec: elapsed,
    };
    if (c.spec.kind === "web")
      return this.webSync(c, this.webSyncPayload(c), lost);
    return this.extUpdate(
      c,
      {
        isRunning: false,
        startTime: null,
        baseSeconds: elapsed,
        elapsedSeconds: elapsed,
      },
      lost,
      prev,
    );
  }

  async resume(i: number, lost: boolean) {
    const c = this.clients[i];
    if (!c.local.paused || c.pending || !c.local.target) return;
    return this.startGuarded(
      () => this.resumeUnguarded(c, lost),
      this.startsWithKey(c),
    );
  }

  private async resumeUnguarded(c: SimClient, lost: boolean) {
    if (!c.local.paused || c.pending || !c.local.target) return;
    const t = this.nowOf(c);
    const prev = c.local;
    const explicit: Explicit = { starts: [t], key: c.local.target };
    c.local = { ...c.local, running: true, paused: false, segStart: t };
    if (c.spec.kind === "web") {
      // Overgangen ikke-kørende → kørende sendes som fresh start (useTimerSync)
      c.established = false;
      return this.webSync(c, this.webSyncPayload(c), lost, explicit);
    }
    return this.extUpdate(
      c,
      {
        isRunning: true,
        startTime: new Date(t).toISOString(),
        baseSeconds: c.local.baseSec,
        elapsedSeconds: c.local.baseSec,
      },
      lost,
      prev,
      explicit,
    );
  }

  /** Web: "Fortsæt" på seneste post — ny session, der gemmes ind i posten. */
  async continueEntry(i: number, lost: boolean) {
    const c = this.clients[i];
    if (c.spec.kind !== "web" || c.local.running || c.local.paused || c.pending)
      return;
    const entries = await readEntries(this.fx.userId);
    const latest = entries
      .filter((e) => e.projectId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    if (!latest) return;
    const key = this.keyForProject(latest.projectId);
    if (!key) return;
    return this.startGuarded(async () => {
      this.log(`${c.spec.id} fortsætter post ${latest.id.slice(0, 8)}`);
      await this.webStart(c, key, false, lost, {
        entryId: latest.id,
        hours: Number(latest.hours),
        date: new Date(latest.date).toISOString().slice(0, 10),
      });
    }, true);
  }

  async reconcile(c: SimClient, depth = 0) {
    if (c.spec.kind === "ext") {
      const res = await this.call(`${c.spec.id} getTimerState`, false, () =>
        this.extApi(c).extension.getTimerStateWithVersion({
          token: this.fx.token,
        }),
      );
      if (res === LOST || res instanceof TRPCError) return;
      this.mirror(c, res as never);
      return;
    }
    const res = await this.call(`${c.spec.id} getState`, false, () =>
      this.apiFor(c).timerSync.getStateWithVersion(),
    );
    if (res === LOST || res instanceof TRPCError) return;
    const s = res as ServerState;
    if (
      c.observer &&
      sawOwnerActivity({
        prevVersion: c.knownVersion,
        version: s.version,
        prevLastSyncedAt: null,
        lastSyncedAt: null,
      })
    ) {
      c.ownerSeenAt = this.nowOf(c);
    }
    c.knownVersion = s.version;
    if (c.pending) return; // gem-dialogen er åben
    const sStart = s.startTime ? new Date(s.startTime).getTime() : null;
    const sKey =
      this.keyForClientId(s.clientId) ?? this.keyForProject(s.projectId);
    if (c.spec.kind === "mobile") {
      const running = !!s.isRunning && sStart !== null;
      c.local = running
        ? {
            ...IDLE,
            running: true,
            segStart: sStart,
            sessionStart: sStart,
            baseSec: s.baseSeconds,
            target: sKey,
          }
        : { ...IDLE };
      // Ny app: serverToLocal husker sessionens id
      if (!c.spec.legacy) c.sessionId = running ? (s.sessionId ?? null) : null;
      return;
    }
    // Timer-sessioner (useTimerSync): er vores session afsluttet/afløst et
    // andet sted, droppes den lokale kopi — aldrig genoplivet.
    const sSession = s.sessionId ?? null;
    if (c.sessionId && s.intent !== "stopping" && sSession !== c.sessionId) {
      c.local = { ...IDLE };
      c.sessionId = null;
      c.startOpId = null;
      c.established = false;
    } else if (
      !c.sessionId &&
      c.local.running &&
      sSession &&
      s.isRunning &&
      s.intent !== "stopping" &&
      sStart !== null &&
      c.local.segStart !== null &&
      Math.abs(sStart - c.local.segStart) <= 1_000
    ) {
      // Vores egen start landede (svaret gik tabt): overtag sessionen
      c.sessionId = sSession;
      c.startOpId = null;
      c.established = true;
    }
    if (s.intent === "stopping" && s.intentFrom !== "web") return;
    if (s.isRunning && sStart !== null) {
      c.lastServerTarget = sKey;
      if (
        c.local.running &&
        (c.local.segStart === sStart ||
          (!!c.sessionId && c.sessionId === sSession))
      ) {
        // Samme session: serverens detaljer vinder (afstemning/mirror) —
        // undtagen et lokalt valg, der endnu ikke er synket
        // (shouldHoldUnsyncedSelection)
        const hold =
          !!c.unsynced &&
          c.local.target === c.unsynced.key &&
          sKey !== c.unsynced.key;
        c.local = { ...c.local, target: hold ? c.local.target : sKey };
        c.established = true;
        return;
      }
      c.local = {
        ...IDLE,
        running: true,
        segStart: sStart,
        sessionStart: sStart,
        baseSec: s.baseSeconds,
        target: sKey,
      };
      c.sessionId = sSession;
      c.startOpId = null;
      c.adoptNext = true;
      c.established = true;
      // useTimerSync: isRunning-effekten sender adoptionen straks
      await this.webSync(c, this.webSyncPayload(c), false, undefined, depth);
      return;
    }
    if ((s.baseSeconds ?? 0) > 0 || (s.elapsedSeconds ?? 0) > 0) {
      c.local = {
        ...IDLE,
        paused: true,
        baseSec: Math.max(s.baseSeconds, s.elapsedSeconds),
        target: sKey,
      };
      c.sessionId = sSession;
      return;
    }
    c.local = { ...IDLE };
    c.sessionId = null;
    c.startOpId = null;
    c.established = false;
  }

  async reconcileCmd(i: number) {
    return this.reconcile(this.clients[i]);
  }

  /** Begynd et stop (web: claim → gem-dialog; ext/mobil: hele flowet). */
  async stop(
    i: number,
    lostClaim: boolean,
    lostCreate: boolean,
    lostConfirm: boolean,
    saveNow = false,
    /** extension: popup'en lukkes lige efter claim (write-ahead-køen tager over) */
    closed = false,
    /**
     * extension: alle gem-forsøg når aldrig serveren (timeout) — udfaldet er
     * usikkert, og gemmet ligger i køen (saveWithRetry → "unconfirmed")
     */
    uncertain = false,
  ) {
    const c = this.clients[i];
    if (!(c.local.running || c.local.paused) || c.pending) return;
    // K2/K6: et stop afgøres ikke samtidig med en start/genoptag
    return this.serial(async () => {
      await this.stopUnguarded(
        c,
        lostClaim,
        lostCreate,
        lostConfirm,
        closed,
        uncertain,
      );
      // Web: brugeren trykker "Gem" i dialogen med det samme
      if (saveNow && c.pending) await this.save(i, lostCreate, lostConfirm);
    });
  }

  private async stopUnguarded(
    c: SimClient,
    lostClaim: boolean,
    lostCreate: boolean,
    lostConfirm: boolean,
    closed = false,
    uncertain = false,
  ) {
    if (!(c.local.running || c.local.paused) || c.pending) return;
    if (c.spec.kind === "ext")
      return this.extStop(
        c,
        lostClaim,
        lostCreate,
        lostConfirm,
        closed,
        uncertain,
      );
    if (c.spec.kind === "mobile")
      return this.mobileStop(c, lostClaim, lostCreate);

    await this.drainWebQueue(c);
    // web: refetch version lige før claim (useTimerSync.claimTimerForStop)
    const fresh = await this.call(`${c.spec.id} getState`, false, () =>
      this.apiFor(c).timerSync.getStateWithVersion(),
    );
    if (fresh !== LOST && !(fresh instanceof TRPCError)) {
      const f = fresh as ServerState;
      c.knownVersion = f.version;
      // useTimerSync.claimTimerForStop: en start hvis svar gik tabt, men som
      // landede, får sit id fra den friske tilstand
      const fStart = f.startTime ? new Date(f.startTime).getTime() : null;
      if (
        !c.sessionId &&
        c.local.running &&
        f.isRunning &&
        f.sessionId &&
        fStart !== null &&
        c.local.segStart !== null &&
        Math.abs(fStart - c.local.segStart) <= 1_000
      ) {
        c.sessionId = f.sessionId;
      }
    }
    // #788: claimet bærer fanens session — en forældet fane kan ikke længere
    // claime en ANDEN session
    const claim = await this.call(`${c.spec.id} claimForStop`, lostClaim, () =>
      this.apiFor(c).timerSync.claimForStop({
        expectedVersion: c.knownVersion,
        source: "web",
        sessionId: c.sessionId ?? undefined,
        sessionOpId: !c.sessionId && c.startOpId ? c.startOpId : undefined,
      }),
    );
    if (claim === LOST || claim instanceof TRPCError) return;
    const r = claim as {
      success: boolean;
      reason?: string;
      version?: number;
      sessionId?: string | null;
      session?: { projectId: string | null; clientId: string | null };
    };
    if (r.version !== undefined) c.knownVersion = r.version;
    if (!r.success) {
      if (r.reason === "session_mismatch") {
        c.local = { ...IDLE };
        c.sessionId = null;
        c.startOpId = null;
        c.established = false;
      }
      await this.reconcile(c);
      return;
    }
    // #785: gem-dialogen bygger på sessionens øjebliksbillede fra claimet
    if (r.sessionId) {
      c.sessionId = r.sessionId;
      c.startOpId = null;
    }
    const snapKey = r.session
      ? (this.keyForClientId(r.session.clientId) ??
        this.keyForProject(r.session.projectId))
      : null;
    if (snapKey) c.local = { ...c.local, target: snapKey };
    const end = this.nowOf(c);
    const target = c.local.target;
    if (!target) {
      // Intet mål at gemme på — brugeren annullerer dialogen
      await this.cancelSave(this.clients.indexOf(c), false);
      return;
    }
    c.pending = {
      startMs: c.local.sessionStart ?? end - this.elapsedSec(c, end) * 1000,
      endMs: end,
      activeSec: this.elapsedSec(c, end),
      target,
      continuing: c.local.continuing,
      serverStarts: await this.claimedStarts(c),
    };
  }

  /** Web: brugeren trykker "Gem" i dialogen. */
  async save(
    i: number,
    lostCreate: boolean,
    lostConfirm: boolean,
    opts: {
      /** Kør noget mellem posten og confirm (fx en anden klients skrivning) */
      between?: () => Promise<void>;
      /** Fanen dør efter posten — confirm når aldrig frem */
      abandonBeforeConfirm?: boolean;
    } = {},
  ) {
    const c = this.clients[i];
    const p = c.pending;
    if (!p || c.spec.kind !== "web") return;
    const t = this.target(p.target);
    let res: unknown;
    if (p.continuing) {
      const cont = p.continuing;
      const hours = Math.max(0.01, round2(cont.hours + p.activeSec / 3600));
      res = await this.call(
        `${c.spec.id} time.update(fortsæt)`,
        lostCreate,
        () =>
          this.apiFor(c).time.update({
            id: cont.entryId,
            data: {
              projectId: t.projectId,
              description: "Timer",
              hours,
              date: cont.date,
              endTime: new Date(p.endMs).toISOString(),
              fromTimer: true,
              timerSessionId: c.sessionId ?? undefined,
            },
          }),
        () => this.noteSaved(p),
      );
    } else {
      if (c.saveKey.session !== p.startMs || !c.saveKey.key) {
        c.saveKey = { session: p.startMs, key: randomUUID() };
      }
      const key = c.saveKey.key;
      const hours = Math.max(0.01, round2(p.activeSec / 3600));
      res = await this.call(
        `${c.spec.id} time.create`,
        lostCreate,
        () =>
          this.apiFor(c).time.create({
            projectId: t.projectId,
            description: "Timer",
            hours,
            date: isoDate(p.startMs),
            startTime: new Date(p.startMs).toISOString(),
            endTime: new Date(
              Math.max(p.endMs, p.startMs + 1000),
            ).toISOString(),
            fromTimer: true,
            prepaidPackageId: t.prepaidPackageId ?? undefined,
            clientEntryId: key,
            timerSessionId: c.sessionId ?? undefined,
          }),
        () => this.noteSaved(p),
      );
    }
    if (res === LOST || res instanceof TRPCError) return; // dialogen bliver stående
    if (opts.between) await opts.between();
    if (opts.abandonBeforeConfirm) {
      this.log(`${c.spec.id} fanen lukkes før confirm`);
      c.local = { ...IDLE };
      c.sessionId = null;
      c.startOpId = null;
      c.pending = undefined;
      c.established = false;
      return;
    }
    await this.webConfirm(c, lostConfirm);
    c.local = { ...IDLE };
    c.sessionId = null;
    c.startOpId = null;
    c.saveKey = { session: null };
    c.pending = undefined;
    c.established = false;
    c.adoptNext = false;
  }

  private async webConfirm(c: SimClient, lostFirst: boolean) {
    let version = c.knownVersion;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.call(
        `${c.spec.id} confirmStop`,
        lostFirst && attempt === 0,
        () =>
          this.apiFor(c).timerSync.confirmStop({
            version,
            source: "web",
            sessionId: c.sessionId ?? undefined,
          }),
      );
      if (res === LOST || res instanceof TRPCError) return;
      const r = res as { success: boolean; reason?: string; version?: number };
      if (r.success) {
        if (r.version !== undefined) c.knownVersion = r.version;
        return;
      }
      if (r.reason === "version_mismatch" && typeof r.version === "number") {
        version = r.version;
        continue;
      }
      return;
    }
  }

  /** Web: brugeren annullerer gem-dialogen — timeren kører videre. */
  async cancelSave(i: number, lost: boolean) {
    const c = this.clients[i];
    if (!c.pending || c.spec.kind !== "web") return;
    // #783 rettet: annullér efter et gem der landede (svaret tabt) afvises
    // med already_saved — sessionen er slut, timeren nulstilles
    const res = await this.call(`${c.spec.id} cancelStop`, lost, () =>
      this.apiFor(c).timerSync.cancelStop({
        version: c.knownVersion,
        source: "web",
        sessionId: c.sessionId ?? undefined,
      }),
    );
    c.pending = undefined;
    if (res === LOST || res instanceof TRPCError) return;
    const r = res as { success: boolean; reason?: string; version?: number };
    if (r.version !== undefined) c.knownVersion = r.version;
    if (!r.success && r.reason === "already_saved") {
      c.local = { ...IDLE };
      c.sessionId = null;
      c.startOpId = null;
      c.established = false;
    }
  }

  /** Web: fanen genindlæses (evt. med åben gem-dialog → cancelStopOnUnload). */
  async reload(i: number) {
    const c = this.clients[i];
    if (c.spec.kind !== "web") return this.reconcile(c);
    if (c.pending) {
      // cancelStopOnUnload (keepalive) — med sessionen; et landet gem giver
      // already_saved, og serveren rydder rækken (#783)
      await this.call(`${c.spec.id} cancelStop(unload)`, false, () =>
        this.apiFor(c).timerSync.cancelStop({
          version: c.knownVersion,
          source: "web",
          sessionId: c.sessionId ?? undefined,
        }),
      );
      c.pending = undefined;
    }
    // timerStore (inkl. sessionId og startOpId) persisteres i localStorage
    c.saveKey = { session: null };
    c.established = false;
    c.adoptNext = false;
    c.knownVersion = 0;
    c.local = { ...c.local, continuing: undefined };
    // Montering afstemmer med serveren FØR noget sendes (pendingMountReconcile)
    await this.reconcile(c);
  }

  /**
   * Web-offline-køen (#703): en køet start hvis svar gik tabt, gentages med
   * SAMME clientOpId. Køen tømmes før fanen skriver noget andet
   * (shouldQueueTimerWrites), og når forbindelsen kommer igen.
   */
  async replay(i: number) {
    await this.drainWebQueue(this.clients[i]);
  }

  private async drainWebQueue(c: SimClient) {
    const queue = c.webQueue.splice(0);
    for (const payload of queue) {
      await this.call(`${c.spec.id} kø: gensendt start`, false, () =>
        this.apiFor(c).timerSync.sync(payload as never),
      );
    }
  }

  /** Extensionens write-ahead-kø / appens stop-journal afspilles. */
  async flushQueue(i: number) {
    const c = this.clients[i];
    if (c.spec.kind === "mobile") return this.finishMobileJournal(c);
    const queue = c.extQueue.splice(0);
    for (const item of queue) {
      if (item.type === "create") {
        const starts = item.serverStarts;
        await this.call(
          `${c.spec.id} kø: createTimeEntry`,
          false,
          () => this.extApi(c).extension.createTimeEntry(item.payload as never),
          () => this.noteSaved({ serverStarts: starts }),
        );
        continue;
      }
      await this.call(`${c.spec.id} kø: confirmStop`, false, () =>
        this.extApi(c).extension.confirmStop({
          token: this.fx.token,
          version: item.version,
          source: "extension",
          sessionId: item.sessionId,
        }),
      );
    }
  }

  // ── extension ────────────────────────────────────────────────────────

  private mirror(c: SimClient, s: ServerState) {
    c.knownVersion = s.version;
    const sStart = s.startTime ? new Date(s.startTime).getTime() : null;
    const key =
      this.keyForClientId(s.clientId) ?? this.keyForProject(s.projectId);
    if (this.sessionAware(c)) {
      // 2.6.0: serverens session huskes (timer-session.ts), og en række
      // midt i et stop vises som stoppende — ikke som en timer man kan
      // arbejde videre på (fetchTimerState)
      c.sessionId = s.sessionId ?? null;
      if (s.intent === "stopping") {
        c.local = { ...IDLE };
        return;
      }
    }
    if (s.isRunning && sStart !== null) {
      c.local = {
        ...IDLE,
        running: true,
        segStart: sStart,
        sessionStart: sStart,
        baseSec: s.baseSeconds ?? 0,
        target: key,
      };
    } else if ((s.baseSeconds ?? 0) > 0 || (s.elapsedSeconds ?? 0) > 0) {
      c.local = {
        ...IDLE,
        paused: true,
        baseSec: Math.max(s.baseSeconds ?? 0, s.elapsedSeconds ?? 0),
        target: key,
      };
    } else {
      c.local = { ...IDLE };
    }
  }

  /**
   * timerStore skriver via `apiClient` (ikke offline-køen): et tabt svar er
   * en fejl i popup'en, og den lokale tilstand forbliver den forrige, indtil
   * næste afstemning (alarm-poll) henter serverens.
   */
  private async extUpdate(
    c: SimClient,
    fields: Record<string, unknown>,
    lost: boolean,
    prev: Local,
    explicit?: Explicit,
  ) {
    // 2.6.0: alle skrivninger bærer sessionen (sessionField); en frisk
    // start bærer i stedet en idempotensnøgle (clientOpId)
    const aware = this.sessionAware(c);
    const payload = {
      token: this.fx.token,
      source: "extension",
      ...(aware && c.sessionId && !fields.clientOpId
        ? { sessionId: c.sessionId }
        : {}),
      ...fields,
    };
    const res = await this.call(
      `${c.spec.id} updateTimerState`,
      lost,
      () => this.extApi(c).extension.updateTimerState(payload as never),
      (r) => {
        const st = r as {
          clientId: string | null;
          startTime?: string | null;
          sessionMismatch?: boolean;
          stoppingInProgress?: boolean;
          startRejected?: string | null;
          deduplicated?: boolean;
        };
        const landed =
          !st.sessionMismatch &&
          !st.stoppingInProgress &&
          !st.startRejected &&
          !st.deduplicated;
        if (
          explicit &&
          landed &&
          st.clientId === this.target(explicit.key).clientId
        ) {
          // 2.6.0: skrivningen landede kun, fordi den bar SESSIONENS id — så
          // valget gælder sessionens nuværende segment, også når en anden
          // instans har pauset/genoptaget den siden (ny segmentstart)
          const seg =
            aware && st.startTime ? new Date(st.startTime).getTime() : null;
          this.recordExplicit([...explicit.starts, seg], explicit.key);
        }
      },
    );
    if (res === LOST) {
      c.local = prev;
      return;
    }
    if (res instanceof TRPCError) {
      await this.reconcile(c);
      return;
    }
    this.mirror(c, res as never);
  }

  private async extStart(c: SimClient, key: TargetKey, lost: boolean) {
    const t = this.nowOf(c);
    const tg = this.target(key);
    const prev = c.local;
    c.local = {
      ...IDLE,
      running: true,
      segStart: t,
      sessionStart: t,
      target: key,
    };
    return this.extUpdate(
      c,
      {
        isRunning: true,
        startTime: new Date(t).toISOString(),
        elapsedSeconds: 0,
        baseSeconds: 0,
        projectId: tg.projectId,
        clientId: tg.clientId,
        description: "",
        isFreshStart: true,
        // 2.6.0 (#784): idempotensnøgle — en afvist start adopterer
        // serverens tilstand (mirror) i stedet for at overskrive den
        ...(this.sessionAware(c) ? { clientOpId: randomUUID() } : {}),
      },
      lost,
      prev,
      { starts: [t], key },
    );
  }

  /**
   * Extension 2.6.0: "Stop timer" fra en notifikation (baggrundens
   * extension.quickStop) — med den session baggrunden sidst så.
   */
  async quickStop(i: number, lost: boolean) {
    const c = this.clients[i];
    if (c.spec.kind !== "ext" || !this.sessionAware(c) || !c.sessionId) return;
    return this.serial(async () => {
      if (!c.sessionId) return;
      const row = await readTimerRow(this.fx.userId);
      const rowStart =
        row?.isRunning && row.startTime ? row.startTime.getTime() : null;
      // Sessionens segment-starter, hvis det er den session der stoppes
      const serverStarts =
        rowStart !== null && row?.currentSessionId === c.sessionId
          ? [...new Set([...this.currentServerStarts, rowStart])]
          : [];
      const sessionId = c.sessionId;
      await this.call(
        `${c.spec.id} quickStop(notifikation)`,
        lost,
        () =>
          this.extApi(c).extension.quickStop({
            token: this.fx.token,
            saveEntry: true,
            sessionId,
          }),
        (r) => {
          if ((r as { savedEntryId?: string | null }).savedEntryId) {
            this.noteSaved({ serverStarts });
          }
        },
      );
      // syncTimerState efter stoppet
      await this.reconcile(c);
    });
  }

  private async extStop(
    c: SimClient,
    lostClaim: boolean,
    lostCreate: boolean,
    lostConfirm: boolean,
    closed = false,
    uncertain = false,
  ) {
    const display = this.elapsedSec(c, this.nowOf(c));
    if (display <= 0) return;
    // 2.6.0: claim, post og confirm bærer sessionen
    const aware = this.sessionAware(c);
    const ownSession = aware ? (c.sessionId ?? undefined) : undefined;
    const claim = await this.call(`${c.spec.id} claimForStop`, lostClaim, () =>
      this.extApi(c).extension.claimForStop({
        token: this.fx.token,
        expectedVersion: c.knownVersion,
        source: "extension",
        sessionId: ownSession,
      }),
    );
    if (claim === LOST || claim instanceof TRPCError) return;
    const r = claim as {
      success: boolean;
      reason?: string;
      version?: number;
      sessionId?: string | null;
      session?: { projectId: string | null; clientId: string | null };
    };
    if (r.version !== undefined) c.knownVersion = r.version;
    if (!r.success) {
      c.local = { ...IDLE };
      // 2.6.0: vis serverens timer (session_mismatch, stop i gang …)
      if (aware) await this.reconcile(c);
      return;
    }
    const sessionId = aware ? (r.sessionId ?? ownSession) : undefined;
    // 2.6.0 (#785): posten gemmes på sessionens øjebliksbillede fra claimet
    const snapKey =
      aware && r.session
        ? (this.keyForClientId(r.session.clientId) ??
          this.keyForProject(r.session.projectId))
        : null;
    const target = snapKey ?? c.local.target;
    const serverStarts = await this.claimedStarts(c);
    const end = this.nowOf(c);
    const tg = target ? this.target(target) : null;
    const payload = {
      token: this.fx.token,
      projectId: tg?.projectId,
      clientId: tg?.clientId,
      hours: Math.max(0.01, display / 3600),
      description: "Timer fra extension",
      date: isoDate(end),
      startTime: new Date(end - display * 1000).toISOString(),
      endTime: new Date(end).toISOString(),
      clientEntryId: randomUUID(),
      prepaidPackageId: tg?.prepaidPackageId ?? null,
      ...(sessionId ? { timerSessionId: sessionId } : {}),
    };
    if (closed) {
      // Write-ahead: gem + bekræft ligger i køen FØR netværkskaldet; popup'en
      // lukkes, og baggrunden afspiller dem senere med samme clientEntryId.
      c.extQueue.push({ type: "create", payload, serverStarts });
      c.extQueue.push({ type: "confirm", version: c.knownVersion, sessionId });
      this.log(`${c.spec.id} popup lukket efter claim — gem ligger i køen`);
      return;
    }
    if (uncertain) {
      // saveWithRetry → "unconfirmed": ingen af forsøgene nåede serveren.
      // Gemmet frigives til køen med samme nøgle. 2.6.0 (review P1):
      // bekræftelsen af stoppet ligger i køen BAG gemmet og afspilles først,
      // når gemmet er landet. 2.5.x bekræfter straks.
      this.log(
        `${c.spec.id} gem usikkert (3 × timeout) — gemmet ligger i køen`,
      );
      c.extQueue.push({ type: "create", payload, serverStarts });
      if (aware) {
        c.extQueue.push({
          type: "confirm",
          version: c.knownVersion,
          sessionId,
        });
        c.local = { ...IDLE };
        c.sessionId = null;
        return;
      }
    }
    // saveWithRetry: et usikkert udfald gentages med SAMME nøgle
    let saved = uncertain;
    for (let attempt = 0; attempt < 3 && !saved; attempt++) {
      const res = await this.call(
        `${c.spec.id} createTimeEntry`,
        lostCreate && attempt === 0,
        () => this.extApi(c).extension.createTimeEntry(payload as never),
        () => this.noteSaved({ serverStarts }),
      );
      if (res === LOST) continue;
      if (res instanceof TRPCError) {
        // sikker afvisning → annullér stoppet, timeren kører videre
        const cancel = await this.call(`${c.spec.id} cancelStop`, false, () =>
          this.extApi(c).extension.cancelStop({
            token: this.fx.token,
            version: c.knownVersion,
            source: "extension",
            sessionId,
          }),
        );
        if (
          aware &&
          cancel !== LOST &&
          !(cancel instanceof TRPCError) &&
          (cancel as { reason?: string }).reason === "already_saved"
        ) {
          // Sessionen ER gemt — serveren har afsluttet stoppet
          c.local = { ...IDLE };
          c.sessionId = null;
          return;
        }
        await this.reconcile(c);
        return;
      }
      saved = true;
    }
    let version = c.knownVersion;
    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await this.call(
        `${c.spec.id} confirmStop`,
        lostConfirm && attempt === 0,
        () =>
          this.extApi(c).extension.confirmStop({
            token: this.fx.token,
            version,
            source: "extension",
            sessionId,
          }),
      );
      if (res === LOST) {
        c.extQueue.push({ type: "confirm", version, sessionId });
        break;
      }
      if (res instanceof TRPCError) break;
      const cr = res as { success: boolean; reason?: string; version?: number };
      if (cr.success && cr.version !== undefined) c.knownVersion = cr.version;
      if (cr.reason === "version_mismatch" && typeof cr.version === "number") {
        version = cr.version;
        continue;
      }
      break;
    }
    c.local = { ...IDLE };
    if (aware) c.sessionId = null;
  }

  // ── mobil (timetrack-app, Expo) ──────────────────────────────────────

  /** Kører serveren den session, appen viser? (isServerSession) */
  private isMobileSession(c: SimClient, s: ServerState): boolean {
    const sStart = s.startTime ? new Date(s.startTime).getTime() : null;
    if (
      !s.isRunning ||
      s.intent === "stopping" ||
      sStart === null ||
      c.local.segStart === null ||
      Math.abs(sStart - c.local.segStart) > 1_000
    ) {
      return false;
    }
    const serverId = s.sessionId ?? null;
    return !serverId || !c.sessionId || serverId === c.sessionId;
  }

  private async mobileStart(c: SimClient, key: TargetKey, lost: boolean) {
    const s = await this.call(`${c.spec.id} getState`, false, () =>
      this.apiFor(c).timerSync.getStateWithVersion(),
    );
    if (s === LOST || s instanceof TRPCError) return;
    // Ny app: et uafsluttet stop blokerer starten (recoverPendingStop)
    if (!c.spec.legacy && (s as ServerState).intent === "stopping") return;
    if ((s as ServerState).startTime) {
      await this.reconcile(c); // adopter serverens timer
      return;
    }
    const t = this.nowOf(c);
    const tg = this.target(key);
    const payload = {
      isRunning: true,
      startTime: t,
      sessionStartTime: t,
      elapsedSeconds: 0,
      baseSeconds: 0,
      projectId: tg.projectId,
      clientId: tg.clientId,
      taskId: null,
      description: "",
      source: "web" as const,
      isFreshStart: true,
      isAdoption: false,
    };
    c.history.push({ via: "sync", payload });
    const res = await this.call(
      `${c.spec.id} sync(start)`,
      lost,
      () => this.apiFor(c).timerSync.sync(payload as never),
      (r) => {
        if ((r as { success: boolean }).success) this.recordExplicit([t], key);
      },
    );
    if (res === LOST || res instanceof TRPCError) return;
    const r = res as {
      success: boolean;
      reason?: string;
      version?: number;
      sessionId?: string | null;
    };
    if (r.success) {
      c.local = {
        ...IDLE,
        running: true,
        segStart: t,
        sessionStart: t,
        target: key,
      };
      if (r.version !== undefined) c.knownVersion = r.version;
      if (!c.spec.legacy) c.sessionId = r.sessionId ?? null;
      return;
    }
    await this.reconcile(c);
  }

  private async mobileStop(
    c: SimClient,
    lostClaim: boolean,
    lostCreate: boolean,
  ) {
    if (!c.spec.legacy)
      return this.mobileStopSessions(c, lostClaim, lostCreate);
    // Build 4/5 —
    // K1 (#783): appen kalder cancelStop ved ENHVER fejl på time.create — også når
    // posten landede og kun svaret gik tabt. Serveren gemmer posten med den
    // session appen stopper, så cancelStop afvises som already_saved.
    // K3 (#785): appen gemmer sin LOKALE session (start/projekt), ikke den session
    // den lige har claimet på serveren. Serveren bruger sessionens projekt/kunde.
    if (!c.local.running || c.local.segStart === null || !c.local.target)
      return;
    const s = await this.call(`${c.spec.id} getState`, false, () =>
      this.apiFor(c).timerSync.getStateWithVersion(),
    );
    if (s === LOST || s instanceof TRPCError) return;
    const server = s as ServerState;
    if (!server.isRunning || !server.startTime) {
      c.local = { ...IDLE }; // stopped_elsewhere
      return;
    }
    const claim = await this.call(`${c.spec.id} claimForStop`, lostClaim, () =>
      this.apiFor(c).timerSync.claimForStop({
        expectedVersion: server.version,
        source: "web",
      }),
    );
    if (claim === LOST || claim instanceof TRPCError) return;
    const r = claim as { success: boolean; version: number };
    if (!r.success) return;
    const serverStarts = await this.claimedStarts(c);
    const end = this.nowOf(c);
    const elapsed = this.elapsedSec(c, end);
    const tg = this.target(c.local.target);
    const res = await this.call(
      `${c.spec.id} time.create`,
      lostCreate,
      () =>
        this.apiFor(c).time.create({
          projectId: tg.projectId,
          clientId: tg.clientId,
          description: "Timer fra app",
          date: isoDate(c.local.segStart as number),
          hours: Math.max(0.01, round2(elapsed / 3600)),
          startTime: new Date(c.local.segStart as number).toISOString(),
          endTime: new Date(
            Math.max(end, (c.local.segStart as number) + 1000),
          ).toISOString(),
          fromTimer: true,
        }),
      () => this.noteSaved({ serverStarts }),
    );
    if (res === LOST || res instanceof TRPCError) {
      await this.call(`${c.spec.id} cancelStop`, false, () =>
        this.apiFor(c).timerSync.cancelStop({
          version: r.version,
          source: "web",
        }),
      );
      return;
    }
    await this.call(`${c.spec.id} confirmStop`, false, () =>
      this.apiFor(c).timerSync.confirmStop({
        version: r.version,
        source: "web",
      }),
    );
    c.local = { ...IDLE };
  }

  /**
   * Appen fra timetrack-app#18 (stopTimerOnServer → finishStop): claim med
   * sessionId + version + start, posten bygges ud fra claimets
   * øjebliksbillede (#785) med `timerSessionId`, et tabt svar på
   * time.create frigiver IKKE claimet (#783) — journalen gør stoppet
   * færdigt — og kun en sikker afvisning sender cancelStop.
   */
  private async mobileStopSessions(
    c: SimClient,
    lostClaim: boolean,
    lostCreate: boolean,
  ) {
    if (c.mobileJournal) {
      await this.finishMobileJournal(c);
      return;
    }
    if (!c.local.running || c.local.segStart === null) return;
    const s = await this.call(`${c.spec.id} getState`, false, () =>
      this.apiFor(c).timerSync.getStateWithVersion(),
    );
    if (s === LOST || s instanceof TRPCError) return;
    const server = s as ServerState;
    const cleared =
      !server.isRunning &&
      !(server.baseSeconds ?? 0) &&
      !(server.elapsedSeconds ?? 0) &&
      server.version > 0;
    if (cleared) {
      c.local = { ...IDLE }; // stopped_elsewhere
      c.sessionId = null;
      return;
    }
    if (server.intent === "stopping") return; // claim_failed (ikke vores)
    if (!this.isMobileSession(c, server)) {
      await this.reconcile(c); // session_changed
      return;
    }
    if (!c.sessionId) c.sessionId = server.sessionId ?? null;
    const claim = await this.call(`${c.spec.id} claimForStop`, lostClaim, () =>
      this.apiFor(c).timerSync.claimForStop({
        expectedVersion: server.version,
        source: "web",
        expectedStartTime: c.local.segStart ?? undefined,
        sessionId: c.sessionId ?? undefined,
      }),
    );
    if (claim === LOST || claim instanceof TRPCError) return;
    const r = claim as {
      success: boolean;
      reason?: string;
      version: number;
      sessionId?: string | null;
      session?: { projectId: string | null; clientId: string | null };
    };
    if (!r.success) {
      if (r.reason === "session_mismatch" || r.reason === "no_timer") {
        await this.reconcile(c);
      }
      return;
    }
    const sessionId = r.sessionId ?? c.sessionId ?? undefined;
    const snapKey = r.session
      ? (this.keyForClientId(r.session.clientId) ??
        this.keyForProject(r.session.projectId))
      : null;
    const key = snapKey ?? c.local.target;
    if (!key) return;
    const serverStarts = await this.claimedStarts(c);
    const end = this.nowOf(c);
    const elapsed = this.elapsedSec(c, end);
    const tg = this.target(key);
    const payload = {
      projectId: tg.projectId,
      clientId: tg.clientId,
      description: "Timer fra app",
      date: isoDate(c.local.segStart),
      hours: Math.max(0.01, round2(elapsed / 3600)),
      startTime: new Date(c.local.segStart).toISOString(),
      endTime: new Date(Math.max(end, c.local.segStart + 1000)).toISOString(),
      fromTimer: true,
      ...(sessionId ? { timerSessionId: sessionId } : {}),
    };
    c.local = { ...IDLE };
    c.sessionId = null;
    c.mobileJournal = { payload, serverStarts, version: r.version, sessionId };
    const res = await this.call(
      `${c.spec.id} time.create`,
      lostCreate,
      () => this.apiFor(c).time.create(payload as never),
      () => this.noteSaved({ serverStarts }),
    );
    // Tabt svar (mayHaveSaved): claimet bevares, journalen gør det færdigt
    if (res === LOST) return;
    if (res instanceof TRPCError) {
      c.mobileJournal = undefined;
      const cancel = await this.call(`${c.spec.id} cancelStop`, false, () =>
        this.apiFor(c).timerSync.cancelStop({
          version: r.version,
          source: "web",
          sessionId,
        }),
      );
      // already_saved: stoppet ER gennemført; ellers kører timeren videre
      if (
        cancel === LOST ||
        cancel instanceof TRPCError ||
        (cancel as { reason?: string }).reason !== "already_saved"
      ) {
        await this.reconcile(c);
      }
      return;
    }
    c.mobileJournal = undefined;
    await this.mobileConfirm(c, r.version, sessionId);
  }

  private async mobileConfirm(
    c: SimClient,
    version: number,
    sessionId?: string,
  ) {
    let next = version;
    for (let attempt = 0; attempt < 3; attempt++) {
      const res = await this.call(`${c.spec.id} confirmStop`, false, () =>
        this.apiFor(c).timerSync.confirmStop({
          version: next,
          source: "web",
          sessionId,
        }),
      );
      if (res === LOST || res instanceof TRPCError) return;
      const cr = res as { success: boolean; reason?: string; version?: number };
      if (cr.success) return;
      if (cr.reason === "version_mismatch" && typeof cr.version === "number") {
        next = cr.version;
        continue;
      }
      return;
    }
  }

  /**
   * Stop-journalen (recoverPendingStop): gentag time.create med samme
   * timerSessionId (serveren giver den eksisterende post tilbage) og bekræft.
   */
  private async finishMobileJournal(c: SimClient) {
    const j = c.mobileJournal;
    if (!j) return;
    const res = await this.call(
      `${c.spec.id} journal: time.create`,
      false,
      () => this.apiFor(c).time.create(j.payload as never),
      () => this.noteSaved({ serverStarts: j.serverStarts }),
    );
    if (res === LOST) return;
    c.mobileJournal = undefined;
    if (res instanceof TRPCError) {
      await this.call(`${c.spec.id} journal: cancelStop`, false, () =>
        this.apiFor(c).timerSync.cancelStop({
          version: j.version,
          source: "web",
          sessionId: j.sessionId,
        }),
      );
      return;
    }
    await this.mobileConfirm(c, j.version, j.sessionId);
  }

  /**
   * Ældre klient (Expo-appen) holder sin timer i live med et heartbeat uden
   * sessionId — med starttiden som sessionstjek (A7) og samme `source` som web.
   */
  async legacyHeartbeat(i: number, lost = false) {
    const c = this.clients[i];
    if (!c.local.running || c.local.segStart === null) return;
    const payload = this.webSyncPayload(c, {
      isFreshStart: false,
      isAdoption: false,
      expectedVersion: undefined,
      expectedStartTime: c.local.segStart,
    });
    const res = await this.call(
      `${c.spec.id} heartbeat (ældre klient)`,
      lost,
      () => this.apiFor(c).timerSync.sync(payload as never),
    );
    if (res === LOST || res instanceof TRPCError) return;
    const r = res as { success: boolean; version?: number };
    if (r.version !== undefined) c.knownVersion = r.version;
    if (!r.success) await this.reconcile(c);
  }

  /** Manuel post (web-formularen) — ikke fra en timer. */
  async manualEntry(key: TargetKey, startMs: number, endMs: number) {
    const t = this.target(key);
    await this.call(`manuel post ${key}`, false, () =>
      this.web.time.create({
        projectId: t.projectId,
        description: "Manuel",
        hours: Math.max(0.01, round2((endMs - startMs) / 3_600_000)),
        date: isoDate(startMs),
        startTime: new Date(startMs).toISOString(),
        endTime: new Date(endMs).toISOString(),
      }),
    );
  }

  /** Scenarie-tjek af brugerens poster (kaster Violation ved brud). */
  async expectEntries(
    check: (
      entries: Array<{ clientId: string | null; hours: number }>,
    ) => boolean,
    msg: string,
  ) {
    const entries = (await readEntries(this.fx.userId)).map((e) => ({
      clientId: e.clientId,
      hours: Number(e.hours),
    }));
    if (!check(entries)) {
      throw new Violation(
        `${msg} (poster: ${entries.map((e) => `${this.keyForClientId(e.clientId)}=${e.hours}`).join(", ")})`,
      );
    }
  }

  /** Scenarie-tjek af serverens række (kaster Violation ved brud). */
  async expectServer(
    check: (row: Awaited<ReturnType<typeof readTimerRow>>) => boolean,
    msg: string,
  ) {
    const row = await readTimerRow(this.fx.userId);
    if (!check(row)) {
      throw new Violation(
        `${msg} (række: running=${row?.isRunning} intent=${row?.intent} base=${row?.baseSeconds})`,
      );
    }
  }

  // ── tid og cron ──────────────────────────────────────────────────────

  advance(ms: number) {
    this.clock.advance(ms);
  }

  async cleanup() {
    await this.cron();
    this.log("cron timer-cleanup");
    const row = await readTimerRow(this.fx.userId);
    if (
      row?.intent === "stopping" &&
      row.intentAt &&
      row.intentAt.getTime() < this.clock.now - 5 * 60_000
    ) {
      throw new Violation(
        `Række hænger i 'stopping' efter oprydning (intentAt ${row.intentAt.toISOString()})`,
      );
    }
  }

  // ── invarianter ──────────────────────────────────────────────────────

  /** Segment-starterne på den session der netop er claimet. */
  private async claimedStarts(c: SimClient): Promise<number[]> {
    const row = await readTimerRow(this.fx.userId);
    const rowStart = row?.startTime?.getTime() ?? null;
    // Kun når klienten faktisk gemmer den session der står på rækken (samme
    // segment, eller begge pauset), kan vi sige hvilke starter der er gemt.
    const own =
      (rowStart !== null && rowStart === c.local.segStart) ||
      (rowStart === null && !c.local.running);
    if (!own) return [];
    const starts = new Set(this.currentServerStarts);
    if (rowStart !== null) starts.add(rowStart);
    return [...starts];
  }

  /** En gemning har ramt databasen: sessionens starter er nu lukkede. */
  private noteSaved(p: Pick<PendingSave, "serverStarts" | "saveCommitted">) {
    p.saveCommitted = true;
    for (const s of p.serverStarts) this.closedStarts.add(s);
  }

  async checkInvariants(where: string) {
    const fail = (msg: string) => {
      throw new Violation(`${msg}\n  (efter: ${where})`);
    };
    const row = await readTimerRow(this.fx.userId);
    const entries = await readEntries(this.fx.userId);
    const { pkg, usage } = await readPrepaid(this.fx.packageId);

    // 1. timer_states.version er monoton
    if (row) {
      if (row.version < this.maxVersion) {
        fail(
          `timer_states.version gik baglæns: ${this.maxVersion} → ${row.version}`,
        );
      }
      this.maxVersion = row.version;
    }

    // 2. Ingen genopstandelse af en gemt session
    if (row?.isRunning && row.startTime && row.intent !== "stopping") {
      const s = row.startTime.getTime();
      // En start med base 0 som vi ikke har set før, er en NY session
      if ((row.baseSeconds ?? 0) === 0 && !this.currentServerStarts.has(s)) {
        this.currentServerStarts.clear();
      }
      if (this.closedStarts.has(s)) {
        fail(
          `Genopstandelse: timeren kører igen med starttid ${row.startTime.toISOString()} fra en session der allerede er gemt`,
        );
      }
      this.currentServerStarts.add(s);
    } else if (
      row &&
      !row.isRunning &&
      (row.baseSeconds ?? 0) === 0 &&
      (row.elapsedSeconds ?? 0) === 0 &&
      !row.intent
    ) {
      this.currentServerStarts.clear();
    }

    // 3. Én session ⇒ højst én post (samme sessionsstart = samme session)
    const byStart = new Map<number, number>();
    for (const e of entries) {
      if (!e.startTime) continue;
      const k = e.startTime.getTime();
      byStart.set(k, (byStart.get(k) ?? 0) + 1);
      if ((byStart.get(k) ?? 0) > 1) {
        fail(
          `To poster for samme session (start ${e.startTime.toISOString()})`,
        );
      }
    }

    // 4. Timer tælles aldrig dobbelt: summen af poster ≤ forløbet tid
    const elapsedH = (this.clock.now - this.clock.start) / 3_600_000;
    const tolH = (entries.length * (2 * this.maxSkewMs + 40_000)) / 3_600_000;
    const sumH = entries.reduce((a, e) => a + Number(e.hours), 0);
    if (sumH > elapsedH + tolH + 1e-9) {
      fail(
        `Dobbelttælling: poster summerer ${sumH.toFixed(2)} t, men kun ${elapsedH.toFixed(2)} t er gået (tolerance ${tolH.toFixed(2)} t, ${entries.length} poster)`,
      );
    }

    // 5. Klippekort: used == sum(prepaid_usage), aldrig trukket dobbelt
    if (pkg) {
      const used = Number(pkg.usedHours ?? 0);
      const usageSum = usage.reduce((a, u) => a + Number(u.hoursUsed), 0);
      if (Math.abs(used - usageSum) > 0.005) {
        fail(
          `Klippekort: used_hours ${used} ≠ sum(prepaid_usage) ${usageSum.toFixed(2)}`,
        );
      }
      if (
        Math.abs(Number(pkg.remainingHours) - (Number(pkg.totalHours) - used)) >
        0.005
      ) {
        fail(
          `Klippekort: remaining ${pkg.remainingHours} ≠ total − used (${pkg.totalHours} − ${used})`,
        );
      }
      const usageByEntry = new Map<string, number>();
      for (const u of usage) {
        if (!u.timeEntryId) continue;
        usageByEntry.set(
          u.timeEntryId,
          (usageByEntry.get(u.timeEntryId) ?? 0) + Number(u.hoursUsed),
        );
      }
      for (const e of entries) {
        const used = usageByEntry.get(e.id) ?? 0;
        const expected =
          e.isPrepaid && e.prepaidPackageId === pkg.id ? Number(e.hours) : 0;
        if (Math.abs(used - expected) > 0.005) {
          fail(
            `Klippekort-træk for post ${e.id.slice(0, 8)}: trukket ${used.toFixed(2)} t, posten er ${e.isPrepaid ? "" : "ikke-"}klippekort på ${e.hours} t`,
          );
        }
      }
    }

    // 9. Server-udstedte sessioner (docs/architecture/timer-sessions.md):
    //    højst én aktiv session; en ryddet række har ingen session; rækkens
    //    session findes og er aktiv (eller gemt, mens stoppet bekræftes);
    //    én session ⇒ højst én post; en gemt session peger på sin post.
    const sessions = await readSessions(this.fx.userId);
    const active = sessions.filter((s) =>
      ["running", "paused", "stopping"].includes(s.status),
    );
    if (active.length > 1) {
      fail(`${active.length} aktive timer-sessioner på én gang`);
    }
    if (row) {
      const cleared =
        !row.isRunning &&
        (row.baseSeconds ?? 0) === 0 &&
        (row.elapsedSeconds ?? 0) === 0 &&
        !row.intent;
      if (cleared && row.currentSessionId) {
        fail(
          `Ryddet række bærer stadig session ${row.currentSessionId.slice(0, 8)}`,
        );
      }
      if (row.currentSessionId) {
        const cur = sessions.find((s) => s.id === row.currentSessionId);
        if (!cur) {
          fail(
            `Rækkens session ${row.currentSessionId.slice(0, 8)} findes ikke i timer_sessions`,
          );
        } else if (
          !["running", "paused", "stopping"].includes(cur.status) &&
          !(cur.status === "saved" && row.intent === "stopping")
        ) {
          fail(
            `Rækken ${row.isRunning ? "kører" : "står"} på en ${cur.status} session (${cur.id.slice(0, 8)}) — en afsluttet session må ikke leve videre`,
          );
        }
      }
    }
    const bySession = new Map<string, number>();
    for (const e of entries) {
      if (!e.timerSessionId) continue;
      bySession.set(
        e.timerSessionId,
        (bySession.get(e.timerSessionId) ?? 0) + 1,
      );
      if ((bySession.get(e.timerSessionId) ?? 0) > 1) {
        fail(
          `To poster for samme timer-session ${e.timerSessionId.slice(0, 8)}`,
        );
      }
    }
    for (const s of sessions) {
      if (s.savedEntryId && !entries.some((e) => e.id === s.savedEntryId)) {
        fail(
          `Gemt session ${s.id.slice(0, 8)} peger på en post der ikke findes`,
        );
      }
    }

    // 6. Kundeskift kun ved eksplicit brugerhandling
    if (row?.isRunning && row.startTime) {
      const expected = this.explicit.get(row.startTime.getTime());
      if (expected && row.clientId && row.clientId !== expected) {
        fail(
          `Kundeskift uden brugerhandling: sessionen fra ${row.startTime.toISOString()} står på kunde ${this.keyForClientId(row.clientId)}, sidst valgt var ${this.keyForClientId(expected)}`,
        );
      }
    }
    for (const e of entries) {
      // Tjekkes når posten gemmes — et senere skift må ikke "omskrive" fortiden
      const stamp = e.updatedAt.getTime();
      if (!e.startTime || this.checkedEntries.get(e.id) === stamp) continue;
      this.checkedEntries.set(e.id, stamp);
      const expected = this.explicit.get(e.startTime.getTime());
      const actual =
        e.clientId ??
        (this.keyForProject(e.projectId)
          ? this.target(this.keyForProject(e.projectId) as TargetKey).clientId
          : null);
      if (expected && actual && actual !== expected) {
        fail(
          `Post ${e.id.slice(0, 8)} gemt på kunde ${this.keyForClientId(actual)}, men sessionen blev sidst sat til ${this.keyForClientId(expected)}`,
        );
      }
    }
  }

  /** Slut: alt i luften skal kunne lande, og intet må hænge i 'stopping'. */
  async finish() {
    for (let i = 0; i < this.clients.length; i++) await this.flushQueue(i);
    this.advance(6 * 60_000);
    await this.cleanup();
    await this.checkInvariants("afslutning");
  }
}

interface ServerState {
  isRunning: boolean | null;
  startTime: string | null;
  sessionId?: string | null;
  elapsedSeconds: number;
  baseSeconds: number;
  projectId: string | null;
  clientId: string | null;
  version: number;
  intent?: string | null;
  intentFrom?: string | null;
}

/** Simulerede detaljer: målet står for projekt/kunde (beskrivelse er tom). */
function simDetails(key: TargetKey | null) {
  return {
    projectId: key,
    clientId: key,
    taskId: null,
    description: "",
  };
}

function short(v: unknown): string {
  if (v === undefined || v === null) return String(v);
  if (typeof v !== "object") return String(v);
  const o = v as Record<string, unknown>;
  const pick = [
    "success",
    "reason",
    "version",
    "deduplicated",
    "isRunning",
    "id",
    "mergedIntoExisting",
  ];
  const parts = pick
    .filter((k) => k in o)
    .map((k) => `${k}=${String(o[k]).slice(0, 12)}`);
  return `{${parts.join(" ")}}`;
}
