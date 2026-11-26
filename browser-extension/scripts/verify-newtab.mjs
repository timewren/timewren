// Browsertest af ny fane (#1322) med den byggede, udpakkede udvidelse.
//
//   npm run build && node scripts/verify-newtab.mjs [dist] [skærmbillede-mappe]
//
// Playwright launchPersistentContext med --load-extension og
// --disable-extensions-except, som playwright.dev/docs/chrome-extensions
// beskriver. Playwrights egen Chromium (Chrome for Testing) indlæser udvidelsen
// med flaget. Google Chrome Stable ignorerer flaget siden Chrome 137; sker det,
// logges det, og samme mappe indlæses over browserens CDP-session
// (Extensions.loadUnpacked). Se README, afsnittet "New tab".
//
// Alle http(s)-kald afvises, undtagen en falsk validateToken og en stub-side for
// søgningen, så testen aldrig rammer en rigtig server. Edge efterlignes ved at
// lade Chrome melde Edge-brandet.
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ext = resolve(process.argv[2] ?? join(root, "dist"));
const outDir = process.argv[3] ?? mkdtempSync(join(tmpdir(), "verify-newtab-"));
const messages = (file) =>
  JSON.parse(readFileSync(join(root, "src/i18n/messages/da", file), "utf8"));
const POPUP_HINT = messages("settings.json").newTab.enableHintChrome;
const NEWTAB_HINT = messages("newtab.json").settingsDialog.enableHintChrome;
const LOGIN_CONNECT = messages("popup.json").login.connect;

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(
    `${ok ? "OK  " : "FEJL"} ${name}${detail ? ` -- ${detail}` : ""}`,
  );
};
const isOverride = (p) =>
  p.url() === "chrome://newtab/" || p.url().endsWith("/newtab.html");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(100);
  }
  return null;
}

const EDGE = {
  userAgent:
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/158.0.0.0 Safari/537.36 Edg/158.0.0.0",
  acceptLanguage: "da",
  userAgentMetadata: {
    brands: [
      { brand: "Microsoft Edge", version: "158" },
      { brand: "Chromium", version: "158" },
    ],
    platform: "Linux",
    platformVersion: "",
    architecture: "x86",
    model: "",
    mobile: false,
  },
};

const launch = (args) =>
  chromium.launchPersistentContext(
    mkdtempSync(join(tmpdir(), "verify-newtab-profile-")),
    {
      headless: true,
      // Uden channel vælger Playwright chromium-headless-shell, når headless er
      // sat, og den kan ikke indlæse udvidelser. "chromium" er den fulde
      // medfølgende Chromium i ny headless-tilstand (Playwrights udvidelsesguide).
      channel: "chromium",
      // Playwright slår ellers Chromes sandbox fra (--no-sandbox)
      chromiumSandbox: true,
      locale: "da-DK",
      viewport: { width: 1280, height: 800 },
      // Playwright slår udvidelser fra som standard
      ignoreDefaultArgs: ["--disable-extensions"],
      args: [...args, "--enable-unsafe-extension-debugging", "--lang=da"],
    },
  );
const serviceWorker = (c) =>
  c.serviceWorkers()[0] ??
  c.waitForEvent("serviceworker", { timeout: 5000 }).catch(() => null);

