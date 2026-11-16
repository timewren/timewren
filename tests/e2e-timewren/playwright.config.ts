import { defineConfig, devices } from "@playwright/test";

/**
 * TimeWren Cloud ende til ende på https://timewren.com mod en lokal build.
 * Køres af scripts/e2e/timewren-cloud.sh, som starter appen,
 * HTTPS-proxy og Resend-mock og sætter TW_PROXY_PORT og E2E_MAIL_DIR.
 * Se tests/e2e-timewren/README.md.
 */
const proxyPort = process.env.TW_PROXY_PORT ?? "4443";

export default defineConfig({
  testDir: ".",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120 * 1000,
  expect: { timeout: 20 * 1000 },
  use: {
    ...devices["Desktop Chrome"],
    baseURL: "https://timewren.com",
    locale: "en-US",
    // Selvsigneret certifikat fra runner-scriptet.
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      // timewren.com og www. går til den lokale HTTPS-proxy; intet andet
      // slås op lokalt (eksterne requests afbrydes i testen).
      args: [
        `--host-resolver-rules=MAP timewren.com 127.0.0.1:${proxyPort}, MAP www.timewren.com 127.0.0.1:${proxyPort}`,
      ],
    },
  },
});
