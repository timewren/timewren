import { toCopenhagenDateStr } from "@/lib/time/copenhagen";

/**
 * Starttiden på en tidspost fra en timer.
 *
 * En timer-post skal kunne rummes i sit eget tidsrum: timer ≤ slut − start.
 * Timeren tæller dog mere end vægur-tiden siden `startTime`, når brugeren
 * har lagt tid til ("startede tidligere", `base_seconds` uden at flytte
 * starten), og når den har været pauset og genoptaget (genoptagelsen sætter
 * `start_time` til genoptagelses-øjeblikket og bærer den tidligere tid i
 * `base_seconds`). Gemmes posten med den seneste segment-start, får den flere
 * timer end slut − start: stabilitetsvagten melder `hours_mismatch`, og
 * rapporter og tidslinjen viser posten på det forkerte tidspunkt
 * (prod 10.-19/11-2026).
 *
 * Reglen: kan timetallet ikke rummes i tidsrummet (mere end tolerancen),
 * flyttes starten til slut − timer. En pause (timer < tidsrum) er i orden og
 * røres ikke. Kun poster fra en timer normaliseres — manuelle, API- og
 * import-poster må gerne have timer ≠ tidsrum.
 */

/**
 * Hvor meget timetallet må overstige slut − start (timer). Samme tolerance
 * som stabilitetsvagtens `hours_mismatch`-detektor, så en normaliseret post
 * aldrig bliver meldt — og afrunding (timer gemmes i hundrededele) ikke
 * flytter starten på en ellers korrekt post.
 */
export const TIMER_SPAN_TOLERANCE_HOURS = 0.25;

const MS_PER_HOUR = 3_600_000;

/** `time_entries.hours` er numeric(5,2): starten regnes af det gemte tal. */
function storedHours(hours: number): number {
  return Math.round(hours * 100) / 100;
}

function validDate(d: Date | null | undefined): d is Date {
  return d instanceof Date && !Number.isNaN(d.getTime());
}

/**
 * Starttiden posten skal gemmes med: `startTime` uændret, eller slut − timer
 * når timetallet ikke kan rummes i tidsrummet. `null`/ugyldige tidspunkter
 * returneres uændret (posten har intet tidsrum at rette).
 */
export function timerEntryStart(input: {
  startTime: Date | null;
  endTime: Date | null;
  hours: number;
}): Date | null {
  const { startTime, endTime } = input;
  if (!validDate(startTime) || !validDate(endTime)) return startTime;
  const hours = storedHours(input.hours);
  if (!(hours > 0)) return startTime;
  const spanHours = (endTime.getTime() - startTime.getTime()) / MS_PER_HOUR;
  if (spanHours >= hours - TIMER_SPAN_TOLERANCE_HOURS) return startTime;
  return new Date(endTime.getTime() - Math.round(hours * MS_PER_HOUR));
}

/**
 * Normalisér en timer-gemning (ISO-strenge som i tRPC-inputtet). Flyttes
 * starten, følger datoen med, når den stod på den gamle starts danske dato —
 * en dato brugeren selv har valgt (en anden dag) røres ikke.
 */
export function normalizeTimerEntryInput<
  T extends {
    startTime?: string | null;
    endTime?: string | null;
    hours: number;
    date: string;
  },
>(input: T): T {
  if (!input.startTime || !input.endTime) return input;
  const start = new Date(input.startTime);
  const end = new Date(input.endTime);
  const next = timerEntryStart({
    startTime: start,
    endTime: end,
    hours: input.hours,
  });
  // Samme objekt = uændret (også et ugyldigt tidspunkt, som røres ikke)
  if (!next || next === start) return input;
  const datePinnedToStart = input.date === toCopenhagenDateStr(start);
  return {
    ...input,
    startTime: next.toISOString(),
    date: datePinnedToStart ? toCopenhagenDateStr(next) : input.date,
  };
}

/**
 * Klientens starttid for en stoppet timer: sessionens første start, men
 * aldrig senere end slut − sporet tid. Den tidlige grænse dækker tid lagt
 * til ("startede tidligere") og en sessionsstart, som en synk fra serveren
 * har sat til seneste genoptagelse.
 */
export function stoppedTimerStart(
  sessionStart: Date,
  end: Date,
  trackedSeconds: number,
): Date {
  const fromTracked = end.getTime() - Math.max(0, trackedSeconds) * 1000;
  return new Date(Math.min(sessionStart.getTime(), fromTracked));
}
