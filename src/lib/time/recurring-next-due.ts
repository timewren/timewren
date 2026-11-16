import {
  addDaysToDateStr,
  addMonthsToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  isoWeekdayOfDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";

/** JS-ugedag (0 = søndag … 6 = lørdag) for en dato-streng. */
function jsWeekday(dateStr: string): number {
  return isoWeekdayOfDateStr(dateStr) % 7;
}

/**
 * Næste forekomst (dansk dato) for en gentagelse: første dato efter
 * `todayStr`, regnet frem fra `fromDateStr`. En `fromDateStr` der allerede
 * ligger efter i dag bruges som den er (ugentlig med ugedag dog først når
 * ugedagen passer). Ren kalender-aritmetik på "yyyy-MM-dd" — uafhængig af
 * processens TZ og sommertid (#734).
 *
 * `dayOfWeek` følger JS' `getDay()` (0 = søndag). `dayOfMonth` klemmes til
 * månedens længde, så korte måneder aldrig springes over.
 */
export function nextRecurringDateStr(
  frequency: string,
  fromDateStr: string,
  todayStr: string,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
): string {
  let next = fromDateStr;

  if (frequency === "daily") {
    while (next <= todayStr) next = addDaysToDateStr(next, 1);
  } else if (frequency === "weekly") {
    if (dayOfWeek !== null && dayOfWeek !== undefined) {
      while (jsWeekday(next) !== dayOfWeek || next <= todayStr) {
        next = addDaysToDateStr(next, 1);
      }
    } else {
      while (next <= todayStr) next = addDaysToDateStr(next, 7);
    }
  } else if (frequency === "monthly") {
    if (dayOfMonth) {
      while (next <= todayStr) {
        const firstOfNext = addMonthsToDateStr(`${next.slice(0, 7)}-01`, 1);
        next = clampDayOfMonth(firstOfNext, dayOfMonth);
      }
    } else {
      // Fra startdatoen hver gang, så dagen ikke glider (31. → 28. → 28.)
      for (let k = 1; next <= todayStr; k++) {
        next = addMonthsToDateStr(fromDateStr, k);
      }
    }
  } else {
    // Ukendt frekvens — +1 dag, så cron-jobbet ikke kører i ring
    next = addDaysToDateStr(next, 1);
  }

  return next;
}

/** `dayOfMonth` i måneden for `firstOfMonth`, klemt til månedens længde. */
export function clampDayOfMonth(
  firstOfMonth: string,
  dayOfMonth: number,
): string {
  const lastDay = Number(
    addDaysToDateStr(addMonthsToDateStr(firstOfMonth, 1), -1).slice(8, 10),
  );
  const day = Math.min(dayOfMonth, lastDay);
  return `${firstOfMonth.slice(0, 8)}${String(day).padStart(2, "0")}`;
}

/**
 * Tidspunktet hvor en gentagelse forfalder næste gang: dansk midnat på
 * `nextRecurringDateStr`. `from` er startdatoen (ved oprettelse/redigering)
 * eller kørselstidspunktet (cron).
 */
export function calculateNextDue(
  frequency: string,
  from: Date,
  dayOfWeek?: number | null,
  dayOfMonth?: number | null,
  now: Date = new Date(),
): Date {
  return copenhagenDayStart(
    nextRecurringDateStr(
      frequency,
      toCopenhagenDateStr(from),
      copenhagenToday(now),
      dayOfWeek,
      dayOfMonth,
    ),
  );
}
