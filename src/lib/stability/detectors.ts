/**
 * Stabilitetsvagten — rene detektorer.
 *
 * Hver detektor tager rækker fra en afgrænset SQL-forespørgsel (se
 * queries.ts) og returnerer fund. Ingen I/O her, så hver regel kan
 * enhedstestes med håndlavede rækker.
 *
 * Baggrund: kunde A meldte (sep.-okt. 2026) timere der skiftede kunde,
 * sprang i tid, dubletter og klippekort-skævheder. Rodårsagerne er rettet
 * (#777), og detektorerne her skal opdage hvis noget lignende kommer igen —
 * før kunden gør.
 */

import {
  classifyClientHint,
  evaluateClientVersion,
  LEGACY_EXTENSION_VERSION,
  type MinClientVersions,
} from "@/lib/client-version";
import { toCopenhagenDateStr } from "@/lib/time/copenhagen";

export type Severity = "critical" | "warning" | "info";

export const DETECTOR_IDS = [
  "duplicate_session",
  "stale_client",
  "runaway_timer",
  "zombie_timer",
  "time_jump",
  "client_switch",
  "hours_mismatch",
  "date_mismatch",
  "prepaid_inconsistency",
  "realtime_down",
  "cron_stale",
  "outdated_client",
] as const;

export type DetectorId = (typeof DETECTOR_IDS)[number];

export interface DetectorConfig {
  /** Dansk navn til admin-side og alarmer */
  label: string;
  /**
   * event: hver forekomst tælles (dedup via occurrenceKeys) — fundet er
   * "løst" når det ikke er set i resolveAfterMinutes.
   * state: en tilstand der enten står på eller ej — tælleren er antal
   * kørsler hvor den stod på.
   */
  kind: "event" | "state";
  /** Auto-løs når fundet ikke er set i så mange minutter */
  resolveAfterMinutes: number;
  /** Anker i docs/runbooks/timer-fejlsoegning.md */
  runbookAnchor: string;
  /**
   * false = ingen Sentry-besked (kun Discord og admin-siden). Til fund, der
   * er en forventet driftstilstand og ikke en fejl i koden.
   */
  sentry?: boolean;
}

export const DETECTORS: Record<DetectorId, DetectorConfig> = {
  duplicate_session: {
    label: "Dobbelt-gemt session",
    kind: "event",
    resolveAfterMinutes: 24 * 60,
    runbookAnchor: "a-dobbelt-gemt-session-duplicate_session",
  },
  stale_client: {
    label: "Forældet klient kæmper",
    kind: "state",
    resolveAfterMinutes: 60,
    runbookAnchor: "b-forældet-klient-kæmper-stale_client",
  },
  runaway_timer: {
    label: "Løbsk timer (over 10 t)",
    kind: "state",
    resolveAfterMinutes: 30,
    runbookAnchor: "c-løbsk-timer-og-tidsspring-runaway_timer-time_jump",
  },
  zombie_timer: {
    label: "Zombie-timer ryddet automatisk",
    kind: "event",
    // Synlig en uge på /admin/stabilitet; info, så den alarmerer aldrig.
    resolveAfterMinutes: 7 * 24 * 60,
    runbookAnchor: "c-løbsk-timer-og-tidsspring-runaway_timer-time_jump",
  },
  time_jump: {
    label: "Tidsspring på kørende timer",
    kind: "event",
    resolveAfterMinutes: 24 * 60,
    runbookAnchor: "c-løbsk-timer-og-tidsspring-runaway_timer-time_jump",
  },
  client_switch: {
    label: "Kundeskift på kørende session",
    kind: "event",
    resolveAfterMinutes: 24 * 60,
    runbookAnchor: "d-kundeskift-på-kørende-session-client_switch",
  },
  hours_mismatch: {
    label: "Timer passer ikke med start/slut",
    kind: "event",
    resolveAfterMinutes: 24 * 60,
    runbookAnchor: "e-timer-passer-ikke-med-startslut-hours_mismatch",
  },
  date_mismatch: {
    label: "Dato passer ikke med starttid",
    kind: "event",
    resolveAfterMinutes: 24 * 60,
    runbookAnchor: "f-dato-passer-ikke-med-starttid-date_mismatch",
  },
  prepaid_inconsistency: {
    label: "Klippekort-saldo skæv",
    kind: "state",
    // Kører kun én gang i timen (gate i run.ts). 150 min tåler at én
    // timekørsel springes over (deploy, cron-forsinkelse) uden at flappe.
    resolveAfterMinutes: 150,
    runbookAnchor: "g-klippekort-saldo-skæv-prepaid_inconsistency",
  },
  realtime_down: {
    label: "Realtime nede",
    kind: "state",
    resolveAfterMinutes: 20,
    runbookAnchor: "h-realtime-nede-realtime_down",
  },
  cron_stale: {
    label: "Cron-job kører ikke",
    kind: "state",
    resolveAfterMinutes: 20,
    runbookAnchor: "i-cron-job-kører-ikke-cron_stale",
  },
  outdated_client: {
    label: "Gammel klientversion skriver",
    kind: "state",
    // Vinduet er 24 t, så fundet står til et døgn efter sidste skrivning.
    resolveAfterMinutes: 60,
    runbookAnchor: "j-gammel-klientversion-skriver-outdated_client",
    // Gamle klienter under en udrulning er forventet og løses ved at vente
    // eller kontakte org'en, ikke i koden (Sentry TIMETRACK-1Z).
    sentry: false,
  },
};

