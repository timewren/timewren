import { randomUUID } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { CONSENT_STATE } from "./tests/e2e/consent";

const BASE_URL = "http://localhost:3000";
process.env.TIMETRACK_E2E_RUN_ID ??= randomUUID();
const authDir = `tests/e2e/.auth/${process.env.TIMETRACK_E2E_RUN_ID}`;

export default defineConfig({
  metadata: { authDir },
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : 2,
  reporter: "html",
  // Dev-serveren kompilerer hver rute ved første besøg — giv plads til det.
  timeout: 120 * 1000,
  expect: { timeout: 20 * 1000 },
  use: {
    baseURL: BASE_URL,
    // Appen følger Accept-Language; testene forventer dansk tekst.
    locale: "da-DK",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Cookie-banneret må ikke opsnappe klik.
    storageState: CONSENT_STATE,
  },
  projects: [
    {
      name: "setup",
      teardown: "cleanup",
      testMatch: /auth\.setup\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    { name: "cleanup", testMatch: /auth\.teardown\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: `${authDir}/user.json`,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    // Kræver en kørende PostgreSQL (DATABASE_URL) med skemaet pushet — fx
    // `npm run docker:up && npm run db:push`. Kører dev-serveren allerede,
    // genbruges den.
    command: "npm run dev",
    // Testene forventer TimeTrack-teksterne (Cloud); .env.example står på timewren.
    // Cloud assertions need plan limits and verification, without provider keys.
    env: {
      // Reserve instance admin bootstrap for an address no fixture uses.
      ADMIN_EMAIL: "instance-admin@example.invalid",
      NEXT_PUBLIC_BRAND: "timetrack",
      NEXT_PUBLIC_REGISTRATION_ENABLED: "true",
      REQUIRE_EMAIL_VERIFICATION: "true",
      STORE_BILLING_ENABLED: "1",
    },
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180 * 1000,
  },
});
