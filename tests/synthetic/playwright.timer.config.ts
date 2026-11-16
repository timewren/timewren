import { defineConfig, devices } from "@playwright/test";

// Config til den syntetiske timer-check mod prod (.github/workflows/synthetic-timer.yml).
// Ingen retries: et gentaget forsøg ville skjule netop de sporadiske sync-fejl,
// checket skal fange, og hvert forsøg koster to logins mod rate-limiten.
export default defineConfig({
  testDir: ".",
  testMatch: /timer-protocol\.synthetic\.ts/,
  retries: 0,
  workers: 1,
  timeout: 6 * 60 * 1000,
  expect: { timeout: 15 * 1000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    viewport: { width: 1440, height: 900 },
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
    // Tracing startes manuelt i testen, efter login (holder hemmeligheder ude)
    trace: "off",
    actionTimeout: 30 * 1000,
    navigationTimeout: 45 * 1000,
    screenshot: "only-on-failure",
  },
});
