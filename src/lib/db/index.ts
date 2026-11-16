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
