import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

// Prod kører UTC; timestamp-kolonnerne er zoneløse (#769). Sættes før
// workerne startes, så de arver den.
process.env.TZ = "UTC";

/**
 * Database-tests (`*.dbtest.ts`) — holdt ude af `npm run test:unit`. Kræver
 * TT_DB_TESTS=1 og DATABASE_URL til en kasseret database med repoets schema.
 * Se docs/testing/timer-model-tests.md.
 */
export default defineConfig({
  test: {
    environment: "node",
    // Som vitest.config.ts: testene dækker TimeTrack Cloud, hvor planer og
    // grænser gælder (#962).
    env: { ALUNTA_API_KEY: "test-billing-enabled" },
    include: ["src/**/*.dbtest.ts"],
    fileParallelism: false,
    testTimeout: 15 * 60_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
