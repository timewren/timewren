import { defineConfig, devices } from "@playwright/test";

// Selvstændig config til den syntetiske prod-check (ingen webServer, ingen auth).
export default defineConfig({
  testDir: ".",
  testMatch: /.*\.spec\.ts/,
  retries: 2,
  workers: 1,
  timeout: 60 * 1000,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
