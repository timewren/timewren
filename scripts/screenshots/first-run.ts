/**
 * First-run walkthrough: a brand-new user from sign-up to the first sent
 * invoice, screenshotted at 390 and 1440 px (docs/research/2026-11-22-foerste-oplevelse.md).
 *
 * One foreground supervisor: starts `next dev` on a free port against the
 * DATABASE_URL in the environment (a disposable local database, never prod),
 * walks the flow, then stops the server again.
 *
 *   DATABASE_URL=postgres://…@127.0.0.1:<port>/freelance_crm \
 *   npx tsx scripts/screenshots/first-run.ts --brand timetrack --locale da-DK --out /tmp/shots
 *
 * Outgoing mail uses MAIL_TRANSPORT=log, so nothing leaves the machine; the
 * e-mail address is confirmed directly in the database, like the E2E tests.
 */
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { type Browser, chromium, type Page } from "@playwright/test";
import postgres from "postgres";

const args = new Map<string, string>();
for (let i = 2; i < process.argv.length; i += 2) {
  args.set(process.argv[i].replace(/^--/, ""), process.argv[i + 1]);
}
const brand = args.get("brand") ?? "timetrack";
const locale = args.get("locale") ?? "da-DK";
const out = args.get("out") ?? "/tmp/first-run";
const only = args.get("steps"); // comma-separated step prefixes (optional)
const da = locale.startsWith("da");

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close(() =>
        typeof addr === "object" && addr ? resolve(addr.port) : reject(),
      );
    });
  });
}

async function waitFor(url: string, timeoutMs: number) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(url, { redirect: "manual" });
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`Server did not answer on ${url}`);
}

const notes: string[] = [];
let stepNo = 0;

