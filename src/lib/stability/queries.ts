/**
 * Stabilitetsvagten — afgrænsede SQL-forespørgsler, én pr. detektor.
 *
 * Regler:
 * - Altid et tidsvindue på en indekseret kolonne (time_entries.created_at,
 *   timer_events.created_at) eller en lille tabel (timer_states: én række
 *   pr. bruger). Altid LIMIT.
 * - Tidsstempler er "timestamp without time zone" i UTC. Vinduer beregnes
 *   som `(now() AT TIME ZONE 'UTC')` eller som en eksplicit UTC-streng, og
 *   rå SQL-tidsstempler læses med parseDbTimestamp (ellers tolkes de som
 *   lokal tid efter et TZ-skift — jf. #777).
 */

import { sql } from "drizzle-orm";
import type { db as DbClient } from "@/lib/db";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { TIMER_REJECTION_EVENTS } from "@/lib/timer/event-names";
import { ZOMBIE_REASON } from "@/lib/timer/zombie";
import type {
  ClientChangeRow,
  ClientVersionRow,
  CronLastRunRow,
  DuplicatePairRow,
  EntryDateRow,
  EntrySpanRow,
  PrepaidPackageRow,
  RunningTimerRow,
  SessionOverlapRow,
  SignalCountRow,
  StaleClientContext,
  TimeChangeRow,
  ZombieClearRow,
} from "./detectors";
import {
  RUNAWAY_HOURS,
  SESSION_OVERLAP_MIN_SECONDS,
  STALE_CLIENT_EVENTS,
  TIMER_ENTRY_SOURCES,
} from "./detectors";

type Db = Pick<typeof DbClient, "execute">;

const ROW_LIMIT = 500;

