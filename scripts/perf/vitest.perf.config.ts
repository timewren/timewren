import { resolve } from "node:path";
import * as dotenv from "dotenv";
import { defineConfig } from "vitest/config";

// Measurement only (scripts/perf/measure-trpc.perf.ts), never part of
// `npm test`. Reads DATABASE_URL from .env.local; prod runs in UTC.
dotenv.config({ path: ".env.local", quiet: true });
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/perf/**/*.perf.ts"],
    fileParallelism: false,
    testTimeout: 10 * 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
    },
  },
});