export interface DetectedFinding {
  detector: DetectorId;
  severity: Severity;
  fingerprint: string;
  userId: string | null;
  organizationId: string | null;
  /** Dansk one-liner */
  title: string;
  /** Unikke forekomster (kun event-detektorer) — bruges til at tælle nye */
  occurrenceKeys: string[];
  /** Lille JSON med de seneste eksempler */
  sample: Record<string, unknown>;
}

const SEVERITY_RANK: Record<Severity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export function maxSeverity(a: Severity, b: Severity): Severity {
  return SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b;
}

export function isAlertable(severity: Severity): boolean {
  return SEVERITY_RANK[severity] >= SEVERITY_RANK.warning;
}

const MAX_SAMPLES = 5;

function iso(d: Date | null | undefined): string | null {
  return d && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

function groupBy<T>(rows: T[], key: (r: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const r of rows) {
    const k = key(r);
    const list = map.get(k);
    if (list) list.push(r);
    else map.set(k, [r]);
  }
  return map;
}

// ─── a. Dobbelt-gemte sessioner ───────────────────────────────────────────

export const DUPLICATE_START_TOLERANCE_SECONDS = 3;

export interface DuplicatePairRow {
  userId: string;
  organizationId: string | null;
  entryId: string;
  startTime: Date;
  source: string | null;
  hours: number;
  otherEntryId: string;
  otherStartTime: Date;
  otherSource: string | null;
  otherHours: number;
  /**
   * Mindst én af posterne stammer fra en timer: `source` i
   * TIMER_ENTRY_SOURCES, eller der findes en timer-hændelse med samme
   * sessionsstart (±3 s). Web-timerens stop gemmer via time.create med
   * source "manual", så source alene er ikke nok.
   */
  timerOrigin: boolean;
  /** Samme projekt og kunde (null-sikkert) */
  sameAssignment: boolean;
  /**
   * Begge poster bærer et server-udstedt `timer_session_id`, og de er
   * forskellige: to sessioner, ikke en dublet (samme id kan ikke forekomme to
   * gange — unikt indeks). Udeladt = ukendt (ældre poster).
   */
  distinctSessions?: boolean;
}

/** time_entries.source-værdier der kommer fra en timer/automatik. */
export const TIMER_ENTRY_SOURCES = [
  "timer",
  "auto_track",
  "extension",
  "desktop",
  "mobile",
] as const;

/**
 * Samme timer-session gemt to gange med forskudt start: posten `entry` bærer
 * sessionens `timer_session_id`, og `other` (uden sessions-id) overlapper
 * sessionens [started_at, ended_at] med mindst SESSION_OVERLAP_MIN_SECONDS.
 * Mønstret: 2.6.0 gemmer sessionen, og en ældre klient (web-fane der gemmer
 * som "manual", extension 2.5.x) gemmer en parkeret rest af den minutter
 * senere — starterne er minutter fra hinanden, så ±3 s-reglen ser det ikke.
 */
export interface SessionOverlapRow {
  userId: string;
  organizationId: string | null;
  sessionId: string;
  sessionStartedAt: Date;
  sessionEndedAt: Date;
  entryId: string;
  startTime: Date;
  endTime: Date;
  source: string | null;
  hours: number;
  otherEntryId: string;
  otherStartTime: Date;
  otherEndTime: Date;
  otherSource: string | null;
  otherHours: number;
  /** Samme projekt og kunde (null-sikkert) */
  sameAssignment: boolean;
}

/** Mindste overlap med sessionen før en post regnes for en del af den. */
export const SESSION_OVERLAP_MIN_SECONDS = 60;

/** Overlap i sekunder mellem to tidsrum (0 hvis de ikke overlapper). */
export function overlapSeconds(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): number {
  const ms =
    Math.min(aEnd.getTime(), bEnd.getTime()) -
    Math.max(aStart.getTime(), bStart.getTime());
  return Number.isFinite(ms) && ms > 0 ? ms / 1000 : 0;
}

/**
 * Alvor for et samme-session-par: kritisk kun når begge poster har samme
 * projekt/kunde OG deres tidsrum overlapper (tiden er talt to gange). Samme
 * opgave uden overlap mellem posterne er en advarsel; en anden kunde i
 * sessionens tidsrum er info (kan være et bevidst manuelt indskud).
 */
export function sessionOverlapSeverity(r: SessionOverlapRow): Severity {
  if (!r.sameAssignment) return "info";
  return overlapSeconds(
    r.startTime,
    r.endTime,
    r.otherStartTime,
    r.otherEndTime,
  ) >= SESSION_OVERLAP_MIN_SECONDS
    ? "critical"
    : "warning";
}

function pairKey(a: string, b: string): string {
  return [a, b].sort().join("|");
}

/**
 * Dobbelt-gemte sessioner, ét fund pr. bruger:
 * - to+ poster med starttid inden for 3 s af hinanden (kritisk), og
 * - to poster fra samme timer-session (se SessionOverlapRow; alvor efter
 *   sessionOverlapSeverity).
 */
export function detectDuplicateSessions(
  rows: DuplicatePairRow[],
  sessionRows: SessionOverlapRow[] = [],
): DetectedFinding[] {
  const pairs = rows.filter(
    (r) =>
      r.entryId !== r.otherEntryId &&
      // Manuelle poster med samme runde start (fx 06:00) er ikke dubletter
      r.timerOrigin &&
      r.sameAssignment &&
      !r.distinctSessions &&
      Math.abs(r.startTime.getTime() - r.otherStartTime.getTime()) <=
        DUPLICATE_START_TOLERANCE_SECONDS * 1000,
  );
  const sessionPairs = sessionRows.filter(
    (r) =>
      r.entryId !== r.otherEntryId &&
      overlapSeconds(
        r.sessionStartedAt,
        r.sessionEndedAt,
        r.otherStartTime,
        r.otherEndTime,
      ) >= SESSION_OVERLAP_MIN_SECONDS,
  );

  type Pair = {
    key: string;
    severity: Severity;
    organizationId: string | null;
    sample: Record<string, unknown>;
  };
  const byUser = new Map<string, Map<string, Pair>>();
  const add = (userId: string, p: Pair) => {
    let m = byUser.get(userId);
    if (!m) {
      m = new Map();
      byUser.set(userId, m);
    }
    const prev = m.get(p.key);
    if (!prev || SEVERITY_RANK[p.severity] > SEVERITY_RANK[prev.severity]) {
      m.set(p.key, p);
    }
  };

  for (const r of pairs) {
    add(r.userId, {
      key: pairKey(r.entryId, r.otherEntryId),
      severity: "critical",
      organizationId: r.organizationId,
      sample: {
        rule: "same_start",
        entryIds: [r.entryId, r.otherEntryId],
        startTimes: [iso(r.startTime), iso(r.otherStartTime)],
        sources: [r.source, r.otherSource],
        hours: [r.hours, r.otherHours],
      },
    });
  }
  for (const r of sessionPairs) {
    add(r.userId, {
      key: pairKey(r.entryId, r.otherEntryId),
      severity: sessionOverlapSeverity(r),
      organizationId: r.organizationId,
      sample: {
        rule: "same_session",
        sessionId: r.sessionId,
        session: [iso(r.sessionStartedAt), iso(r.sessionEndedAt)],
        entryIds: [r.entryId, r.otherEntryId],
        startTimes: [iso(r.startTime), iso(r.otherStartTime)],
        endTimes: [iso(r.endTime), iso(r.otherEndTime)],
        sources: [r.source, r.otherSource],
        hours: [r.hours, r.otherHours],
        sameAssignment: r.sameAssignment,
      },
    });
  }

  const findings: DetectedFinding[] = [];
  for (const [userId, m] of byUser) {
    const unique = [...m.values()].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    );
    const severity = unique.reduce<Severity>(
      (acc, p) => maxSeverity(acc, p.severity),
      "info",
    );
    const n = unique.length;
    const rules = new Set(unique.map((p) => p.sample.rule));
    const why = [
      rules.has("same_start")
        ? `samme start ±${DUPLICATE_START_TOLERANCE_SECONDS} s`
        : null,
      rules.has("same_session") ? "samme timer-session" : null,
    ]
      .filter(Boolean)
      .join(" / ");
    findings.push({
      detector: "duplicate_session",
      severity,
      fingerprint: `duplicate_session:${userId}`,
      userId,
      organizationId: unique[0].organizationId,
      title: `${n} dobbelt-gemt${n === 1 ? "" : "e"} session${n === 1 ? "" : "er"} (${why})`,
      occurrenceKeys: unique.map((p) => p.key),
      sample: {
        pairs: unique.slice(0, MAX_SAMPLES).map((p) => p.sample),
      },
    });
  }
  return findings;
}