/** Date → "YYYY-MM-DD HH:MM:SS.mmm" (UTC, uden zone) til ::timestamp */
export function toUtcSql(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

function ts(v: unknown): Date | null {
  return parseDbTimestamp(v as Date | string | null | undefined);
}

function tsRequired(v: unknown): Date {
  return ts(v) ?? new Date(Number.NaN);
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  return v === null || v === undefined ? null : String(v);
}

async function rows(db: Db, query: ReturnType<typeof sql>) {
  return (await db.execute(query)) as unknown as Record<string, unknown>[];
}

/**
 * SQL: posten (alias `t`) stammer fra en timer — source i
 * TIMER_ENTRY_SOURCES, eller en timer-hændelse har samme sessionsstart
 * (±3 s). Web-timerens stop gemmer med source "manual", så source alene er
 * ikke nok. Opslaget bruger timer_events_user_created_idx.
 */
function timerOriginSql(t: string) {
  const alias = sql.raw(t);
  const sources = sql.join(
    TIMER_ENTRY_SOURCES.map((s) => sql`${s}`),
    sql`, `,
  );
  return sql`(${alias}.source IN (${sources}) OR EXISTS (
    SELECT 1 FROM timer_events ev
    WHERE ev.user_id = ${alias}.user_id
      AND ev.created_at >= ${alias}.start_time - interval '1 day'
      AND ev.created_at <= ${alias}.created_at + interval '5 minutes'
      AND ev.start_time BETWEEN ${alias}.start_time - interval '3 seconds'
                            AND ${alias}.start_time + interval '3 seconds'
  ))`;
}

function bool(v: unknown): boolean {
  return v === true || v === "t" || v === "true";
}

// a. Dobbelt-gemte sessioner
export async function queryDuplicatePairs(
  db: Db,
  since: Date,
): Promise<DuplicatePairRow[]> {
  const result = await rows(
    db,
    sql`SELECT a.user_id, a.organization_id, a.id AS entry_id, a.start_time,
          a.source, a.hours::float8 AS hours,
          b.id AS other_id, b.start_time AS other_start,
          b.source AS other_source, b.hours::float8 AS other_hours,
          (${timerOriginSql("a")} OR ${timerOriginSql("b")}) AS timer_origin,
          (a.project_id IS NOT DISTINCT FROM b.project_id
            AND a.client_id IS NOT DISTINCT FROM b.client_id) AS same_assignment,
          (a.timer_session_id IS NOT NULL AND b.timer_session_id IS NOT NULL
            AND a.timer_session_id <> b.timer_session_id) AS distinct_sessions
        FROM time_entries a
        JOIN time_entries b
          ON b.user_id = a.user_id
         AND b.id <> a.id
         AND b.date BETWEEN a.date - interval '1 day' AND a.date + interval '1 day'
         AND b.start_time BETWEEN a.start_time - interval '3 seconds'
                              AND a.start_time + interval '3 seconds'
        WHERE a.created_at >= ${toUtcSql(since)}::timestamp
          AND a.start_time IS NOT NULL
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    entryId: String(r.entry_id),
    startTime: tsRequired(r.start_time),
    source: str(r.source),
    hours: num(r.hours),
    otherEntryId: String(r.other_id),
    otherStartTime: tsRequired(r.other_start),
    otherSource: str(r.other_source),
    otherHours: num(r.other_hours),
    timerOrigin: bool(r.timer_origin),
    sameAssignment: bool(r.same_assignment),
    distinctSessions: bool(r.distinct_sessions),
  }));
}

/**
 * a2. To poster fra samme timer-session: `a` bærer sessionens
 * timer_session_id, `b` (uden sessions-id) overlapper sessionens tidsrum med
 * mindst SESSION_OVERLAP_MIN_SECONDS. To grene, hver drevet af poster OPRETTET
 * i vinduet (time_entries_created_at_idx) — a ny (2.6.0 gemte sidst) eller b
 * ny (den ældre klients rest kom sidst). Modparten slås op via
 * time_entries_user_id_date_idx (samme bruger, dato ±1 dag), sessionen via
 * primærnøglen. timer_sessions er timestamptz; posterne er UTC uden zone, så
 * sessionens tider konverteres med AT TIME ZONE 'UTC'.
 *
 * timer_events bruges ikke: posternes gem logges ikke med sessions-id (kun
 * claim/confirm), så loggen kan ikke knytte en post til en session.
 *
 * EXPLAIN (lokal Postgres 17, ~50k poster, 200 brugere, 15 min-vindue):
 * begge grene er Nested Loop drevet af time_entries_created_at_idx;
 * sessionen via timer_sessions_pkey; modparten via
 * time_entries_user_id_date_idx (gren a) hhv. Bitmap Index Scan på
 * time_entries_user_id_date_idx med user_id + dato-interval (gren b). Ingen
 * seq scan. Først ved et døgns vindue (~1000 driver-rækker, fx efter lang
 * nedetid) vælger planneren hash join + seq scan i gren b: ~46 ms.
 */
export async function querySessionOverlapPairs(
  db: Db,
  since: Date,
): Promise<SessionOverlapRow[]> {
  const sinceSql = sql`${toUtcSql(since)}::timestamp`;
  const minOverlap = SESSION_OVERLAP_MIN_SECONDS;
  // Fælles kolonner og join-betingelser for begge grene
  const select = sql`SELECT a.user_id, a.organization_id, s.id AS session_id,
          s.started_at AT TIME ZONE 'UTC' AS session_start,
          COALESCE(s.ended_at AT TIME ZONE 'UTC', a.end_time) AS session_end,
          a.id AS entry_id, a.start_time, a.end_time, a.source,
          a.hours::float8 AS hours,
          b.id AS other_id, b.start_time AS other_start, b.end_time AS other_end,
          b.source AS other_source, b.hours::float8 AS other_hours,
          (a.project_id IS NOT DISTINCT FROM b.project_id
            AND a.client_id IS NOT DISTINCT FROM b.client_id) AS same_assignment`;
  const overlap = sql`b.user_id = a.user_id
         AND b.id <> a.id
         AND b.timer_session_id IS NULL
         AND b.start_time IS NOT NULL AND b.end_time IS NOT NULL
         AND b.date BETWEEN a.date - interval '1 day' AND a.date + interval '1 day'
         AND s.user_id = a.user_id
         AND LEAST(b.end_time, COALESCE(s.ended_at AT TIME ZONE 'UTC', a.end_time))
             - GREATEST(b.start_time, s.started_at AT TIME ZONE 'UTC')
             >= make_interval(secs => ${minOverlap})`;
  const result = await rows(
    db,
    sql`(${select}
        FROM time_entries a
        JOIN timer_sessions s ON s.id = a.timer_session_id
        JOIN time_entries b ON ${overlap}
        WHERE a.created_at >= ${sinceSql}
          AND a.timer_session_id IS NOT NULL
        LIMIT ${ROW_LIMIT})
      UNION
      (${select}
        FROM time_entries b
        JOIN time_entries a ON a.user_id = b.user_id
         AND a.timer_session_id IS NOT NULL
         AND a.date BETWEEN b.date - interval '1 day' AND b.date + interval '1 day'
        JOIN timer_sessions s ON s.id = a.timer_session_id AND ${overlap}
        WHERE b.created_at >= ${sinceSql}
          AND b.timer_session_id IS NULL
        LIMIT ${ROW_LIMIT})
      LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    sessionId: String(r.session_id),
    sessionStartedAt: tsRequired(r.session_start),
    sessionEndedAt: tsRequired(r.session_end),
    entryId: String(r.entry_id),
    startTime: tsRequired(r.start_time),
    endTime: tsRequired(r.end_time),
    source: str(r.source),
    hours: num(r.hours),
    otherEntryId: String(r.other_id),
    otherStartTime: tsRequired(r.other_start),
    otherEndTime: tsRequired(r.other_end),
    otherSource: str(r.other_source),
    otherHours: num(r.other_hours),
    sameAssignment: bool(r.same_assignment),
  }));
}

