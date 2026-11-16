import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/** Kun til preview-scripts (mails og PDF); indgår ikke i `npm run test:unit`. */
export default defineConfig({
  test: {
    environment: "node",
    include: ["scripts/brand/*.preview.tsx"],
    testTimeout: 120_000,
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "../../src"),
    },
  },
});