let ctx = await launch([
  `--disable-extensions-except=${ext}`,
  `--load-extension=${ext}`,
]);
const version = ctx.browser()?.version();
console.log("Browser:", version);
const sw = await serviceWorker(ctx);
let id = sw ? new URL(sw.url()).host : null;
if (id) {
  check("Udvidelsen er indlæst med --load-extension", true, id);
} else {
  // --disable-extensions-except blokerer også en udvidelse indlæst over CDP,
  // så der startes forfra uden det flag.
  console.log(
    `INFO --load-extension blev ignoreret af ${version}; starter igen og indlæser samme mappe med Extensions.loadUnpacked`,
  );
  await ctx.close();
  ctx = await launch([`--load-extension=${ext}`]);
  const cdp = await ctx.browser().newBrowserCDPSession();
  ({ id } = await cdp.send("Extensions.loadUnpacked", { path: ext }));
  check("Udvidelsen er indlæst over CDP (tilbagefald)", !!id, id);
}
await ctx.route(/^https?:/, (route) => {
  const url = route.request().url();
  if (url.includes("extension.validateToken")) {
    return route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        result: {
          data: {
            json: {
              valid: true,
              user: {
                id: "u1",
                name: "Testbruger",
                email: "test@example.invalid",
                defaultHourlyRate: null,
              },
            },
          },
        },
      }),
    });
  }
  if (/^https:\/\/www\.google\.[a-z.]+\/search\?/.test(url)) {
    return route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><title>Stub-søgning</title><h1>Stub: søgning opfanget</h1><p>${url.replace(/[<>&]/g, "")}</p>`,
    });
  }
  return route.abort("internetdisconnected");
});

async function setStorage(values) {
  const p = await ctx.newPage();
  await p.goto(`chrome-extension://${id}/popup.html`);
  await p.evaluate(async (values) => {
    const r = await chrome.storage.local.get(["extensionSettings"]);
    const { settings, ...rest } = values;
    await chrome.storage.local.set({
      ...rest,
      extensionSettings: { ...(r.extensionSettings ?? {}), ...settings },
    });
  }, values);
  await p.close();
}
async function openNewTab({ edge = false } = {}) {
  const p = await ctx.newPage();
  if (edge) {
    const s = await ctx.newCDPSession(p);
    await s.send("Emulation.setUserAgentOverride", EDGE);
  }
  await p.goto("chrome://newtab/").catch(() => {});
  return p;
}
const searchField = (p) =>
  waitFor(() =>
    p.evaluate(() => {
      const i = document.querySelector('input[type="search"]');
      return i ? { focused: document.activeElement === i } : null;
    }),
  );
const alertText = (p) =>
  p.evaluate(
    () => document.querySelector('[role="alert"]')?.textContent?.trim() || "",
  );

// 1. Slået til: TimeTrack vises. Ikke logget ind, så loginformularen, som
// søgesiden ikke har.
await setStorage({ settings: { newTabEnabled: true } });
const on = await openNewTab();
const onState = await waitFor(() =>
  on.evaluate((label) => {
    const login = [...document.querySelectorAll("#root button")].some(
      (b) => b.textContent.trim() === label,
    );
    return login
      ? { login, search: !!document.querySelector('input[type="search"]') }
      : null;
  }, LOGIN_CONNECT),
);
check(
  "Slået til: TimeTrack (loginformular) vises på ny fane, ingen søgeside",
  isOverride(on) && !!onState?.login && !onState.search,
  `${on.url()} ${JSON.stringify(onState)}`,
);
await on.screenshot({ path: `${outDir}/01-til-chrome.png` });

// 2. Slået fra, Chrome: Chromes egen nye fane, ingen løkke
await setStorage({ settings: { newTabEnabled: false } });
const off = await openNewTab();
const reached = await waitFor(
  async () => off.url() === "chrome://new-tab-page/",
);
await sleep(800);
check(
  "Slået fra (Chrome): Chromes egen nye fane",
  !!reached && off.url() === "chrome://new-tab-page/",
  off.url(),
);
check(
  "Slået fra (Chrome): ingen løkke, én ny fane",
  ctx.pages().filter((p) => p.url().startsWith("chrome://new-tab-page"))
    .length === 1,
);
await off.screenshot({ path: `${outDir}/02-fra-chrome.png` });

// 3. Slået fra, Edge-brand: søgesiden; søgning i samme fane, også når en
// anden fane er forrest
const edge = await openNewTab({ edge: true });
const field = await searchField(edge);
check(
  "Slået fra (Edge-brand): søgeside med fokus i feltet",
  !!field?.focused && isOverride(edge),
  `${edge.url()} ${JSON.stringify(field)}`,
);
await edge.screenshot({ path: `${outDir}/03-fra-edge.png` });
await edge.keyboard.type("klippekort test");
await edge.keyboard.press("Enter");
const other = await ctx.newPage();
await other.goto("about:blank");
await other.bringToFront();
const searched = await waitFor(async () =>
  edge.url().includes("/search?") ? edge.url() : null,
);
check(
  "Slået fra (Edge-brand): søgningen åbner i fanen, der søgte",
  !!searched && /[?&]q=klippekort(\+|%20)test/.test(searched),
  searched ?? edge.url(),
);
check(
  "Slået fra (Edge-brand): den anden fane er urørt",
  other.url() === "about:blank",
  other.url(),
);
await edge.screenshot({ path: `${outDir}/04-edge-soegning-stub.png` });

// 4. Afvist søgning: fejlbesked under feltet
const fail = await openNewTab({ edge: true });
await searchField(fail);
await fail.evaluate(() => {
  chrome.search.query = () =>
    Promise.reject(new Error("Missing default search provider"));
});
await fail.keyboard.type("klippekort");
await fail.keyboard.press("Enter");
const failMsg = await waitFor(() => alertText(fail));
check(
  "Afvist søgning: besked under feltet",
  !!failMsg && isOverride(fail),
  failMsg,
);
await fail.screenshot({ path: `${outDir}/05-soegning-afvist.png` });