// b. Afvisnings-signaler pr. bruger+klient den seneste time
export async function querySignalCounts(db: Db): Promise<SignalCountRow[]> {
  const events = sql.join(
    STALE_CLIENT_EVENTS.map((e) => sql`${e}`),
    sql`, `,
  );
  const result = await rows(
    db,
    sql`SELECT user_id, max(organization_id) AS organization_id, event, source,
          client_hint, count(*)::int AS n, max(created_at) AS last_at
        FROM timer_events
        WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '1 hour'
          AND event IN (${events})
        GROUP BY user_id, event, source, client_hint
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    event: String(r.event),
    source: String(r.source),
    clientHint: str(r.client_hint),
    n: num(r.n),
    lastAt: tsRequired(r.last_at),
  }));
}

/**
 * Konteksten til stale_client for brugere med versionskonflikter i timen:
 * deres vellykkede skrivninger (hvem ellers skriver?) og rækkens seneste
 * skriver. Afvisninger tælles ikke som skrivninger.
 */
export async function queryStaleClientContext(
  db: Db,
): Promise<Required<Pick<StaleClientContext, "writers" | "owners">>> {
  const rejections = sql.join(
    [...TIMER_REJECTION_EVENTS].map((e) => sql`${e}`),
    sql`, `,
  );
  const conflictUsers = sql`SELECT DISTINCT user_id FROM timer_events
    WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '1 hour'
      AND event = 'version_conflict'`;
  const writers = await rows(
    db,
    sql`SELECT user_id, event, source, client_hint, count(*)::int AS n
        FROM timer_events
        WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '1 hour'
          AND event NOT IN (${rejections})
          AND user_id IN (${conflictUsers})
        GROUP BY user_id, event, source, client_hint
        LIMIT ${ROW_LIMIT}`,
  );
  const owners = await rows(
    db,
    sql`SELECT user_id, last_synced_from, last_synced_at
        FROM timer_states
        WHERE user_id IN (${conflictUsers})
        LIMIT ${ROW_LIMIT}`,
  );
  return {
    writers: writers.map((r) => ({
      userId: String(r.user_id),
      event: String(r.event),
      source: String(r.source),
      clientHint: str(r.client_hint),
      n: num(r.n),
    })),
    owners: owners.map((r) => ({
      userId: String(r.user_id),
      lastSyncedFrom: str(r.last_synced_from),
      lastSyncedAt: ts(r.last_synced_at),
    })),
  };
}

// c1. Løbske timere (timer_states er én række pr. bruger)
export async function queryRunningTimers(db: Db): Promise<RunningTimerRow[]> {
  const result = await rows(
    db,
    sql`SELECT user_id, organization_id, start_time,
          coalesce(base_seconds, 0) AS base_seconds,
          last_synced_from, last_synced_at, auto_pause_after_minutes
        FROM timer_states
        WHERE is_running = true
          AND start_time IS NOT NULL
          AND coalesce(base_seconds, 0)
              + extract(epoch FROM ((now() AT TIME ZONE 'UTC') - start_time))
              > ${RUNAWAY_HOURS * 3600}
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    startTime: tsRequired(r.start_time),
    baseSeconds: num(r.base_seconds),
    lastSyncedFrom: str(r.last_synced_from),
    lastSyncedAt: ts(r.last_synced_at),
    autoPauseAfterMinutes: numOrNull(r.auto_pause_after_minutes),
  }));
}

