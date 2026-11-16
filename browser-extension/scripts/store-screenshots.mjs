#!/usr/bin/env node
/**
 * Skærmbilleder af popup, ny fane og indstillinger i lys og mørk, til
 * butikslisten og til PR-review. Kører den byggede extension (dist/) i
 * headless Chromium med en stub af chrome.* og faste, opdigtede API-svar,
 * så der aldrig logges ind på prod, og ingen rigtige kundedata kommer med.
 *
 * Brug (fra browser-extension/, efter `npm run build`):
 *   node scripts/store-screenshots.mjs [udmappe]
 *
 * Playwright hentes fra rodens node_modules (web-repoet har det i forvejen).
 * Scriptet er ikke en del af extensionens bundle.
 */
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const extRoot = resolve(here, "..");
const dist = join(extRoot, "dist");
const outDir = resolve(
  process.argv[2] ?? join(extRoot, "store-assets", "screenshots"),
);
const require = createRequire(join(extRoot, "..", "package.json"));
const { chromium } = require("playwright");

if (!existsSync(join(dist, "popup.html"))) {
  console.error("dist/ mangler. Kør `npm run build` først.");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

// ── Statisk server for dist/ (moduler må ikke køre fra file://) ──────────
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".json": "application/json",
};
const server = createServer((req, res) => {
  const path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  const file = join(dist, path === "/" ? "popup.html" : path);
  if (
    !file.startsWith(dist) ||
    !existsSync(file) ||
    statSync(file).isDirectory()
  ) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, {
    "Content-Type": types[extname(file)] ?? "application/octet-stream",
  });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

// ── Opdigtede data ───────────────────────────────────────────────────────
// Fast "nu", så uret og ugen er ens fra kørsel til kørsel.
const NOW = new Date("2026-10-12T10:30:00+02:00");
const iso = (d) => d.toISOString();
const minutesAgo = (m) => new Date(NOW.getTime() - m * 60_000);
const day = (offset) => {
  const d = new Date(NOW);
  d.setDate(d.getDate() + offset);
  return d.toISOString().slice(0, 10);
};

const clients = [
  {
    id: "c1",
    name: "Bageriet på hjørnet",
    company: null,
    email: null,
    hourlyRate: 650,
  },
  {
    id: "c2",
    name: "Cykelværkstedet",
    company: null,
    email: null,
    hourlyRate: 600,
  },
  {
    id: "c3",
    name: "Arkitektstuen Nord",
    company: null,
    email: null,
    hourlyRate: 750,
  },
];
const projects = [
  {
    id: "p1",
    name: "Ny webshop",
    clientId: "c1",
    clientName: clients[0].name,
    hourlyRate: null,
    status: "active",
  },
  {
    id: "p2",
    name: "Nyhedsbrev",
    clientId: "c1",
    clientName: clients[0].name,
    hourlyRate: null,
    status: "active",
  },
  {
    id: "p3",
    name: "Booking",
    clientId: "c2",
    clientName: clients[1].name,
    hourlyRate: null,
    status: "active",
  },
  {
    id: "p4",
    name: "Projektside",
    clientId: "c3",
    clientName: clients[2].name,
    hourlyRate: null,
    status: "active",
  },
];
const packages = [
  {
    id: "k1",
    clientId: "c1",
    clientName: clients[0].name,
    name: "Klippekort 20 t",
    totalHours: 20,
    usedHours: 13,
    remainingHours: 7,
    expiresAt: null,
    purchasedAt: "2026-08-01T08:00:00.000Z",
    isActive: true,
    autoDeduct: true,
    clipSizeMinutes: 15,
  },
  {
    id: "k2",
    clientId: "c3",
    clientName: clients[2].name,
    name: "Klippekort 50 t",
    totalHours: 50,
    usedHours: 32.5,
    remainingHours: 17.5,
    expiresAt: null,
    purchasedAt: "2026-06-15T08:00:00.000Z",
    isActive: true,
    autoDeduct: true,
    clipSizeMinutes: null,
  },
];
const entry = (
  id,
  dayOffset,
  startH,
  hours,
  clientIdx,
  projectId,
  description,
) => {
  const date = day(dayOffset);
  const sh = String(startH).padStart(2, "0");
  const endTotal = startH * 60 + Math.round(hours * 60);
  const eh = String(Math.floor(endTotal / 60)).padStart(2, "0");
  const em = String(endTotal % 60).padStart(2, "0");
  const project = projects.find((p) => p.id === projectId);
  return {
    id,
    description,
    hours,
    date,
    projectId,
    projectName: project?.name ?? null,
    clientId: clients[clientIdx].id,
    clientName: clients[clientIdx].name,
    createdAt: `${date}T${eh}:${em}:00.000Z`,
    startTime: `${sh}:00`,
    endTime: `${eh}:${em}`,
  };
};
const entries = [
  entry("e1", 0, 8, 1, 1, "p3", "Opsætning af booking"),
  entry("e2", -1, 9, 2.5, 0, "p1", "Produktsider"),
  entry("e3", -1, 13, 1.25, 2, "p4", "Møde om tegninger"),
  entry("e4", -2, 8, 3, 0, "p1", "Kurv og betaling"),
  entry("e5", -3, 10, 2, 2, "p4", "Billeder til projektsiden"),
  entry("e6", -4, 9, 4, 1, "p3", "Kalenderintegration"),
];

const timerState = (running) => ({
  isRunning: running,
  startTime: running ? iso(minutesAgo(84)) : null,
  elapsedSeconds: running ? 84 * 60 + 8 : 0,
  baseSeconds: 0,
  projectId: running ? "p1" : null,
  clientId: running ? "c1" : null,
  description: running ? "Produktfiltre" : "",
  lastSyncedAt: iso(NOW),
  lastSyncedFrom: "extension",
  project: running ? { id: "p1", name: "Ny webshop" } : null,
  client: running ? { id: "c1", name: clients[0].name } : null,
  prepaidChoice: null,
  sessionId: running ? "s1" : null,
  version: 3,
});

function trpcBody(procedure, running, input) {
  switch (procedure) {
    case "extension.validateToken":
      return {
        valid: true,
        user: {
          id: "u1",
          name: "Demo",
          email: "demo@example.com",
          defaultHourlyRate: 650,
        },
      };
    case "extension.listOrganizations":
      return [{ id: "o1", name: "Mit firma", role: "owner" }];
    case "extension.getTimerState":
    case "extension.getTimerStateWithVersion":
      return timerState(running);
    case "extension.getProjectsAndClients":
      return { projects, clients };
    case "extension.getPrepaidPackages":
      return packages;
    case "extension.getRecentEntries":
      return entries.slice(0, 5);
    case "extension.getTimeEntries": {
      const { startDate, endDate } = input ?? {};
      return entries.filter(
        (e) =>
          (!startDate || e.date >= startDate) &&
          (!endDate || e.date <= endDate),
      );
    }
    case "extension.getIdleSettings":
      return { enabled: false };
    default:
      return { success: true };
  }
}

// ── chrome.*-stub (kører før sidens egne scripts) ───────────────────────
const chromeStub = ({ theme, store }) => {
  const data = {
    ...store,
    extensionSettings: { ...(store.extensionSettings ?? {}), theme },
  };
  const listeners = [];
  const noopEvent = {
    addListener() {},
    removeListener() {},
    hasListener: () => false,
  };
  const pick = (keys) => {
    if (keys == null) return { ...data };
    const list =
      typeof keys === "string"
        ? [keys]
        : Array.isArray(keys)
          ? keys
          : Object.keys(keys);
    return Object.fromEntries(
      list.filter((k) => k in data).map((k) => [k, data[k]]),
    );
  };
  const area = {
    get: async (keys) => pick(keys),
    set: async (items) => {
      Object.assign(data, items);
      for (const l of listeners)
        l(
          Object.fromEntries(
            Object.entries(items).map(([k, v]) => [k, { newValue: v }]),
          ),
          "local",
        );
    },
    remove: async (keys) => {
      for (const k of [].concat(keys)) delete data[k];
    },
    clear: async () => {},
  };
  const deep = () =>
    new Proxy(() => {}, {
      get: (_t, prop) =>
        prop === "then"
          ? undefined
          : prop === "addListener" || prop === "removeListener"
            ? () => {}
            : deep(),
      apply: () => Promise.resolve(undefined),
    });
  const chromeObj = {
    runtime: {
      id: "screenshot",
      getManifest: () => ({ version: "2.6.0", manifest_version: 3 }),
      getURL: (p) => `/${p}`,
      sendMessage: async () => undefined,
      onMessage: noopEvent,
      lastError: undefined,
    },
    storage: {
      local: area,
      session: area,
      sync: area,
      onChanged: { addListener: (l) => listeners.push(l), removeListener() {} },
    },
    tabs: {
      query: async () => [
        { id: 1, url: "https://example.com/", title: "Eksempel" },
      ],
      sendMessage: async () => undefined,
      create: async () => undefined,
    },
  };
  window.chrome = new Proxy(chromeObj, {
    get: (t, p) => (p in t ? t[p] : deep()),
  });
};

const baseStore = {
  extensionToken: "demo-token",
  selectedOrgId: "o1",
  extensionSettings: { showSiteSuggestions: false },
};

async function shoot({
  page: pagePath,
  name,
  theme,
  colorScheme,
  viewport,
  running = true,
  before,
  store = baseStore,
}) {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    colorScheme,
    locale: "da-DK",
    timezoneId: "Europe/Copenhagen",
  });
  const page = await context.newPage();
  // Falsk ur, der starter ved NOW (uret og ugen er ens fra kørsel til kørsel)
  await page.clock.install({ time: NOW });
  await page.addInitScript(chromeStub, { theme, store });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin === base) return route.continue();
    if (url.pathname.startsWith("/api/trpc/")) {
      const procedure = url.pathname.slice("/api/trpc/".length);
      const raw = url.searchParams.get("input");
      const input = raw ? JSON.parse(raw).json : null;
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          result: { data: { json: trpcBody(procedure, running, input) } },
        }),
      });
    }
    return route.abort();
  });
  await page.goto(`${base}/${pagePath}`);
  await page.clock.runFor(1500);
  await page.waitForTimeout(400);
  if (before) await before(page);
  await page.clock.runFor(500);
  await page.waitForTimeout(300);
  const font = await page.evaluate(
    () => getComputedStyle(document.body).fontFamily,
  );
  const file = join(outDir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`${file}  (font: ${font.split(",")[0]})`);
  await context.close();
}

