import { sql } from "drizzle-orm";
import { timeEntries, timerStates } from "@/lib/db/schema";
import { RESURRECTION_TOLERANCE_SECONDS } from "./resurrection-rules";

/**
 * Sikkerhedsnet mod GENOPSTANDNE timere (kunde A 1/10).
 *
 * En klient med forældet lokal tilstand (web-fanens localStorage, en
 * extension der har været offline) kan sende en "start" med en gammel
 * starttid efter at timeren er stoppet og gemt et andet sted. Lander den på
 * den ryddede række, kommer den stoppede session tilbage med gammel start og
 * gammel kunde — og bliver gemt én gang til (samme start, senere slut).
 *
 * Reglen: en skrivning der sætter `is_running = true` på en RYDDET række
 * (kører ikke, ingen elapsed, ingen base) afvises, når dens starttid ligger
 * før rækken blev ryddet OG falder inde i en allerede gemt tidspost fra
 * brugeren — dvs. sessionen ER gemt. Det andet led gør, at en offline-
 * afspillet stop→start (stoppet rydder rækken ved afspilning, efter den nye
 * starts tidspunkt) stadig virker, og at en klient med skævt ur kan starte
 * igen lige efter sit eget stop (postens sluttid kommer fra samme ur). Rydningstidspunktet er `last_synced_at` — den
 * sættes af alle run-state-skrivninger (confirmStop, clear, sync,
 * updateTimerState), men IKKE af idle-stempler/indstillinger, der kun rører
 * `updated_at`. `updated_at` er kun fallback hvis feltet mangler.
 *
 * Tolerancen (5 min) dækker ur-skævhed mellem klientens ur (starttiden) og
 * serverens (rydningstidspunktet). Genopstandne sessioner i prod var 30+ min
 * gamle; en ægte ny start har starttid ≈ nu.
 *
 * Prædikaterne indgår i den atomiske upserts `setWhere` — aldrig
 * read-then-write. De rene funktioner (resurrection-rules.ts, uden
 * databaseimporter, så klienten kan bruge dem) spejler SQL'en til tests og
 * dokumentation.
 */
export {
  isClearedTimerRow,
  isStaleStartOnClearedRow,
  RESURRECTION_TOLERANCE_SECONDS,
  type TimerRowSnapshot,
} from "./resurrection-rules";

/**
 * Rækken er ryddet: intet kører, ingen tid står på den, og projekt/kunde er
 * tomme (stop og nulstil rydder dem). En pause efter 0 sekunder beholder sit
 * projekt/kunde og er derfor IKKE ryddet — den skal kunne genoptages.
 */
export function clearedRowSql() {
  return sql`(NOT COALESCE(${timerStates.isRunning}, false) AND COALESCE(${timerStates.elapsedSeconds}, 0) = 0 AND COALESCE(${timerStates.baseSeconds}, 0) = 0 AND ${timerStates.projectId} IS NULL AND ${timerStates.clientId} IS NULL)`;
}

/**
 * Den foreslåede starttid (`excluded.start_time` — værdien fra upsertens
 * VALUES) mangler eller ligger før rækken blev ryddet. Begge sider er
 * `timestamp without time zone` skrevet af drizzle i UTC, så de kan
 * sammenlignes direkte — og ingen JS-Date bindes i rå SQL.
 */
export function staleStartSql() {
  return sql`(excluded.start_time IS NULL OR excluded.start_time < COALESCE(${timerStates.lastSyncedAt}, ${timerStates.updatedAt}) - interval '${sql.raw(String(RESURRECTION_TOLERANCE_SECONDS))} seconds')`;
}

/**
 * Den foreslåede starttid ligger inde i en allerede gemt post fra brugeren
 * (startet senest ved den og sluttet mere end tolerancen efter den).
 * Atomisk underforespørgsel i samme sætning — ingen read-then-write.
 */
export function startCoveredBySavedEntrySql() {
  const tol = sql.raw(`interval '${RESURRECTION_TOLERANCE_SECONDS} seconds'`);
  return sql`EXISTS (SELECT 1 FROM ${timeEntries} WHERE ${timeEntries.userId} = ${timerStates.userId} AND ${timeEntries.startTime} <= excluded.start_time + ${tol} AND ${timeEntries.endTime} > excluded.start_time + ${tol})`;
}

/**
 * setWhere-prædikat: lad skrivningen lande, medmindre den ville genoplive en
 * ryddet række med en gammel (eller manglende) starttid. COALESCE gør det
 * NULL-sikkert: et ukendt rydningstidspunkt blokerer ikke.
 */
export function noResurrectionGuardSql() {
  return sql`NOT COALESCE((${clearedRowSql()} AND (excluded.start_time IS NULL OR (${staleStartSql()} AND ${startCoveredBySavedEntrySql()}))), false)`;
}