// c1b. Zombie-timere ryddet af timer-cleanup (timer_events-loggen)
export async function queryZombieClears(
  db: Db,
  since: Date,
): Promise<ZombieClearRow[]> {
  const result = await rows(
    db,
    sql`SELECT id, user_id, organization_id, created_at,
          detail->>'discardedStartTime' AS discarded_start,
          detail->>'discardedHours' AS discarded_hours,
          detail->>'lastSyncedFrom' AS last_synced_from
        FROM timer_events
        WHERE event = 'clear'
          AND source = 'cron'
          AND detail->>'reason' = ${ZOMBIE_REASON}
          AND created_at >= ${toUtcSql(since)}::timestamp
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    eventId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    createdAt: tsRequired(r.created_at),
    discardedStartTime: str(r.discarded_start),
    discardedHours: numOrNull(r.discarded_hours),
    lastSyncedFrom: str(r.last_synced_from),
  }));
}

// c2. Tidsspring (time_change-hændelser)
export async function queryTimeChanges(
  db: Db,
  since: Date,
): Promise<TimeChangeRow[]> {
  const result = await rows(
    db,
    sql`SELECT id, user_id, organization_id, created_at, source, client_hint,
          start_time, base_seconds,
          detail->>'prevStartTime' AS prev_start,
          detail->>'prevBaseSeconds' AS prev_base
        FROM timer_events
        WHERE event = 'time_change'
          AND created_at >= ${toUtcSql(since)}::timestamp
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    eventId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    createdAt: tsRequired(r.created_at),
    source: String(r.source),
    clientHint: str(r.client_hint),
    startTime: ts(r.start_time),
    baseSeconds: numOrNull(r.base_seconds),
    // prevStartTime er gemt som ISO med Z af routerne
    prevStartTime: ts(r.prev_start),
    prevBaseSeconds: numOrNull(r.prev_base),
  }));
}