// ─── b. Forældede klienter der kæmper ─────────────────────────────────────

/** Antal pr. time pr. bruger+klient før det er et fund. */
export const STALE_CLIENT_THRESHOLDS: Record<string, number> = {
  blocked_resurrection: 3,
  merge_same_session: 2,
  claim_rejected: 5,
  version_conflict: 10,
  heartbeat_rejected: 10,
};

export const STALE_CLIENT_EVENTS = Object.keys(STALE_CLIENT_THRESHOLDS);

export interface SignalCountRow {
  userId: string;
  organizationId: string | null;
  event: string;
  source: string;
  clientHint: string | null;
  n: number;
  lastAt: Date;
}

/** Vellykkede skrivninger i samme time fra brugerens klienter. */
export interface WriterActivityRow {
  userId: string;
  event: string;
  source: string;
  clientHint: string | null;
  n: number;
}

/** Timer-rækkens seneste skriver (timer_states er én række pr. bruger). */
export interface TimerOwnerRow {
  userId: string;
  lastSyncedFrom: string | null;
  lastSyncedAt: Date | null;
}

export interface StaleClientContext {
  /** Den kørende web-builds version (git-SHA'en; de første 12 tegn tæller). */
  currentWebBuild?: string | null;
  writers?: WriterActivityRow[];
  owners?: TimerOwnerRow[];
}

/**
 * Kører klienten den aktuelle build? Kun web/pwa kan afgøres (hintet bærer
 * build-SHA'en); andre klienter regnes som ukendte.
 */
export function isCurrentWebClient(
  hint: string | null,
  currentWebBuild: string | null | undefined,
): boolean {
  if (!currentWebBuild) return false;
  const { kind, version } = classifyClientHint(hint);
  if ((kind !== "web" && kind !== "pwa") || !version) return false;
  return version.slice(0, 12) === currentWebBuild.slice(0, 12);
}

const MAX_COMPETITORS = 3;

