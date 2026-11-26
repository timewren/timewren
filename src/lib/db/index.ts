import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { queryCountEnabled, queryCountLogger } from "./query-count";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL || "";
if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}
// CI's model-tests (`*.dbtest.ts`) bruger denne klient på delte runnere, hvor
// Postgres kan være længe om at åbne en backend; de sætter 60 s. Prod: 10 s.
const client = postgres(connectionString, {
  max: 20,
  idle_timeout: 30,
  connect_timeout: Number(process.env.DATABASE_CONNECT_TIMEOUT) || 10,
});

export const db = drizzle(client, {
  schema,
  ...(queryCountEnabled && { logger: queryCountLogger }),
});

/**
 * Runs `fn` on one connection reserved from the pool, in autocommit: each
 * write is committed when it returns, and session state (an advisory lock)
 * lives until `fn` is done. `fn` must use only the database it is given,
 * never `db`, so a caller never holds two pool connections at once.
 */
export async function withReservedConnection<T>(
  fn: (database: typeof db) => Promise<T>,
): Promise<T> {
  const reserved = await client.reserve();
  // drizzle sets its type parsers on `client.options`, which postgres.js
  // leaves off a reserved connection. Both share the pool's options.
  reserved.options ??= client.options;
  try {
    return await fn(
      drizzle(reserved, {
        schema,
        ...(queryCountEnabled && { logger: queryCountLogger }),
      }),
    );
  } finally {
    reserved.release();
  }
}
