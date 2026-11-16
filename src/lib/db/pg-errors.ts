/**
 * Genkend Postgres-fejlkoder på tværs af postgres-js (fejlen har `code`
 * direkte) og Drizzle (som pakker den ind i `cause`).
 */
function pgErrorCode(err: unknown): string | null {
  let current: unknown = err;
  for (
    let depth = 0;
    depth < 5 && current && typeof current === "object";
    depth++
  ) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") return code;
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

/** 23505 — unique_violation (fx et unikt indeks fangede en race). */
export function isUniqueViolation(err: unknown): boolean {
  return pgErrorCode(err) === "23505";
}
