/**
 * Fortolk et tidsstempel læst med RÅ SQL (`db.execute(sql…)` eller et
 * `sql<…>`-felt uden `.mapWith`) som UTC.
 *
 * Kolonnerne er `timestamp without time zone` og indeholder UTC. Drizzle
 * tilføjer selv "Z" når en kolonne læses via schemaet, men rå SQL giver den
 * nøgne streng ("2026-10-02 08:15:00.123"). `new Date()` læser en streng uden
 * zone som LOKAL tid — og siden prod-appen kører med TZ=Europe/Copenhagen
 * (1/10-2026) blev sådanne stempler 1–2 timer for tidlige. Det fik bl.a.
 * idle-fravær til at blive regnet 2 timer for langt.
 *
 * Date-objekter og strenge med zone/offset gives uændret videre.
 */
export function parseDbTimestamp(
  value: Date | string | null | undefined,
): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date) return value;
  const hasZone = /(?:[zZ]|[+-]\d{2}(?::?\d{2})?)$/.test(value.trim());
  if (hasZone) return new Date(value);
  return new Date(`${value.trim().replace(" ", "T")}Z`);
}

/** Date → "YYYY-MM-DD HH:MM:SS.mmm" (UTC, uden zone) til `::timestamp` i rå SQL. */
export function toUtcSql(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}