function formatCopenhagenTime(d: Date): string {
  return new Intl.DateTimeFormat("da-DK", {
    timeZone: "Europe/Copenhagen",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(d);
}

export function detectStaleClients(
  rows: SignalCountRow[],
  ctx: StaleClientContext = {},
): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const groups = groupBy(
    rows,
    (r) => `${r.userId}|${r.source}|${r.clientHint ?? "ukendt"}`,
  );
  for (const list of groups.values()) {
    const over = list.filter(
      (r) =>
        r.n >= (STALE_CLIENT_THRESHOLDS[r.event] ?? Number.POSITIVE_INFINITY),
    );
    if (over.length === 0) continue;
    const { userId, organizationId, source } = list[0];
    const hint = list[0].clientHint ?? "ukendt";
    const counts = Object.fromEntries(list.map((r) => [r.event, r.n]));
    const overText = over.map((r) => `${r.event} ${r.n}×/t`).join(", ");

    // En AKTUEL klient hvis eneste problem er versionskonflikter, er ikke
    // forældet: den taber til en anden aktiv skriver med samme kilde (fx en
    // anden fane der holder samme timer i live). Info — ingen alarm.
    // Alle afvisninger i timen skal være versionskonflikter — også dem under
    // deres egen tærskel (fx 4 claim_rejected ved siden af).
    if (
      list.every((r) => r.event === "version_conflict") &&
      isCurrentWebClient(list[0].clientHint, ctx.currentWebBuild)
    ) {
      const competitors = (ctx.writers ?? [])
        .filter((w) => w.userId === userId)
        .sort((a, b) => b.n - a.n)
        .slice(0, MAX_COMPETITORS)
        .map((w) => ({
          source: w.source,
          clientHint: w.clientHint ?? "ukendt",
          event: w.event,
          n: w.n,
        }));
      const owner = (ctx.owners ?? []).find((o) => o.userId === userId);
      const parts = [
        owner?.lastSyncedFrom
          ? `rækken sidst skrevet af ${owner.lastSyncedFrom}${
              owner.lastSyncedAt
                ? ` kl. ${formatCopenhagenTime(owner.lastSyncedAt)}`
                : ""
            }`
          : null,
        competitors.length > 0
          ? `skrivere i timen: ${competitors
              .map((c) => `${c.source} (${c.clientHint}) ${c.event} ${c.n}×`)
              .join(", ")}`
          : null,
      ].filter(Boolean);
      findings.push({
        detector: "stale_client",
        severity: "info",
        fingerprint: `stale_client:${userId}:${source}:${hint}`,
        userId,
        organizationId,
        title: `Klient ${source} (${hint}) er aktuel, men taber til en anden aktiv skriver: ${overText}${
          parts.length > 0 ? ` — ${parts.join("; ")}` : ""
        }`,
        occurrenceKeys: [],
        sample: {
          source,
          clientHint: hint,
          countsLastHour: counts,
          verdict: "losing_to_live_writer",
          competitors,
          owner: owner
            ? {
                lastSyncedFrom: owner.lastSyncedFrom,
                lastSyncedAt: owner.lastSyncedAt?.toISOString() ?? null,
              }
            : null,
        },
      });
      continue;
    }

    // Genopstandelse og dubletter er de alvorlige — de rammer data
    const severity: Severity = over.some(
      (r) =>
        r.event === "blocked_resurrection" || r.event === "merge_same_session",
    )
      ? "critical"
      : "warning";
    findings.push({
      detector: "stale_client",
      severity,
      fingerprint: `stale_client:${userId}:${source}:${hint}`,
      userId,
      organizationId,
      title: `Klient ${source} (${hint}) afvises gentagne gange: ${overText}`,
      occurrenceKeys: [],
      sample: { source, clientHint: hint, countsLastHour: counts },
    });
  }
  return findings;
}

// ─── c. Løbske timere og tidsspring ───────────────────────────────────────

export const RUNAWAY_HOURS = 10;
export const TIME_JUMP_SECONDS = 60 * 60;

export interface RunningTimerRow {
  userId: string;
  organizationId: string | null;
  startTime: Date;
  baseSeconds: number;
  lastSyncedFrom: string | null;
  lastSyncedAt: Date | null;
  autoPauseAfterMinutes: number | null;
}

export function detectRunawayTimers(
  rows: RunningTimerRow[],
  now: Date,
): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const r of rows) {
    const elapsedSeconds =
      r.baseSeconds + (now.getTime() - r.startTime.getTime()) / 1000;
    if (elapsedSeconds <= RUNAWAY_HOURS * 3600) continue;
    const hours = Math.round((elapsedSeconds / 3600) * 10) / 10;
    // Kun en fejl når brugerens auto-pause burde have stoppet den. Uden
    // auto-pause er en lang timer brugerens eget valg.
    const autoPauseMissed =
      !!r.autoPauseAfterMinutes &&
      r.autoPauseAfterMinutes > 0 &&
      elapsedSeconds > r.autoPauseAfterMinutes * 60;
    findings.push({
      detector: "runaway_timer",
      severity: autoPauseMissed ? "warning" : "info",
      // Pr. bruger (ikke pr. start_time): pause/genoptag flytter starten og
      // må ikke give et nyt fund og en ny alarm.
      fingerprint: `runaway_timer:${r.userId}`,
      userId: r.userId,
      organizationId: r.organizationId,
      title: `Timer har kørt ${hours.toLocaleString("da-DK")} t (sidst synket fra ${r.lastSyncedFrom ?? "ukendt"})`,
      occurrenceKeys: [],
      sample: {
        startTime: iso(r.startTime),
        baseSeconds: r.baseSeconds,
        elapsedHours: hours,
        lastSyncedFrom: r.lastSyncedFrom,
        lastSyncedAt: iso(r.lastSyncedAt),
        autoPauseAfterMinutes: r.autoPauseAfterMinutes,
      },
    });
  }
  return findings;
}

