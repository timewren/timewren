import { type SQL, sql } from "drizzle-orm";
import { timerStates } from "@/lib/db/schema";

/**
 * "Rammer skrivningen den session, klienten tror den rammer?" (A7 M1/M3/S2).
 *
 * `expectedVersion` beviser kun, at ingen har skrevet siden klientens sidste
 * læsning — ikke at det er SAMME session. En mobil med forældet lokal
 * tilstand (ingen realtime, afstemmer kun ved forgrund) kunne derfor stoppe,
 * kassere eller omskrive en helt anden session, der var startet på web.
 *
 * Sessionens identitet er dens starttid. Klienter kan sende den som
 * `expectedStartTime` (ms); den indgår da i den atomiske UPDATE'S WHERE /
 * upsertens setWhere — aldrig read-then-write.
 *
 * Tolerancen dækker afrunding mellem klientens ms og kolonnens mikrosekunder.
 */
export const SESSION_MATCH_TOLERANCE_SECONDS = 1;

/** Spejler `expectedStartSql` — til tests og klassifikation af afvisninger. */
export function isSameSessionStart(
  rowStart: Date | null | undefined,
  expected: Date,
): boolean {
  if (!rowStart) return false;
  return (
    Math.abs(rowStart.getTime() - expected.getTime()) <=
    SESSION_MATCH_TOLERANCE_SECONDS * 1000
  );
}

/**
 * Rækkens start matcher den forventede. `start_time` er `timestamp without
 * time zone` skrevet af drizzle i UTC, så den forventede bindes som ISO-streng
 * og omregnes til UTC i SQL (ingen JS-Date i rå SQL).
 */
export function expectedStartSql(expectedStartTime: number): SQL {
  const iso = new Date(expectedStartTime).toISOString();
  return sql`(${timerStates.startTime} IS NOT NULL AND abs(extract(epoch from (${timerStates.startTime} - (${iso}::timestamptz AT TIME ZONE 'UTC')))) <= ${sql.raw(String(SESSION_MATCH_TOLERANCE_SECONDS))})`;
}

/** Heartbeatets egen start (`excluded.start_time`) matcher rækkens. */
function heartbeatSameStartSql(): SQL {
  return sql`(${timerStates.startTime} IS NOT NULL AND excluded.start_time IS NOT NULL AND abs(extract(epoch from (excluded.start_time - ${timerStates.startTime}))) <= ${sql.raw(String(SESSION_MATCH_TOLERANCE_SECONDS))})`;
}

/**
 * Ekstra setWhere-vagt for et heartbeat (fx projektskift på mobilen):
 * - med `expectedStartTime`: rækken skal bære den forventede session.
 * - fra et ældre mobil-build (sender ingen forventet start, men altid sin
 *   lokale sessions start i heartbeatet og har ingen pause): heartbeatets
 *   start skal matche rækkens. Ellers ville en forældet telefon sætte en ny
 *   web-sessions start og kunde tilbage til den gamle (A7 M3).
 * - ellers (web/extension): ingen ekstra vagt — uændret adfærd.
 */
export function heartbeatSessionGuardSql(opts: {
  expectedStartTime: number | undefined;
  legacyNativeApp: boolean;
}): SQL | undefined {
  if (opts.expectedStartTime !== undefined) {
    return expectedStartSql(opts.expectedStartTime);
  }
  if (opts.legacyNativeApp) return heartbeatSameStartSql();
  return undefined;
}

/**
 * Kommer kaldet fra mobilappens (React Native) fetch? Den sender kun sin
 * session-cookie: ingen Origin, ingen Authorization, og ingen browser-UA
 * ("Mozilla/…" — det sender alle browsere og extensionen). API-nøglekald
 * bærer Authorization og rammes ikke.
 */
export function isLegacyNativeAppRequest(headers: Headers | null): boolean {
  if (!headers) return false;
  if (!headers.get("cookie")) return false;
  if (headers.get("origin") || headers.get("authorization")) return false;
  const ua = headers.get("user-agent") ?? "";
  return !ua.includes("Mozilla/");
}
