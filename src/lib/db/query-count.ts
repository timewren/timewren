import { AsyncLocalStorage } from "node:async_hooks";
import type { Logger } from "drizzle-orm/logger";

/**
 * Antal SQL-kald pr. request — et måleværktøj til udvikling.
 *
 * Slås til med `TT_QUERY_COUNT=1` (aldrig i produktion). /api/trpc kører
 * hver request i `withQueryCount`, og Drizzle-loggeren tæller hvert kald
 * med, så konsollen viser fx `[queries] 7  user.getProfile,time.list`.
 * Kald uden for en tælle-scope (cron, scripts) tælles ikke.
 */
export const queryCountEnabled =
  process.env.NODE_ENV !== "production" && process.env.TT_QUERY_COUNT === "1";

type Counter = { queries: number; tables: Map<string, number> };

const storage = new AsyncLocalStorage<Counter>();

function firstTable(query: string): string {
  const match = /\b(?:from|update|into)\s+"([^"]+)"/i.exec(query);
  return match?.[1] ?? "?";
}

export const queryCountLogger: Logger = {
  logQuery(query) {
    const counter = storage.getStore();
    if (!counter) return;
    counter.queries += 1;
    const table = firstTable(query);
    counter.tables.set(table, (counter.tables.get(table) ?? 0) + 1);
  },
};

export async function withQueryCount<T>(
  label: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (!queryCountEnabled) return fn();
  const counter: Counter = { queries: 0, tables: new Map() };
  try {
    return await storage.run(counter, fn);
  } finally {
    const tables = [...counter.tables.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}=${n}`)
      .join(" ");
    console.log(`[queries] ${counter.queries}  ${label}  (${tables})`);
  }
}