export interface TimeChangeRow {
  eventId: string;
  userId: string;
  organizationId: string | null;
  createdAt: Date;
  source: string;
  clientHint: string | null;
  startTime: Date | null;
  baseSeconds: number | null;
  prevStartTime: Date | null;
  prevBaseSeconds: number | null;
}

/**
 * Hvor meget den viste tid (base + nu − start) flyttede sig ved skrivningen.
 * En pause/genoptag der flytter start OG base lige meget, giver 0.
 */
export function elapsedJumpSeconds(r: TimeChangeRow): number | null {
  if (!r.startTime || !r.prevStartTime) return null;
  const startDelta = (r.startTime.getTime() - r.prevStartTime.getTime()) / 1000;
  const baseDelta = (r.baseSeconds ?? 0) - (r.prevBaseSeconds ?? 0);
  return Math.abs(baseDelta - startDelta);
}

/**
 * "Læg tid til" (AddTimeModal) på en kørende timer: starten er uændret, og
 * kun basetiden er gået op. Det er brugerens eget valg, ikke et spring.
 */
export function isAddTime(r: TimeChangeRow): boolean {
  if (!r.startTime || !r.prevStartTime) return false;
  const sameStart =
    Math.abs(r.startTime.getTime() - r.prevStartTime.getTime()) < 1000;
  return sameStart && (r.baseSeconds ?? 0) > (r.prevBaseSeconds ?? 0);
}

export function detectTimeJumps(rows: TimeChangeRow[]): DetectedFinding[] {
  const jumps = rows
    .filter((r) => !isAddTime(r))
    .map((r) => ({ r, jump: elapsedJumpSeconds(r) }))
    .filter(
      (x): x is { r: TimeChangeRow; jump: number } =>
        x.jump !== null && x.jump > TIME_JUMP_SECONDS,
    );
  const findings: DetectedFinding[] = [];
  for (const [userId, list] of groupBy(jumps, (x) => x.r.userId)) {
    const biggest = Math.max(...list.map((x) => x.jump));
    findings.push({
      detector: "time_jump",
      severity: "warning",
      fingerprint: `time_jump:${userId}`,
      userId,
      organizationId: list[0].r.organizationId,
      title: `Kørende timer sprang ${Math.round(biggest / 60)} min (${list
        .map((x) => `${x.r.source}/${x.r.clientHint ?? "ukendt"}`)
        .filter((v, i, a) => a.indexOf(v) === i)
        .join(", ")})`,
      occurrenceKeys: list.map((x) => x.r.eventId),
      sample: {
        jumps: list.slice(0, MAX_SAMPLES).map((x) => ({
          eventId: x.r.eventId,
          at: iso(x.r.createdAt),
          source: x.r.source,
          clientHint: x.r.clientHint,
          jumpMinutes: Math.round(x.jump / 60),
          startTime: iso(x.r.startTime),
          prevStartTime: iso(x.r.prevStartTime),
          baseSeconds: x.r.baseSeconds,
          prevBaseSeconds: x.r.prevBaseSeconds,
        })),
      },
    });
  }
  return findings;
}

/**
 * En zombie-timer (kørende i over 7 døgn uden sync) som timer-cleanup-cron'en
 * har ryddet — se src/lib/timer/zombie.ts. Læses fra timer_events.
 */
export interface ZombieClearRow {
  eventId: string;
  userId: string;
  organizationId: string | null;
  createdAt: Date;
  discardedStartTime: string | null;
  discardedHours: number | null;
  lastSyncedFrom: string | null;
}

export function detectZombieClears(rows: ZombieClearRow[]): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const [userId, list] of groupBy(rows, (r) => r.userId)) {
    const hours = list
      .map((r) => r.discardedHours)
      .filter((h): h is number => h !== null);
    const total = Math.round(hours.reduce((a, b) => a + b, 0));
    findings.push({
      detector: "zombie_timer",
      severity: "info",
      fingerprint: `zombie_timer:${userId}`,
      userId,
      organizationId: list[0].organizationId,
      title: `Zombie-timer ryddet automatisk (${total.toLocaleString("da-DK")} t kasseret, ingen tidspost)`,
      occurrenceKeys: list.map((r) => r.eventId),
      sample: {
        cleared: list.slice(0, MAX_SAMPLES).map((r) => ({
          at: iso(r.createdAt),
          discardedStartTime: r.discardedStartTime,
          discardedHours: r.discardedHours,
          lastSyncedFrom: r.lastSyncedFrom,
        })),
      },
    });
  }
  return findings;
}

// ─── d. Kundeskift på en kørende session ──────────────────────────────────

export interface ClientChangeRow {
  eventId: string;
  userId: string;
  organizationId: string | null;
  createdAt: Date;
  source: string;
  clientHint: string | null;
  startTime: Date | null;
  clientId: string | null;
  prevClientId: string | null;
  /** Den overflade der startede sessionen (seneste start/resume/adopt med samme start_time) */
  originSource: string | null;
  originHint: string | null;
  /**
   * Afvisninger fra forældede klienter (blocked_resurrection,
   * claim_rejected, version_conflict, heartbeat_rejected) for brugeren i
   * sessionens løbetid.
   */
  staleRejections: number;
}

