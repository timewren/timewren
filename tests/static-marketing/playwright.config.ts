import { defineConfig } from "@playwright/test";
import { CONSENT_STATE } from "../e2e/consent";

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

export default defineConfig({
  testDir: ".",
  workers: 1,
  reporter: "list",
  use: { baseURL, storageState: CONSENT_STATE },
  webServer: {
    command: `node node_modules/next/dist/bin/next start -p ${new URL(baseURL).port || "3000"}`,
    cwd: process.cwd(),
    url: `${baseURL}/login`,
    timeout: 60000,
    env: {
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_APP_URL: baseURL,
      DATABASE_URL: "postgres://test:test@127.0.0.1:1/test",
      BETTER_AUTH_SECRET: "local-build-only-not-a-production-secret",
    },
  },
});