const browser = await chromium.launch();
const popup = { width: 400, height: 580 };
const openSettings = async (page) => {
  const btn = page
    .locator(
      'button[title="Indstillinger"], button[aria-label="Indstillinger"]',
    )
    .first();
  if (await btn.count()) await btn.click();
};
const clickText = (text) => async (page) => {
  const tab = page.getByRole("tab", { name: text });
  await ((await tab.count()) ? tab : page.getByRole("button", { name: text }))
    .first()
    .click();
};
try {
  for (const [label, theme, colorScheme] of [
    ["lys", "light", "light"],
    ["moerk", "dark", "dark"],
    ["moerk-system", "system", "dark"],
  ]) {
    await shoot({
      page: "popup.html",
      name: `popup-${label}`,
      theme,
      colorScheme,
      viewport: popup,
    });
    await shoot({
      page: "popup.html",
      name: `popup-stoppet-${label}`,
      theme,
      colorScheme,
      viewport: popup,
      running: false,
    });
    await shoot({
      page: "popup.html",
      name: `indstillinger-${label}`,
      theme,
      colorScheme,
      viewport: popup,
      before: openSettings,
    });
    await shoot({
      page: "newtab.html",
      name: `nyfane-1440-${label}`,
      theme,
      colorScheme,
      viewport: { width: 1440, height: 900 },
    });
    await shoot({
      page: "newtab.html",
      name: `nyfane-375-${label}`,
      theme,
      colorScheme,
      viewport: { width: 375, height: 812 },
    });
    await shoot({
      page: "popup.html",
      name: `login-${label}`,
      theme,
      colorScheme,
      viewport: popup,
      store: { extensionSettings: baseStore.extensionSettings },
    });
    await shoot({
      page: "newtab.html",
      name: `nyfane-klippekort-${label}`,
      theme,
      colorScheme,
      viewport: { width: 1440, height: 900 },
      before: clickText("Klippekort"),
    });
    await shoot({
      page: "newtab.html",
      name: `nyfane-dashboard-${label}`,
      theme,
      colorScheme,
      viewport: { width: 1440, height: 900 },
      before: clickText("Dashboard"),
    });
    if (label === "lys") {
      // Til butiksbilledet: mindre vindue, så kalenderen kan læses i 1280×800
      await shoot({
        page: "newtab.html",
        name: "nyfane-butik-lys",
        theme,
        colorScheme,
        viewport: { width: 1100, height: 720 },
        before: clickText("Dashboard"),
      });
    }
    await shoot({
      page: "popup.html",
      name: `popup-klippekort-${label}`,
      theme,
      colorScheme,
      viewport: popup,
      before: clickText("Klippekort"),
    });
    await shoot({
      page: "popup.html",
      name: `popup-hurtig-${label}`,
      theme,
      colorScheme,
      viewport: popup,
      running: false,
      before: clickText("Hurtig tidsregistrering"),
    });
  }
} finally {
  await browser.close();
  server.close();
}
