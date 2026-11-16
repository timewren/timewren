/**
 * Rene ISO-uge-hjælpere (mandag som ugestart) delt mellem leder-siderne.
 * Alle datoer er lokale — "YYYY-MM-DD" bygges uden UTC-skift.
 */

export function startOfISOWeek(ref: Date): Date {
  const d = new Date(ref);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  d.setDate(d.getDate() - (day === 0 ? 6 : day - 1));
  return d;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoWeekNumber(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  const week1 = new Date(date.getFullYear(), 0, 4);
  return (
    1 +
    Math.round(
      ((date.getTime() - week1.getTime()) / 86400000 -
        3 +
        ((week1.getDay() + 6) % 7)) /
        7,
    )
  );
}

/** ISO-ugeår (torsdagen i ugen afgør året — uge 1 kan starte i december). */
export function isoWeekYear(d: Date): number {
  const date = new Date(d);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + 3 - ((date.getDay() + 6) % 7));
  return date.getFullYear();
}

/** "YYYY-Www" — samme format som timeseddel-siden bruger i ?week=. */
export function toISOWeekString(d: Date): string {
  return `${isoWeekYear(d)}-W${String(isoWeekNumber(d)).padStart(2, "0")}`;
}

/** Mandag for "YYYY-Www"; null ved ugyldigt input. */
export function parseISOWeekString(value: string | null): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-W(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const year = Number(m[1]);
  const week = Number(m[2]);
  if (week < 1 || week > 53) return null;
  // 4. januar ligger altid i uge 1
  const monday = addDays(startOfISOWeek(new Date(year, 0, 4)), (week - 1) * 7);
  // Uge 53 findes ikke alle år — afvis hvis vi er landet i næste års uge 1
  if (isoWeekNumber(monday) !== week) return null;
  return monday;
}