export function detectClientSwitches(
  rows: ClientChangeRow[],
): DetectedFinding[] {
  // Kun et RIGTIGT skift: fra en kunde til en anden (ikke første tildeling)
  const switches = rows.filter(
    (r) => r.prevClientId && r.clientId !== r.prevClientId && r.startTime,
  );
  const findings: DetectedFinding[] = [];
  for (const [userId, list] of groupBy(switches, (r) => r.userId)) {
    // Mønstret for en forældet klient: skiftet kom fra en ANDEN overflade
    // (source — en anden fane har bare et andet client_hint) end den der
    // startede sessionen, OG sessionen har også afvisninger fra forældede
    // klienter. Alt andet er typisk brugeren selv → info.
    const foreign = list.filter(
      (r) =>
        r.originSource !== null &&
        r.originSource !== r.source &&
        r.staleRejections > 0,
    );
    findings.push({
      detector: "client_switch",
      severity: foreign.length > 0 ? "warning" : "info",
      fingerprint: `client_switch:${userId}`,
      userId,
      organizationId: list[0].organizationId,
      title:
        foreign.length > 0
          ? `Kunde skiftet på kørende session fra en anden overflade (${foreign[0].source}/${foreign[0].clientHint ?? "ukendt"}, startet fra ${foreign[0].originSource}/${foreign[0].originHint ?? "ukendt"}) med ${foreign[0].staleRejections} afvisning(er) fra forældede klienter`
          : `Kunde skiftet på kørende session (${list[0].source}/${list[0].clientHint ?? "ukendt"})`,
      occurrenceKeys: list.map((r) => r.eventId),
      sample: {
        switches: list.slice(0, MAX_SAMPLES).map((r) => ({
          eventId: r.eventId,
          at: iso(r.createdAt),
          source: r.source,
          clientHint: r.clientHint,
          originSource: r.originSource,
          originHint: r.originHint,
          staleRejections: r.staleRejections,
          startTime: iso(r.startTime),
          prevClientId: r.prevClientId,
          clientId: r.clientId,
        })),
      },
    });
  }
  return findings;
}

// ─── e. Timer ≠ slut − start ──────────────────────────────────────────────

export const HOURS_MISMATCH_TOLERANCE = 0.25;

export interface EntrySpanRow {
  entryId: string;
  userId: string;
  organizationId: string | null;
  source: string | null;
  hours: number;
  startTime: Date;
  endTime: Date;
  hasSegments: boolean;
  /** Fra en timer (se DuplicatePairRow.timerOrigin) */
  timerOrigin: boolean;
}

export function detectHoursMismatch(rows: EntrySpanRow[]): DetectedFinding[] {
  const bad = rows
    .filter((r) => !r.hasSegments)
    .map((r) => {
      const spanHours =
        (r.endTime.getTime() - r.startTime.getTime()) / 3_600_000;
      return { r, spanHours, diff: r.hours - spanHours };
    })
    .filter((x) => Math.abs(x.diff) > HOURS_MISMATCH_TOLERANCE);
  const findings: DetectedFinding[] = [];
  for (const list of groupBy(
    bad,
    (x) => `${x.r.userId}|${x.r.source ?? "ukendt"}`,
  ).values()) {
    const { userId, organizationId } = list[0].r;
    const source = list[0].r.source ?? "ukendt";
    // Flere timer end vægur-tiden (eller slut før start) kan ikke forklares
    // af en pause — det er en fejl. Færre timer er typisk en pause.
    // Manuelle/API/import-poster må gerne have timer ≠ spænd (brugeren
    // skriver begge felter) — kun timer-poster kan advare.
    const impossible = list.filter(
      (x) => x.r.timerOrigin && (x.diff > 0 || x.spanHours < 0),
    );
    findings.push({
      detector: "hours_mismatch",
      severity: impossible.length > 0 ? "warning" : "info",
      fingerprint: `hours_mismatch:${userId}:${source}`,
      userId,
      organizationId,
      title:
        impossible.length > 0
          ? `${impossible.length} timer-post(er) fra ${source} har flere timer end slut − start`
          : `${list.length} post(er) fra ${source} har færre timer end slut − start (pause uden segmenter?)`,
      occurrenceKeys: list.map((x) => x.r.entryId),
      sample: {
        entries: list.slice(0, MAX_SAMPLES).map((x) => ({
          entryId: x.r.entryId,
          hours: x.r.hours,
          spanHours: Math.round(x.spanHours * 100) / 100,
          startTime: iso(x.r.startTime),
          endTime: iso(x.r.endTime),
        })),
      },
    });
  }
  return findings;
}

// ─── f. Dato ≠ dansk dato for starttid ────────────────────────────────────

export interface EntryDateRow {
  entryId: string;
  userId: string;
  organizationId: string | null;
  source: string | null;
  /** Datokolonnens kalenderdato, "YYYY-MM-DD" */
  dateStr: string;
  startTime: Date;
}

