import {
  type Browser,
  type BrowserContext,
  expect,
  type Page,
  type TestInfo,
  test,
} from "@playwright/test";

// Syntetisk check af timer-protokollen mod PROD: to "enheder" (to separate
// browser-kontekster med hver sit login) på den dedikerede syntetiske konto.
// Køres hver time af .github/workflows/synthetic-timer.yml.
// Runbook: docs/runbooks/timer-fejlsoegning.md, afsnit "Syntetisk timer-check".
//
// Hemmeligheder holdes ude af tracen, der uploades ved fejl: login og alle
// REST-kald går gennem Nodes egen fetch (Playwright tracer alle sine
// request-kontekster), og tracing startes først, når session-cookien er sat.
// Sessionerne logges ud til sidst. Workflowet tjekker desuden artefaktet for
// adgangskode og API-nøgle, før det uploades.

const APP = process.env.SYNTH_BASE_URL ?? "https://app.timetrack.dk";
const CLIENT_NAME = "Syntetisk kunde";
const SEE_TIMEOUT = 60_000;

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} mangler`);
  return v;
}

const EMAIL = requireEnv("SYNTH_EMAIL");
const PASSWORD = requireEnv("SYNTH_PASSWORD");
const API_KEY = requireEnv("SYNTH_API_KEY");

type TimerState = {
  isRunning: boolean;
  elapsedSeconds: number;
  baseSeconds: number;
  clientId: string | null;
  sessionId: string | null;
  version: number;
};

type Entry = {
  id: string;
  clientId: string | null;
  hours: string;
  date: string;
  startTime: string | null;
  fromTimer?: boolean;
};

async function apiFetch(method: string, path: string): Promise<Response> {
  const res = await fetch(`${APP}/api/v1${path}`, {
    method,
    headers: { Authorization: `Bearer ${API_KEY}` },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok)
    throw new Error(`${method} /api/v1${path} -> HTTP ${res.status}`);
  return res;
}

async function apiJson<T>(method: string, path: string): Promise<T> {
  const res = await apiFetch(method, path);
  return ((await res.json()) as { data: T }).data;
}

const timerState = () => apiJson<TimerState>("GET", "/timer");

/** Posteringer på kunden — `total` tæller alle, også ud over første side. */
async function entriesFor(
  clientId: string,
): Promise<{ entries: Entry[]; total: number }> {
  const res = await apiFetch(
    "GET",
    `/time-entries?clientId=${clientId}&limit=100&sort=createdAt&order=desc`,
  );
  const body = (await res.json()) as {
    data: Entry[];
    pagination: { total: number };
  };
  return { entries: body.data, total: body.pagination.total };
}

async function cleanup(clientId: string) {
  const st = await timerState();
  if (st.isRunning || st.elapsedSeconds || st.baseSeconds) {
    await apiJson("DELETE", "/timer");
  }
  // Side for side, til kunden er tom (rester fra mange afbrudte kørsler)
  for (let round = 0; round < 20; round++) {
    const { entries } = await entriesFor(clientId);
    if (entries.length === 0) return;
    for (const e of entries) {
      await apiJson("DELETE", `/time-entries/${e.id}`);
    }
  }
  throw new Error("Oprydning: kunden har stadig posteringer efter 20 runder");
}

type Device = { name: string; context: BrowserContext; page: Page };

/** Logger ind via better-auths API (uden for tracen) og åbner en "enhed". */
async function openDevice(browser: Browser, name: string): Promise<Device> {
  const res = await fetch(`${APP}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: APP },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Login fejlede: HTTP ${res.status}`);
  const host = new URL(APP).hostname;
  const cookies = res.headers.getSetCookie().map((raw) => {
    const [pair] = raw.split(";");
    const i = pair.indexOf("=");
    return {
      name: pair.slice(0, i).trim(),
      value: pair.slice(i + 1).trim(),
      domain: host,
      path: "/",
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: "Lax" as const,
    };
  });
  if (!cookies.some((c) => c.name.includes("session_token"))) {
    throw new Error("Login gav ingen session-cookie");
  }

  const consent = encodeURIComponent(
    JSON.stringify({
      necessary: true,
      analytics: false,
      marketing: false,
      timestamp: Date.now(),
      version: "1.0",
    }),
  );
  // Tracing er slået fra i configen og startes først efter addCookies
  const context = await browser.newContext();
  try {
    await context.addCookies([
      ...cookies,
      {
        name: "tt_consent",
        value: consent,
        domain: new URL(APP).hostname,
        path: "/",
        expires: -1,
        httpOnly: false,
        secure: true,
        sameSite: "Lax",
      },
    ]);
    // Ingen tredjeparts-scripts (analytics, ads) fra den syntetiske bruger
    await context.route(
      /^https:\/\/(?!app\.timetrack\.dk\/|timetrack\.dk\/)/,
      (r) => r.abort(),
    );
    await context.tracing.start({ screenshots: true, snapshots: true });
    const page = await context.newPage();
    // "Nyheder og opdateringer" åbner af sig selv, hver gang en ny Nyhed er
    // udgivet — luk den, uanset hvornår den dukker op.
    await page.addLocatorHandler(
      page.getByTestId("changelog-modal"),
      async (modal) => {
        await modal.getByTestId("changelog-close").click();
      },
    );
    return { name, context, page };
  } catch (e) {
    // Halvt åbnet enhed: log sessionen ud og luk, før fejlen sendes videre
    await context.request
      .post(`${APP}/api/auth/sign-out`, { headers: { Origin: APP }, data: {} })
      .catch(() => {});
    await context.close();
    throw e;
  }
}

const bar = (page: Page) => page.getByTestId("timer-bar");

async function signOut(page: Page) {
  try {
    const res = await page.request.post(`${APP}/api/auth/sign-out`, {
      headers: { Origin: APP },
      data: {},
    });
    if (!res.ok()) {
      console.warn(`::warning::Log ud fejlede: HTTP ${res.status()}`);
    }
  } catch {
    // Sessionen udløber af sig selv; oprydning må ikke skjule testens fejl
  }
}

async function closeDevice(d: Device, testInfo: TestInfo, failed: boolean) {
  const path = testInfo.outputPath(`trace-${d.name}.zip`);
  const warn = (what: string) => (e: unknown) =>
    console.warn(`::warning::${what} for enhed ${d.name} fejlede: ${e}`);
  await d.context.tracing
    .stop(failed ? { path } : undefined)
    .catch(warn("Trace"));
  if (failed) {
    await testInfo
      .attach(`trace-${d.name}`, { path, contentType: "application/zip" })
      .catch(warn("Vedhæftning af trace"));
  }
  await signOut(d.page);
  await d.context.close();
}

test("timer startet på enhed A ses, stoppes og gemmes én gang fra enhed B", async ({
  browser,
}, testInfo) => {
  const clients = await apiJson<{ id: string; name: string }[]>(
    "GET",
    "/clients?limit=100",
  );
  const clientId = clients.find((c) => c.name === CLIENT_NAME)?.id;
  if (!clientId)
    throw new Error(`Kunden "${CLIENT_NAME}" findes ikke på kontoen`);

  // Rester fra en tidligere, afbrudt kørsel
  await cleanup(clientId);

  const opened: Device[] = [];
  let passed = false;
  try {
    const A = await openDevice(browser, "A");
    opened.push(A);
    const B = await openDevice(browser, "B");
    opened.push(B);

    await test.step("begge enheder viser en stoppet timer", async () => {
      await A.page.goto(`${APP}/dashboard/time`);
      await B.page.goto(`${APP}/dashboard/time`);
      await expect(bar(A.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: 30_000,
      });
      await expect(bar(B.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: 30_000,
      });
    });

    await test.step("A starter timeren på Syntetisk kunde", async () => {
      await bar(A.page).getByTestId("timer-client-picker").click();
      await A.page
        .getByTestId("timer-pick-client")
        .filter({ hasText: CLIENT_NAME })
        .click();
      // Valg af kunde starter timeren af sig selv; tryk Start kun hvis ikke
      await expect(bar(A.page))
        .toHaveAttribute("data-timer-state", "running", { timeout: 5_000 })
        .catch(() => bar(A.page).getByTestId("timer-start").click());
      await expect(bar(A.page)).toHaveAttribute("data-timer-state", "running");
      await expect
        .poll(async () => (await timerState()).isRunning, {
          message: "serveren registrerer starten",
          timeout: SEE_TIMEOUT,
        })
        .toBe(true);
      expect((await timerState()).clientId).toBe(clientId);
    });

    await test.step("B ser den kørende timer inden for 60 s", async () => {
      await expect(bar(B.page)).toHaveAttribute("data-timer-state", "running", {
        timeout: SEE_TIMEOUT,
      });
      await expect(bar(B.page)).toContainText(CLIENT_NAME);
    });

    await test.step("B stopper og gemmer", async () => {
      // Lidt tid på uret, så posten ikke er en 0-postering
      await B.page.waitForTimeout(5_000);
      await bar(B.page).getByTestId("timer-save").click();
      await B.page.getByTestId("save-entry-done").click();
      await expect(B.page.getByTestId("save-entry-done")).toBeHidden({
        timeout: 30_000,
      });
      await expect(bar(B.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: 30_000,
      });
    });

    await test.step("A viser timeren stoppet", async () => {
      await expect(bar(A.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: SEE_TIMEOUT,
      });
    });

    await test.step("A genopliver ikke timeren efter reload", async () => {
      await A.page.reload();
      await expect(bar(A.page)).toBeVisible({ timeout: 30_000 });
      // To poll-cyklusser (10-15 s) skal gå uden at timeren kommer tilbage
      const until = Date.now() + 35_000;
      while (Date.now() < until) {
        await expect(bar(A.page)).toHaveAttribute("data-timer-state", "idle", {
          timeout: 1_000,
        });
        await A.page.waitForTimeout(2_500);
      }
      const st = await timerState();
      expect(st.isRunning, "serveren: timer kører ikke").toBe(false);
    });

    const original =
      await test.step("præcis én postering for sessionen", async () => {
        const { entries, total } = await entriesFor(clientId);
        expect(total, "antal posteringer på Syntetisk kunde").toBe(1);
        return entries[0];
      });

    await test.step("Fortsæt bevarer den oprindelige start", async () => {
      await A.page.goto(`${APP}/dashboard/time`);
      await A.page.getByTestId("entry-continue").first().click();
      await expect(bar(A.page)).toHaveAttribute("data-timer-state", "running");
      await A.page.waitForTimeout(5_000);
      await bar(A.page).getByTestId("timer-save").click();
      await A.page.getByTestId("save-entry-done").click();
      await expect(bar(A.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: 30_000,
      });
      await expect
        .poll(async () => (await entriesFor(clientId)).total, {
          message: "stadig præcis én postering efter Fortsæt",
          timeout: 15_000,
        })
        .toBe(1);
      const [continued] = (await entriesFor(clientId)).entries;
      expect(continued.id, "samme postering blev forlænget").toBe(original.id);
      expect(continued.date).toBe(original.date);
      expect(continued.startTime).toBe(original.startTime);
      expect(Number(continued.hours)).toBeGreaterThanOrEqual(
        Number(original.hours),
      );
      // B må ikke se en kørende timer bagefter
      await expect(bar(B.page)).toHaveAttribute("data-timer-state", "idle", {
        timeout: SEE_TIMEOUT,
      });
    });
    passed = true;
  } finally {
    for (const d of opened) await closeDevice(d, testInfo, !passed);
    await cleanup(clientId).catch(() => {});
  }
});