// 5. Fanens id kan ikke findes: ingen søgning (ingen CURRENT_TAB), men
// fejlbeskeden
const noId = await openNewTab({ edge: true });
await searchField(noId);
await noId.evaluate(() => {
  window.__queries = [];
  chrome.tabs.getCurrent = () => Promise.resolve(undefined);
  const orig = chrome.search.query.bind(chrome.search);
  chrome.search.query = (info) => {
    window.__queries.push(info);
    return orig(info);
  };
});
const bystander = await ctx.newPage();
await bystander.goto("about:blank");
await noId.bringToFront();
await noId.keyboard.type("klippekort");
await noId.keyboard.press("Enter");
const noIdMsg = await waitFor(() => alertText(noId));
await sleep(500);
const queries = await noId.evaluate(() => window.__queries.length);
check(
  "Uden fane-id: ingen søgning, besked under feltet",
  !!noIdMsg && queries === 0 && isOverride(noId),
  `${queries} kald, "${noIdMsg}"`,
);
check(
  "Uden fane-id: andre faner er urørte",
  bystander.url() === "about:blank",
  bystander.url(),
);

// 6. Sent afslag efter ny indtastning: beskeden kommer ikke igen. Søgningen
// holdes ventende, til testen selv afviser den.
const late = await openNewTab({ edge: true });
await searchField(late);
await late.evaluate(() => {
  window.__pending = [];
  chrome.search.query = (info) =>
    new Promise((_, reject) => window.__pending.push({ info, reject }));
});
await late.keyboard.type("klippekort");
await late.keyboard.press("Enter");
const lateCalled = await waitFor(() =>
  late.evaluate(() => window.__pending[0]?.info.text ?? null),
);
await late.keyboard.type(" mere");
const lateTyped = await late.evaluate(
  () => document.querySelector('input[type="search"]').value,
);
const rejected = await late.evaluate(() => {
  const p = window.__pending.shift();
  p?.reject(new Error("sent afslag"));
  return !!p;
});
// Lad afvisningen nå gennem promise-kæden og Reacts render
await sleep(500);
const lateMsg = await alertText(late);
check(
  "Sent afslag efter ny indtastning: ingen gammel fejlbesked",
  lateCalled === "klippekort" &&
    lateTyped === "klippekort mere" &&
    rejected &&
    lateMsg === "",
  `søgte "${lateCalled}", feltet "${lateTyped}", afvist ${rejected}, besked "${lateMsg}"`,
);

// 7. Hjælpeteksterne i Chrome: dialogen på ny fane (logget ind) og popuppen
await setStorage({
  settings: { newTabEnabled: true },
  extensionToken: "test-token",
});
const dlg = await openNewTab();
const settingsBtn = dlg.getByRole("button", { name: "Indstillinger" }).first();
await settingsBtn.waitFor({ timeout: 10000 }).catch(() => {});
await settingsBtn.click().catch(() => {});
const dlgHint = await waitFor(() =>
  dlg.evaluate(
    (h) =>
      document.querySelector('[role="dialog"]')?.textContent.includes(h) ??
      false,
    NEWTAB_HINT,
  ),
);
check("Ny fane (Chrome): hjælpeteksten for Chrome vises", !!dlgHint);
await dlg.screenshot({ path: `${outDir}/06-chrome-dialog.png` });

const pop = await ctx.newPage();
await pop.setViewportSize({ width: 400, height: 600 });
await pop.goto(`chrome-extension://${id}/popup.html`);
await pop
  .getByRole("button", { name: "Indstillinger" })
  .first()
  .click({ timeout: 10000 })
  .catch(() => {});
const popHint = await waitFor(() =>
  pop.evaluate((h) => {
    const el = [...document.querySelectorAll("p")].find(
      (p) => p.textContent === h,
    );
    if (!el) return false;
    el.scrollIntoView({ block: "center" });
    return true;
  }, POPUP_HINT),
);
check("Popup (Chrome): hjælpeteksten for Chrome vises", !!popHint);
await sleep(300);
await pop.screenshot({ path: `${outDir}/07-popup-chrome.png` });

await ctx.close();
const failed = results.filter((ok) => !ok).length;
console.log(
  `${results.length - failed}/${results.length} OK, skærmbilleder i ${outDir}`,
);
process.exit(failed ? 1 : 0);