export function detectDateMismatch(rows: EntryDateRow[]): DetectedFinding[] {
  const bad = rows
    .map((r) => ({ r, expected: toCopenhagenDateStr(r.startTime) }))
    .filter((x) => x.expected !== x.r.dateStr);
  const findings: DetectedFinding[] = [];
  for (const list of groupBy(
    bad,
    (x) => `${x.r.userId}|${x.r.source ?? "ukendt"}`,
  ).values()) {
    const { userId, organizationId } = list[0].r;
    const source = list[0].r.source ?? "ukendt";
    findings.push({
      detector: "date_mismatch",
      severity: "warning",
      fingerprint: `date_mismatch:${userId}:${source}`,
      userId,
      organizationId,
      title: `${list.length} post(er) fra ${source} står på en anden dato end starttiden i dansk tid`,
      occurrenceKeys: list.map((x) => x.r.entryId),
      sample: {
        entries: list.slice(0, MAX_SAMPLES).map((x) => ({
          entryId: x.r.entryId,
          date: x.r.dateStr,
          expectedDate: x.expected,
          startTime: iso(x.r.startTime),
        })),
      },
    });
  }
  return findings;
}

// ─── g. Klippekort-konsistens ─────────────────────────────────────────────

export const PREPAID_TOLERANCE = 0.02;

export interface PrepaidPackageRow {
  packageId: string;
  userId: string;
  organizationId: string | null;
  name: string;
  totalHours: number;
  usedHours: number;
  remainingHours: number;
  /** Antal usage-rækker på pakken */
  usageRows: number;
  /** sum(hours_used − overdraft_hours) — det der faktisk er trukket af saldoen */
  usageNetHours: number;
  /** Poster markeret som klippekort på pakken uden en usage-række */
  entriesWithoutUsage: number;
  sampleEntryIds: string[];
}

export function detectPrepaidInconsistency(
  rows: PrepaidPackageRow[],
): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  for (const r of rows) {
    const problems: string[] = [];
    if (
      Math.abs(r.usedHours + r.remainingHours - r.totalHours) >
      PREPAID_TOLERANCE
    ) {
      problems.push(
        `brugt ${r.usedHours} + rest ${r.remainingHours} ≠ total ${r.totalHours}`,
      );
    }
    // Pakker uden usage-rækker er importeret/ældre (brugte timer sat
    // direkte) — dem kan vi ikke afstemme.
    if (
      r.usageRows > 0 &&
      Math.abs(r.usedHours - r.usageNetHours) > PREPAID_TOLERANCE
    ) {
      problems.push(
        `brugt ${r.usedHours} t ≠ sum af træk ${Math.round(r.usageNetHours * 100) / 100} t`,
      );
    }
    if (r.entriesWithoutUsage > 0) {
      problems.push(`${r.entriesWithoutUsage} post(er) uden træk`);
    }
    if (problems.length === 0) continue;
    findings.push({
      detector: "prepaid_inconsistency",
      severity: "warning",
      fingerprint: `prepaid_inconsistency:${r.packageId}`,
      userId: r.userId,
      organizationId: r.organizationId,
      // Navnet indeholder ofte kundens kunde — det står i sample (admin),
      // ikke i titlen, der også går til Discord og Sentry.
      title: `Klippekort ${r.packageId.slice(0, 8)}: ${problems.join("; ")}`,
      occurrenceKeys: [],
      sample: {
        packageId: r.packageId,
        name: r.name,
        totalHours: r.totalHours,
        usedHours: r.usedHours,
        remainingHours: r.remainingHours,
        usageNetHours: Math.round(r.usageNetHours * 100) / 100,
        entriesWithoutUsage: r.entriesWithoutUsage,
        sampleEntryIds: r.sampleEntryIds.slice(0, MAX_SAMPLES),
      },
    });
  }
  return findings;
}

// ─── h. Realtime ──────────────────────────────────────────────────────────

export interface RealtimeHealthInput {
  enabled: boolean;
  configured: boolean;
  subscribed: boolean;
  /** null = ikke prøvet */
  probeOk: boolean | null;
  probeMs: number | null;
  lastError: string | null;
}

export function detectRealtimeDown(
  input: RealtimeHealthInput,
): DetectedFinding[] {
  if (!input.enabled || !input.configured) return [];
  if (input.subscribed && input.probeOk !== false) return [];
  const reason = !input.subscribed
    ? "processen er ikke abonneret på timer:*"
    : "prøvebesked kom ikke frem";
  return [
    {
      detector: "realtime_down",
      severity: "warning",
      fingerprint: "realtime_down",
      userId: null,
      organizationId: null,
      title: `Realtime nede: ${reason}. Faner ser først stop fra andre enheder ved næste poll.`,
      occurrenceKeys: [],
      sample: { ...input },
    },
  ];
}

// ─── i. Cron-job der ikke kører ───────────────────────────────────────────

export interface CronLastRunRow {
  jobName: string;
  lastRunAt: Date | null;
}

/**
 * Job der ikke kører hver dag, selvom intervallet er et døgn: mindste
 * tavshed før alarm (minutter). ai-suggestions kører man–fre, så fredag →
 * mandag er 72 t uden kørsel.
 */
export const STALE_CRON_MIN_THRESHOLD_MINUTES: Record<string, number> = {
  "ai-suggestions": 4 * 24 * 60,
};