// d. Kundeskift + hvilken overflade der startede sessionen
export async function queryClientChanges(
  db: Db,
  since: Date,
): Promise<ClientChangeRow[]> {
  const result = await rows(
    db,
    sql`SELECT e.id, e.user_id, e.organization_id, e.created_at, e.source,
          e.client_hint, e.start_time, e.client_id,
          e.detail->>'prevClientId' AS prev_client_id,
          o.source AS origin_source, o.client_hint AS origin_hint,
          rej.n AS stale_rejections
        FROM timer_events e
        LEFT JOIN LATERAL (
          SELECT s.source, s.client_hint
          FROM timer_events s
          WHERE s.user_id = e.user_id
            AND s.start_time = e.start_time
            AND s.event IN ('start', 'resume', 'adopt')
            AND s.created_at <= e.created_at
            AND s.created_at >= e.created_at - interval '2 days'
          ORDER BY s.created_at DESC
          LIMIT 1
        ) o ON true
        CROSS JOIN LATERAL (
          -- Afvisninger fra forældede klienter i sessionens løbetid
          SELECT count(*)::int AS n
          FROM timer_events r
          WHERE r.user_id = e.user_id
            AND r.created_at >= coalesce(e.start_time, e.created_at - interval '1 hour')
            AND r.created_at <= e.created_at + interval '5 minutes'
            AND r.event IN ('blocked_resurrection', 'claim_rejected',
                            'version_conflict', 'heartbeat_rejected')
        ) rej
        WHERE e.event = 'client_change'
          AND e.created_at >= ${toUtcSql(since)}::timestamp
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    eventId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    createdAt: tsRequired(r.created_at),
    source: String(r.source),
    clientHint: str(r.client_hint),
    startTime: ts(r.start_time),
    clientId: str(r.client_id),
    prevClientId: str(r.prev_client_id),
    originSource: str(r.origin_source),
    originHint: str(r.origin_hint),
    staleRejections: num(r.stale_rejections),
  }));
}

// e. Timer ≠ slut − start
export async function queryHoursMismatch(
  db: Db,
  since: Date,
): Promise<EntrySpanRow[]> {
  const result = await rows(
    db,
    sql`SELECT te.id, te.user_id, te.organization_id, te.source,
          te.hours::float8 AS hours, te.start_time, te.end_time,
          EXISTS (
            SELECT 1 FROM time_entry_segments s WHERE s.time_entry_id = te.id
          ) AS has_segments,
          ${timerOriginSql("te")} AS timer_origin
        FROM time_entries te
        WHERE te.created_at >= ${toUtcSql(since)}::timestamp
          AND te.start_time IS NOT NULL
          AND te.end_time IS NOT NULL
          AND abs(te.hours - extract(epoch FROM (te.end_time - te.start_time)) / 3600) > 0.25
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    entryId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    source: str(r.source),
    hours: num(r.hours),
    startTime: tsRequired(r.start_time),
    endTime: tsRequired(r.end_time),
    hasSegments: bool(r.has_segments),
    timerOrigin: bool(r.timer_origin),
  }));
}

// f. Dato ≠ dansk dato for starttid
export async function queryDateMismatch(
  db: Db,
  since: Date,
): Promise<EntryDateRow[]> {
  const result = await rows(
    db,
    sql`SELECT id, user_id, organization_id, source,
          to_char(date, 'YYYY-MM-DD') AS date_str, start_time
        FROM time_entries
        WHERE created_at >= ${toUtcSql(since)}::timestamp
          AND start_time IS NOT NULL
          AND to_char(date, 'YYYY-MM-DD') <> to_char(
            (start_time AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Copenhagen',
            'YYYY-MM-DD')
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    entryId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    source: str(r.source),
    dateStr: String(r.date_str),
    startTime: tsRequired(r.start_time),
  }));
}

// g. Klippekort med aktivitet de seneste 7 dage
export async function queryPrepaidPackages(
  db: Db,
): Promise<PrepaidPackageRow[]> {
  const result = await rows(
    db,
    sql`WITH active AS (
          SELECT prepaid_package_id AS id FROM prepaid_usage
          WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days'
          UNION
          SELECT prepaid_package_id FROM time_entries
          WHERE created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days'
            AND prepaid_package_id IS NOT NULL
        )
        SELECT p.id, p.user_id, p.organization_id, p.name,
          p.total_hours::float8 AS total_hours,
          coalesce(p.used_hours, 0)::float8 AS used_hours,
          p.remaining_hours::float8 AS remaining_hours,
          u.usage_rows, u.usage_net,
          coalesce(m.missing, 0) AS missing, m.sample_ids
        FROM prepaid_packages p
        JOIN active a ON a.id = p.id
        CROSS JOIN LATERAL (
          SELECT count(*)::int AS usage_rows,
            coalesce(sum(hours_used - overdraft_hours), 0)::float8 AS usage_net
          FROM prepaid_usage WHERE prepaid_package_id = p.id
        ) u
        LEFT JOIN (
          -- Ét samlet opslag over 7-dagesvinduet (created_at-indekset)
          SELECT te.prepaid_package_id AS package_id,
            count(*)::int AS missing,
            (array_agg(te.id::text))[1:5] AS sample_ids
          FROM time_entries te
          WHERE te.created_at >= (now() AT TIME ZONE 'UTC') - interval '7 days'
            -- Giv stop-flowet tid til at trække, før vi kalder det et hul
            AND te.created_at < (now() AT TIME ZONE 'UTC') - interval '10 minutes'
            AND te.prepaid_package_id IS NOT NULL
            AND te.is_prepaid = true
            AND NOT EXISTS (
              SELECT 1 FROM prepaid_usage pu WHERE pu.time_entry_id = te.id
            )
          GROUP BY te.prepaid_package_id
        ) m ON m.package_id = p.id
        WHERE coalesce(p.is_archived, false) = false
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    packageId: String(r.id),
    userId: String(r.user_id),
    organizationId: str(r.organization_id),
    name: String(r.name ?? ""),
    totalHours: num(r.total_hours),
    usedHours: num(r.used_hours),
    remainingHours: num(r.remaining_hours),
    usageRows: num(r.usage_rows),
    usageNetHours: num(r.usage_net),
    entriesWithoutUsage: num(r.missing),
    sampleEntryIds: Array.isArray(r.sample_ids)
      ? (r.sample_ids as unknown[]).map(String)
      : [],
  }));
}