async function shot(
  page: Page,
  name: string,
  fullPage = true,
  widths: readonly number[] = [1440, 390],
) {
  stepNo += 1;
  const id = `${String(stepNo).padStart(2, "0")}-${name}`;
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.waitForTimeout(600);
  for (const w of widths) {
    const h = w > 800 ? 900 : 844;
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(out, `${id}-${w}.png`), fullPage });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  const aria = await page
    .locator("body")
    .ariaSnapshot()
    .catch(() => "(no snapshot)");
  writeFileSync(join(out, `${id}.aria.txt`), `${page.url()}\n\n${aria}`);
  notes.push(`${id}  ${page.url()}`);
}

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !/@(127\.0\.0\.1|localhost)[:/]/.test(dbUrl))
    throw new Error("DATABASE_URL must point at a local database");
  mkdirSync(out, { recursive: true });
  const port = await freePort();
  const base = `http://localhost:${port}`;
  const server = spawn("npx", ["next", "dev", "--port", String(port)], {
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(port),
      NEXT_PUBLIC_APP_URL: base,
      BETTER_AUTH_URL: base,
      NEXT_PUBLIC_BRAND: brand,
      NEXT_PUBLIC_REGISTRATION_ENABLED: "true",
      REQUIRE_EMAIL_VERIFICATION: "true",
      STORE_BILLING_ENABLED: brand === "timetrack" ? "1" : "",
      MAIL_TRANSPORT: "log",
      ADMIN_EMAIL: "instance-admin@example.invalid",
      RESEND_API_KEY: "",
      STRIPE_SECRET_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  const log: string[] = [];
  server.stdout?.on("data", (d) => log.push(String(d)));
  server.stderr?.on("data", (d) => log.push(String(d)));
  const stop = () => {
    try {
      if (server.pid) process.kill(-server.pid, "SIGTERM");
    } catch {}
  };
  process.once("SIGINT", () => {
    stop();
    process.exit(130);
  });
  const sql = postgres(dbUrl, { max: 1 });
  // Startes inde i try: fejler starten, skal den løsrevne server stadig stoppes.
  let browser: Browser | undefined;
  try {
    browser = await chromium.launch();
    await waitFor(`${base}/login`, 240_000);
    // Compile the routes up front, in parallel: a cold `next dev` on a busy
    // machine can take longer per page than Playwright's navigation timeout.
    await Promise.all(
      [
        "/register",
        "/dashboard",
        "/dashboard/clients",
        "/dashboard/clients/new",
        "/dashboard/projects",
        "/dashboard/projects/new",
        "/dashboard/time",
        "/dashboard/time/new",
        "/dashboard/invoices",
        "/dashboard/invoices/new",
        "/dashboard/klippekort",
        "/dashboard/settings/company",
      ].map((p) => fetch(`${base}${p}`).catch(() => undefined)),
    );
    const context = await browser.newContext({
      baseURL: base,
      locale,
      timezoneId: "Europe/Copenhagen",
      viewport: { width: 1440, height: 900 },
    });
    await context.addCookies([
      {
        name: "tt_consent",
        value: encodeURIComponent(
          JSON.stringify({
            necessary: true,
            analytics: false,
            marketing: false,
            timestamp: Date.now(),
            version: "1.0",
          }),
        ),
        domain: "localhost",
        path: "/",
      },
    ]);
    const octet = () => Math.floor(Math.random() * 254) + 1;
    await context.setExtraHTTPHeaders({
      "x-forwarded-for": `10.${octet()}.${octet()}.${octet()}`,
    });
    await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) =>
      r.abort(),
    );
    // Same as tests/e2e/helpers.ts: SpeechRecognition crashes the renderer
    // in some Chromium builds; without the API the app hides dictation.
    await context.addInitScript(() => {
      for (const key of ["SpeechRecognition", "webkitSpeechRecognition"]) {
        Object.defineProperty(window, key, {
          value: undefined,
          configurable: true,
        });
      }
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(180_000);
    const consoleErrors: string[] = [];
    page.on("console", (m) => {
      if (m.type() === "error") consoleErrors.push(`${page.url()} ${m.text()}`);
    });

    const email = `first-run+${Date.now()}@example.invalid`;
    const password = ["first", "Run", "9x", String(Date.now())].join("-");
    const want = (s: string) =>
      !only || only.split(",").some((p) => s.startsWith(p));

    // 1. Sign-up
    await page.goto("/register");
    await shot(page, "register");
    await page.fill("#name", "Freja Testesen");
    await page.fill("#email", email);
    await page.fill("#password", password);
    const signUp = page.waitForResponse(
      (r) => r.url().includes("/api/auth/sign-up/email"),
      { timeout: 120_000 },
    );
    await page.locator("form button[type=submit]").first().click();
    const signUpRes = await signUp;
    if (signUpRes.status() !== 200)
      throw new Error(`sign-up failed: ${signUpRes.status()}`);
    await page.waitForTimeout(1500);
    await shot(page, "register-sent");

    // 2. Confirm e-mail (DB, mail is logged only) and log in
    await sql`UPDATE "user" SET "emailVerified" = true WHERE email = ${email}`;
    await page.goto("/login");
    await shot(page, "login");
    await page.fill("#email", email);
    await page.fill("#password", password);
    await page.locator("form button[type=submit]").first().click();
    // Login hops through client redirects; poll instead of waitForURL.
    for (let n = 0; n < 120 && !page.url().includes("/dashboard"); n++)
      await page.waitForTimeout(1000);
    if (!page.url().includes("/dashboard"))
      throw new Error(`login did not reach the dashboard: ${page.url()}`);
    await page.waitForTimeout(4000);
    await shot(page, "first-home", false);

    const visit = async (path: string, name: string) => {
      if (!want(name)) return;
      await page.goto(path);
      await page.waitForTimeout(1500);
      await shot(page, name);
    };
    await visit("/dashboard/clients", "clients-empty");
    await visit("/dashboard/clients/new", "client-new");
    await visit("/dashboard/projects", "projects-empty");
    await visit("/dashboard/projects/new", "project-new");
    await visit("/dashboard/time", "time-empty");
    await visit("/dashboard/time/new", "time-new");
    await visit("/dashboard/invoices", "invoices-empty");
    await visit("/dashboard/invoices/new", "invoice-new");
    await visit("/dashboard/klippekort", "klippekort-empty");

    // From here on the "What's new" dialog would only hide the flow.
    await page.addLocatorHandler(page.getByTestId("changelog-modal"), (m) =>
      m.getByTestId("changelog-close").dispatchEvent("click"),
    );
    const failures: string[] = [];
    const step = async (name: string, fn: () => Promise<void>) => {
      if (!want(name)) return;
      try {
        await fn();
      } catch (err) {
        failures.push(`${name}: ${(err as Error).message.split("\n")[0]}`);
        await shot(page, `${name}-FAILED`).catch(() => undefined);
      }
    };
    const L = da
      ? {
          name: "Navn *",
          email: "Email",
          rate: /Standard ?timepris/i,
          saveClient: "Gem kunde",
          pickClient: "Vælg kunde",
          projectName: "Projektnavn *",
          saveProject: "Gem projekt",
          desc: "Beskrivelse *",
          hours: "Timer *",
          saveEntry: "Gem post",
        }
      : {
          name: "Name *",
          email: "Email",
          rate: /Default hourly rate/i,
          saveClient: "Save client",
          pickClient: "Select client",
          projectName: "Project name *",
          saveProject: "Save project",
          desc: "Description *",
          hours: "Hours *",
          saveEntry: "Save entry",
        };
    const clientName = da ? "Bageriet Solsikken" : "Sunflower Bakery";
    await step("flow-client", async () => {
      await page.goto("/dashboard/clients/new");
      await page.getByLabel(L.name).fill(clientName);
      await page
        .getByLabel(L.email, { exact: true })
        .fill("ejer@example.invalid");
      await page.getByLabel(L.rate).fill("850");
      await page.getByRole("button", { name: L.saveClient }).click();
      await page.waitForURL((u) => !u.pathname.endsWith("/new"));
      await shot(page, "flow-client-created");
      // Fund 13: en ny kunde må kun tælles under "Aktive".
      await page.goto("/dashboard/clients");
      await page.waitForTimeout(1500);
      await shot(page, "flow-clients-list");
    });
    await step("flow-project", async () => {
      await page.goto("/dashboard/projects/new");
      await page
        .getByRole("combobox")
        .filter({ hasText: new RegExp(`^\\s*${L.pickClient}`) })
        .click();
      await shot(page, "flow-project-pick-client");
      await page.getByRole("option", { name: clientName }).first().click();
      await page
        .getByLabel(L.projectName)
        .fill(da ? "Ny hjemmeside" : "New website");
      await page.getByRole("button", { name: L.saveProject }).click();
      await page.waitForURL((u) => !u.pathname.endsWith("/new"));
      await shot(page, "flow-project-created");
    });
    await step("flow-klippekort", async () => {
      await page.goto("/dashboard/klippekort/new");
      await page.waitForTimeout(1500);
      await shot(page, "flow-klippekort-new");
    });
    await step("flow-manual", async () => {
      await page.goto("/dashboard/time/new");
      await page
        .getByRole("combobox")
        .filter({ hasText: new RegExp(`^\\s*${L.pickClient}\\s*$`) })
        .click();
      await page.getByRole("option", { name: clientName }).first().click();
      await page
        .getByLabel(L.desc)
        .fill(da ? "Workshop om forsiden" : "Homepage workshop");
      await page.getByLabel(L.hours).fill("2.5");
      await shot(page, "flow-manual-filled");
      await page.getByRole("button", { name: L.saveEntry }).click();
      await page.waitForURL((u) => !u.pathname.endsWith("/new"));
      await shot(page, "flow-manual-saved");
    });
    await step("flow-timer", async () => {
      await page.goto("/dashboard");
      await page.waitForTimeout(1500);
      await page
        .getByRole("button", { name: /Start timer/ })
        .first()
        .click();
      await page.waitForTimeout(2500);
      // Desktop only: resizing to 390 swaps the timer bar for the mobile one.
      await shot(page, "flow-timer-running", false, [1440]);
      await page
        .getByRole("button", {
          name: da ? "Gem tidspostering" : /Save time entry/,
        })
        .first()
        .click();
      await page.waitForTimeout(2000);
      await shot(page, "flow-timer-save-dialog", false, [1440]);
    });
    await step("flow-company", async () => {
      await page.goto("/dashboard/invoices/new");
      await page.waitForTimeout(1500);
      await page.getByRole("alert").getByRole("link").first().click();
      await page.waitForTimeout(2000);
      await shot(page, "flow-company-info");
      await page
        .getByLabel(da ? "Virksomhedsnavn *" : /Company name/)
        .fill(da ? "Freja Design" : "Freja Design");
      await page.waitForTimeout(3000);
      await shot(page, "flow-company-saved", false);
    });
    await step("flow-invoice", async () => {
      await page.goto("/dashboard/invoices");
      await page.waitForTimeout(2500);
      await shot(page, "flow-invoices-with-unbilled-time");
      await page
        .getByRole("button", {
          name: da ? "Fra tidsregistreringer" : /From time entries/,
        })
        .first()
        .click();
      await page.waitForTimeout(2000);
      await shot(page, "flow-invoice-from-time");
      await page
        .getByRole("button", { name: new RegExp(`^${clientName}`) })
        .click();
      await page.waitForTimeout(2500);
      await shot(page, "flow-invoice-generator-step2");
      await page
        .getByRole("button", {
          name: da ? /^Generér Faktura/i : /^Generate invoice/i,
        })
        .click();
      await page.waitForTimeout(3000);
      await shot(page, "flow-invoice-created");
      const open = page.getByRole("link", { name: /INV-|^#?\d+/ }).first();
      if (!page.url().match(/invoices\/[0-9a-f-]{8,}/) && (await open.count()))
        await open.click();
      await page.waitForTimeout(2500);
      await shot(page, "flow-invoice-detail");
      await page
        .getByRole("button", { name: da ? /^Send/ : /^Send/ })
        .first()
        .click();
      await page.waitForTimeout(2000);
      await shot(page, "flow-invoice-send");
    });
    writeFileSync(join(out, "failures.txt"), failures.join("\n") || "(none)");

    writeFileSync(
      join(out, "console-errors.txt"),
      consoleErrors.join("\n") || "(none)",
    );
    await context.close();
  } finally {
    writeFileSync(join(out, "steps.txt"), notes.join("\n"));
    writeFileSync(join(out, "server.log"), log.join(""));
    await browser?.close();
    await sql.end();
    stop();
  }
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err);
    process.exit(1);
  },
);