export function detectStaleCrons(
  rows: CronLastRunRow[],
  expectedIntervalMinutes: Record<string, number>,
  now: Date,
): DetectedFinding[] {
  const lastRun = new Map(rows.map((r) => [r.jobName, r.lastRunAt]));
  const findings: DetectedFinding[] = [];
  for (const [jobName, interval] of Object.entries(expectedIntervalMinutes)) {
    const last = lastRun.get(jobName) ?? null;
    const thresholdMs =
      Math.max(2 * interval, STALE_CRON_MIN_THRESHOLD_MINUTES[jobName] ?? 0) *
      60_000;
    if (last && now.getTime() - last.getTime() <= thresholdMs) continue;
    findings.push({
      detector: "cron_stale",
      // Aldrig kørt (inden for opslagsvinduet) = nyt job eller sjældent
      // job — vises, men alarmerer ikke.
      severity: last ? "warning" : "info",
      fingerprint: `cron_stale:${jobName}`,
      userId: null,
      organizationId: null,
      title: last
        ? `Cron-jobbet ${jobName} har ikke kørt siden ${last.toISOString()} (forventet hvert ${interval}. min)`
        : `Cron-jobbet ${jobName} har ikke kørt i opslagsvinduet`,
      occurrenceKeys: [],
      sample: {
        jobName,
        lastRunAt: iso(last),
        expectedIntervalMinutes: interval,
      },
    });
  }
  return findings;
}

// ─── j. Gamle klientversioner ─────────────────────────────────────────────

/** timer_events de seneste 24 t, grupperet pr. org+kilde+client_hint. */
export interface ClientVersionRow {
  organizationId: string | null;
  source: string;
  clientHint: string | null;
  /** Antal hændelser */
  n: number;
  /** Heraf client_too_old (afvist af minimumsversionen) */
  rejected: number;
  /** Antal forskellige brugere */
  users: number;
  lastAt: Date;
}

type ClientVersionClass = "below" | "unknown" | "ok";

function classifyVersionRow(
  r: ClientVersionRow,
  minimums: MinClientVersions,
): { cls: ClientVersionClass; label: string } {
  const { kind, version } = classifyClientHint(r.clientHint);
  const label =
    kind && version ? `${kind} ${version}` : (r.clientHint ?? "ukendt");
  if (r.rejected > 0) return { cls: "below", label };
  // Extension uden header er 2.5.1 eller ældre
  const effective =
    kind === "extension" && !version ? LEGACY_EXTENSION_VERSION : version;
  const verdict = evaluateClientVersion(
    { kind, version: effective, declared: !!version },
    minimums,
  );
  if (verdict.status === "too_old") return { cls: "below", label };
  // Kun extensionen burde sende headeren nu; web-faner fra før deployet,
  // mobil og desktop mangler den endnu og ville bare give støj.
  if (!version) return { cls: kind === "extension" ? "unknown" : "ok", label };
  return { cls: verdict.status === "ok" ? "ok" : "unknown", label };
}

/**
 * Hvem skriver stadig med en gammel klient? Pr. org: skrivninger under
 * MIN_CLIENT_VERSIONS (eller afvist som client_too_old) er en advarsel;
 * skrivninger fra extension uden versionsheader (≤ 2.5.1) er info — så man
 * kan se hvem der skal opdatere, før minimummet hæves.
 */
export function detectOutdatedClients(
  rows: ClientVersionRow[],
  minimums: MinClientVersions,
): DetectedFinding[] {
  const findings: DetectedFinding[] = [];
  const classified = rows.map((r) => ({
    r,
    ...classifyVersionRow(r, minimums),
  }));
  const groups = groupBy(
    classified.filter((x) => x.cls !== "ok"),
    (x) => `${x.r.organizationId ?? "ingen-org"}|${x.cls}`,
  );
  for (const [key, list] of groups) {
    const [org, cls] = key.split("|") as [string, ClientVersionClass];
    const byLabel = new Map<
      string,
      { n: number; users: number; rejected: number; sources: Set<string> }
    >();
    for (const x of list) {
      const agg = byLabel.get(x.label) ?? {
        n: 0,
        users: 0,
        rejected: 0,
        sources: new Set<string>(),
      };
      agg.n += x.r.n;
      agg.users = Math.max(agg.users, x.r.users);
      agg.rejected += x.r.rejected;
      agg.sources.add(x.r.source);
      byLabel.set(x.label, agg);
    }
    const sorted = [...byLabel.entries()].sort((a, b) => b[1].n - a[1].n);
    const total = sorted.reduce((sum, [, a]) => sum + a.n, 0);
    const summary = sorted
      .slice(0, 3)
      .map(
        ([label, a]) =>
          `${label} ${a.n}×${a.users > 1 ? ` (${a.users} brugere)` : ""}`,
      )
      .join(", ");
    findings.push({
      detector: "outdated_client",
      severity: cls === "below" ? "warning" : "info",
      fingerprint: `outdated_client:${org}:${cls}`,
      userId: null,
      organizationId: list[0].r.organizationId,
      title:
        cls === "below"
          ? `${total} skrivning${total === 1 ? "" : "er"} fra klienter under minimumsversionen (24 t): ${summary}`
          : `${total} skrivning${total === 1 ? "" : "er"} fra extension uden versionsheader (≤ 2.5.1, 24 t): ${summary}`,
      occurrenceKeys: [],
      sample: {
        minimums,
        clients: sorted.slice(0, MAX_SAMPLES).map(([label, a]) => ({
          client: label,
          writes: a.n,
          users: a.users,
          rejected: a.rejected,
          sources: [...a.sources],
        })),
      },
    });
  }
  return findings;
}
