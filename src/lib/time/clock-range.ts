/**
 * Tidsrum indtastet som klokkeslæt ("HH:mm") på en dato ("yyyy-MM-dd").
 *
 * Klokkeslættene tolkes i lokaltid (browserens — dansk for brugerne), og
 * varigheden regnes på de reelle tidspunkter, ikke på vægur. Natten til
 * sidste søndag i oktober er 01:00–04:00 derfor 4 timer, og i marts 2 timer.
 * En sluttid før starttiden betyder næste dag.
 */

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseClock(value: string): [number, number] {
  const [h, m] = value.split(":").map(Number);
  return [h || 0, m || 0];
}

export function clockRangeToInstants(
  dateStr: string,
  startClock: string,
  endClock: string,
): { start: Date; end: Date } {
  const match = DATE_RE.exec(dateStr);
  const today = new Date();
  const [y, mo, d] = match
    ? [Number(match[1]), Number(match[2]) - 1, Number(match[3])]
    : [today.getFullYear(), today.getMonth(), today.getDate()];
  const [sh, sm] = parseClock(startClock);
  const [eh, em] = parseClock(endClock);

  const start = new Date(y, mo, d, sh, sm, 0, 0);
  let end = new Date(y, mo, d, eh, em, 0, 0);
  if (eh * 60 + em < sh * 60 + sm) {
    end = new Date(y, mo, d + 1, eh, em, 0, 0);
  }
  return { start, end };
}

/** Timer (2 decimaler) mellem to tidspunkter; aldrig negativ. */
export function hoursBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return ms > 0 ? Math.round((ms / 3_600_000) * 100) / 100 : 0;
}

export function clockRangeHours(
  dateStr: string,
  startClock: string,
  endClock: string,
): number {
  const { start, end } = clockRangeToInstants(dateStr, startClock, endClock);
  return hoursBetween(start, end);
}
