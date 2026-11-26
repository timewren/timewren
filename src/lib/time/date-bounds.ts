// Øvre grænser for datointervaller på `time_entries.date`.
//
// Kolonnen er `timestamp` uden tidszone, og Drizzle skriver/læser den som UTC.
// App-oprettede poster lander på UTC-midnat (`new Date("yyyy-MM-dd")`), men
// importerede, kalender- og timer-poster kan have et klokkeslæt. En inklusiv
// grænse på slutdagens midnat (`lte(date, new Date("2026-09-26"))`) taber
// derfor alle poster efter 00:00 på sidste dag. Brug i stedet en eksklusiv
// grænse på næste dags start: `lt(date, <start af dagen efter>)`.

import { type AnyColumn, and, gte, lt, lte, type SQL, sql } from "drizzle-orm";

import { copenhagenDayStart } from "./copenhagen";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Er strengen en ren dato ("yyyy-MM-dd") uden klokkeslæt? */
export function isDateOnlyString(value: string): boolean {
  return DATE_ONLY_RE.test(value);
}

/**
 * Start af UTC-dagen EFTER en "yyyy-MM-dd"-dato — samme tidsbasis som
 * `new Date("yyyy-MM-dd")`, der bruges til både lagring og startgrænsen.
 * Bruges som eksklusiv øvre grænse: `lt(date, endOfDayExclusive("2026-09-26"))`
 * giver alt på den 26. uanset klokkeslæt.
 */
export function endOfDayExclusive(dateStr: string): Date {
  if (!isDateOnlyString(dateStr)) {
    throw new Error(`Forventede yyyy-MM-dd, fik "${dateStr}"`);
  }
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1));
}

/**
 * Start af dagen efter `d` i serverens lokale tid — til grænser der allerede
 * er bygget med lokale Date-konstruktører (`new Date(y, m, d)`,
 * `parseLocalDateStr`). Giver samme resultat for midnat og 23:59:59.999, så
 * kaldere der allerede sender "slutningen af dagen" ikke ændrer adfærd.
 */
export function startOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
}

/**
 * Øvre grænse for en brugerangivet slutdato. En ren dato ("yyyy-MM-dd")
 * inkluderer hele dagen (eksklusiv grænse på næste dags start); et fuldt
 * tidsstempel respekteres som det er (inklusiv), så kaldere der allerede
 * sender slutningen af dagen er uændrede.
 */
export function dateUpperBound(column: AnyColumn, endDate: string): SQL {
  return isDateOnlyString(endDate)
    ? lt(column, endOfDayExclusive(endDate))
    : lte(column, new Date(endDate));
}

/**
 * Den danske dato (SQL `date`) for en `timestamp`-kolonne uden tidszone.
 * Kolonnerne holder UTC-vægur (Drizzle skriver `toISOString()`), så værdien
 * tolkes først som UTC og omregnes derefter til Europe/Copenhagen — uafhængigt
 * af sessionens `timezone`. UTC-midnat på en dato giver samme dato, og et
 * tidspunkt kl. 00:30 dansk tid lander på den danske dag (#649).
 */
export function copenhagenDateSql(column: AnyColumn | SQL): SQL<string> {
  return sql<string>`((${column} AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Copenhagen')::date`;
}

/** Half-open interval of Danish calendar dates for a UTC timestamp column. */
export function copenhagenDateRange(
  column: AnyColumn,
  from: string,
  until: string,
) {
  return and(
    gte(column, copenhagenDayStart(from)),
    lt(column, copenhagenDayStart(until)),
  );
}