// i. Seneste kørsel pr. cron-job (70 dage dækker 2× månedsjob)
export async function queryCronLastRuns(db: Db): Promise<CronLastRunRow[]> {
  const result = await rows(
    db,
    sql`SELECT job_name, max(started_at) AS last_run_at
        FROM cron_job_logs
        WHERE started_at >= (now() AT TIME ZONE 'UTC') - interval '70 days'
        GROUP BY job_name`,
  );
  return result.map((r) => ({
    jobName: String(r.job_name),
    lastRunAt: ts(r.last_run_at),
  }));
}

/** Seneste kørsel af stabilitetsvagten uanset status (dead-man's switch). */
export async function queryLastWatchAttempt(db: Db): Promise<Date | null> {
  const result = await rows(
    db,
    sql`SELECT max(started_at) AS last_run
        FROM cron_job_logs
        WHERE job_name = 'stability-watch'
          AND started_at >= (now() AT TIME ZONE 'UTC') - interval '2 days'`,
  );
  return ts(result[0]?.last_run);
}

/** Starttidspunkt for vagtens seneste fuldførte kørsel (før denne). */
export async function queryLastWatchRun(db: Db): Promise<Date | null> {
  const result = await rows(
    db,
    sql`SELECT max(started_at) AS last_run
        FROM cron_job_logs
        WHERE job_name = 'stability-watch'
          -- Kun fuldt vellykkede: en kørsel hvor en detektor fejlede, må ikke
          -- flytte vinduet forbi de hændelser, den detektor ikke så
          AND status = 'success'
          AND started_at >= (now() AT TIME ZONE 'UTC') - interval '2 days'`,
  );
  return ts(result[0]?.last_run);
}

// j. Klienttyper/-versioner der har skrevet timer-hændelser de seneste 24 t.
// Org: hændelsens egen, ellers brugerens primære (afviste kald kendes kun
// på brugeren). cron/api er ikke klienter med en version.
export async function queryClientVersions(db: Db): Promise<ClientVersionRow[]> {
  const result = await rows(
    db,
    sql`SELECT coalesce(e.organization_id, (
            SELECT m.organization_id FROM members m
            WHERE m.user_id = e.user_id
            ORDER BY (m.role = 'owner') DESC, m.organization_id
            LIMIT 1
          )) AS organization_id,
          e.source, e.client_hint,
          count(*)::int AS n,
          (count(*) FILTER (WHERE e.event = 'client_too_old'))::int AS rejected,
          count(DISTINCT e.user_id)::int AS users,
          max(e.created_at) AS last_at
        FROM timer_events e
        WHERE e.created_at >= (now() AT TIME ZONE 'UTC') - interval '24 hours'
          AND e.source NOT IN ('cron', 'api')
        GROUP BY 1, e.source, e.client_hint
        LIMIT ${ROW_LIMIT}`,
  );
  return result.map((r) => ({
    organizationId: str(r.organization_id),
    source: String(r.source),
    clientHint: str(r.client_hint),
    n: num(r.n),
    rejected: num(r.rejected),
    users: num(r.users),
    lastAt: tsRequired(r.last_at),
  }));
}
