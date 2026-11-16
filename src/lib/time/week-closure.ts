import {
  addDaysToDateStr,
  entryDateFromStr,
  toCopenhagenDateStr,
  weekStartDateStr,
} from "@/lib/time/copenhagen";

// Ugeafslutninger (#110) gemmes i `week_closures.week_start` (timestamp uden
// tidszone). Lagringskonventionen er den samme som for `time_entries.date`:
// UTC-midnat på den danske mandag. Det er præcis hvad den gamle kode skrev,
// mens prod kørte i UTC (lokal midnat = UTC-midnat), så eksisterende rækker
// matches uændret efter `TZ=Europe/Copenhagen` (#734).
//
// Streak-beregningen er tolerant: en række gemt ved dansk midnat (22:00Z/
// 23:00Z dagen før — fx fra en udviklingsmaskine i Europe/Copenhagen) tælles
// som samme mandag. Opslaget af "denne uge er lukket" er et eksakt `eq` på
// `weekClosureKey`; prod og beta havde 0 rækker ved skiftet (1/10-26).

/** Lagringsværdien for ugeafslutningen af ugen der starter `mondayStr`. */
export function weekClosureKey(mondayStr: string): Date {
  return entryDateFromStr(mondayStr);
}

/** Den danske mandag ("yyyy-MM-dd") for en gemt `week_start`. */
export function weekClosureDateStr(stored: Date): string {
  return toCopenhagenDateStr(stored);
}

/**
 * Antal sammenhængende lukkede uger, der ender i denne eller sidste uge.
 * En stribe fra januar må ikke vise "10 uger i træk" i juli.
 * `closures` er sorteret nyeste først.
 */
export function weekClosureStreak(
  closures: ReadonlyArray<Date>,
  todayStr: string,
): number {
  if (closures.length === 0) return 0;
  const thisMonday = weekStartDateStr(todayStr);
  const lastMonday = addDaysToDateStr(thisMonday, -7);
  const latest = weekClosureDateStr(closures[0]);
  if (latest < lastMonday) return 0;

  let streak = 0;
  let cursor = latest;
  for (const c of closures) {
    if (weekClosureDateStr(c) !== cursor) break;
    streak++;
    cursor = addDaysToDateStr(cursor, -7);
  }
  return streak;
}
