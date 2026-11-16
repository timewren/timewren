// Starter dev-serveren med MULTIBRAND_ENABLED=1, mapper to hostnavne til den
// (Chromium --host-resolver-rules, svarer til /etc/hosts), tester brand og
// sprog og gemmer skærmbilleder ved 390 og 1440 px. Intet forlader maskinen.
//   node scripts/brand/multibrand-screenshots.mjs [udmappe]
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { chromium } from "@playwright/test";

const PORT = 3100;
const OUT = process.argv[2] ?? "docs/specs/screenshots";
mkdirSync(OUT, { recursive: true });

const server = spawn("npx", ["next", "dev", "-p", String(PORT)], {
  env: {
    ...process.env,
    PORT: String(PORT),
    MULTIBRAND_ENABLED: "1",
    NEXT_PUBLIC_BRAND: "timetrack",
    DATABASE_URL: process.env.DATABASE_URL ?? "postgres://x:x@127.0.0.1:1/none",
    BETTER_AUTH_SECRET: "x".repeat(40),
    NEXT_PUBLIC_APP_URL: `http://timetrack.dk:${PORT}`,
    NEXT_PUBLIC_MARKETING_URL: "",
  },
  stdio: ["ignore", "pipe", "pipe"],
  detached: true,
});
// Dræb hele procesgruppen (npx starter next-server som barn).
const stopServer = () => {
  try {
    process.kill(-server.pid, "SIGTERM");
  } catch {}
};
let log = "";
server.stdout.on("data", (d) => {
  log += d;
});
server.stderr.on("data", (d) => {
  log += d;
});

const fail = async (msg) => {
  console.error(msg, "\n--- serverlog ---\n", log.slice(-3000));
  stopServer();
  process.exit(1);
};

try {
  for (let i = 0; i < 90; i++) {
    if (/Ready in/.test(log)) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  const browser = await chromium.launch({
    args: [
      `--host-resolver-rules=MAP timetrack.dk 127.0.0.1:${PORT}, MAP timewren.com 127.0.0.1:${PORT}`,
    ],
  });
  const cases = [
    {
      name: "timetrack-forside",
      url: "http://timetrack.dk/",
      brand: "TimeTrack",
      lang: "da",
    },
    {
      name: "timetrack-login",
      url: "http://timetrack.dk/login",
      brand: "TimeTrack",
      lang: "da",
    },
    {
      name: "timewren-login-en",
      url: "http://timewren.com/login",
      brand: "TimeWren",
      lang: "en",
    },
    {
      name: "timewren-login-de",
      url: "http://timewren.com/de/login",
      brand: "TimeWren",
      lang: "de",
    },
  ];
  const results = [];
  for (const c of cases) {
    for (const [w, h] of [
      [390, 844],
      [1440, 900],
    ]) {
      const ctx = await browser.newContext({
        viewport: { width: w, height: h },
        locale: c.brand === "TimeTrack" ? "da-DK" : "en-GB",
        // Cookiebanner ud af billedet
        storageState: {
          cookies: [
            {
              name: "tt_consent",
              value: encodeURIComponent(
                JSON.stringify({
                  necessary: true,
                  analytics: false,
                  marketing: false,
                  timestamp: 1,
                  version: "1.0",
                }),
              ),
              domain: new URL(c.url).hostname,
              path: "/",
              expires: -1,
              httpOnly: false,
              secure: false,
              sameSite: "Lax",
            },
          ],
          origins: [],
        },
      });
      const page = await ctx.newPage();
      const res = await page.goto(c.url, {
        waitUntil: "load",
        timeout: 120000,
      });
      await page.waitForTimeout(1500);
      const info = await page.evaluate(() => ({
        lang: document.documentElement.lang,
        title: document.title,
        appName: document.querySelector('meta[name="application-name"]')
          ?.content,
        primary: getComputedStyle(document.documentElement)
          .getPropertyValue("--tt-gran")
          .trim(),
        icon: document
          .querySelector('link[rel="apple-touch-icon"]')
          ?.getAttribute("href"),
        // biome-ignore lint/performance/useDomNodeTextContent: innerText følger layout og skjuler det usynlige; textContent ville tage skjult tekst med
        body: document.body.innerText.slice(0, 4000),
      }));
      await page.screenshot({
        path: `${OUT}/${c.name}-${w}.png`,
        fullPage: false,
      });
      results.push({ c, w, status: res?.status(), final: page.url(), ...info });
      await ctx.close();
    }
  }
  await browser.close();
  for (const r of results) {
    console.log(
      JSON.stringify({
        case: r.c.name,
        w: r.w,
        status: r.status,
        final: r.final,
        lang: r.lang,
        title: r.title,
        appName: r.appName,
        primary: r.primary,
        icon: r.icon,
      }),
    );
  }
  const bad = [];
  for (const r of results) {
    const other = r.c.brand === "TimeTrack" ? "TimeWren" : "TimeTrack";
    if (r.status !== 200) bad.push(`${r.c.name}: status ${r.status}`);
    if (r.appName !== r.c.brand)
      bad.push(`${r.c.name}: application-name ${r.appName}`);
    if (r.lang !== r.c.lang) bad.push(`${r.c.name}: lang ${r.lang}`);
    if (r.body.includes(other)) bad.push(`${r.c.name}: indeholder ${other}`);
  }
  stopServer();
  if (bad.length) {
    console.error(`FEJL:\n${bad.join("\n")}`);
    process.exit(1);
  }
  console.log("OK: begge brands korrekte");
  process.exit(0);
} catch (e) {
  await fail(String(e));
}
