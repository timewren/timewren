#!/usr/bin/env node

/**
 * Capture marketing screenshots:
 *   1. Dashboard pages (logged in) — for use on landing pages
 *   2. Browser extension (popup + new tab) — with real seed data
 *
 * Prerequisites:
 *   - Dev server running: npm run dev
 *   - Database seeded: npm run db:seed
 *   - Extension built: cd browser-extension && npm run build
 *   - Extension token in DB (the seed script or manual insert)
 *
 * Usage:
 *   node scripts/capture-marketing-screenshots.mjs
 */

import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const EXTENSION_DIR = join(ROOT, "browser-extension", "dist");

const DASHBOARD_DIR = join(ROOT, "public", "screenshots", "dashboard");
const EXTENSION_SCREENSHOT_DIR = join(
  ROOT,
  "public",
  "screenshots",
  "extension",
);

for (const dir of [DASHBOARD_DIR, EXTENSION_SCREENSHOT_DIR]) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// Seed user credentials
const EMAIL = process.env.SCREENSHOT_EMAIL || "freelancer@test.dk";
const PASSWORD = process.env.SCREENSHOT_PASSWORD || "test123";

// Extension token (its SHA-256 must exist in extension_tokens.token_hash for the same user)
const EXTENSION_TOKEN =
  process.env.EXTENSION_TOKEN ||
  "screenshotTokenForPlaywrightTestingOnlyDoNotUseInProductionXX01";

const CLEAN_LOCAL_STORAGE = [
  {
    name: "timetrack_cookie_consent",
    value: JSON.stringify({
      necessary: true,
      analytics: false,
      timestamp: Date.now(),
      version: "1.0",
    }),
  },
  { name: "theme", value: "light" },
  {
    name: "tour-storage",
    value: JSON.stringify({ state: { hasCompletedTour: true }, version: 0 }),
  },
  { name: "pwa-install-dismissed", value: JSON.stringify(Date.now()) },
];

// ─── Helpers ────────────────────────────────────────────────────────────────

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");
  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard**", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
}

async function dismissOverlays(page) {
  const toasts = page.locator("[data-sonner-toast] button[data-close-button]");
  const toastCount = await toasts.count();
  for (let i = 0; i < toastCount; i++) {
    await toasts
      .nth(i)
      .click()
      .catch(() => {});
  }
  const skipBtn = page.locator('text="Spring over"');
  if (await skipBtn.isVisible({ timeout: 500 }).catch(() => false)) {
    await skipBtn.click();
  }
  await page.waitForTimeout(1000);
}

function createContext(browser, viewport, mobile = false) {
  return browser.newContext({
    viewport,
    deviceScaleFactor: mobile ? 2 : 1,
    isMobile: mobile,
    hasTouch: mobile,
    colorScheme: "light",
    locale: "da-DK",
    storageState: {
      cookies: [],
      origins: [{ origin: BASE_URL, localStorage: CLEAN_LOCAL_STORAGE }],
    },
  });
}

// ─── Dashboard Screenshots (for landing pages) ─────────────────────────────

const DASHBOARD_PAGES = [
  {
    url: "/dashboard",
    filename: "overview",
    label: "Dashboard oversigt",
  },
  {
    url: "/dashboard/time",
    filename: "time-tracking",
    label: "Tidsregistrering",
    action: async (page) => {
      // Select "Denne måned" to show data
      const btn = page.locator('button:has-text("Denne måned")');
      if (await btn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await btn.click();
        await page.waitForLoadState("networkidle");
        await page.waitForTimeout(2000);
      }
    },
  },
  {
    url: "/dashboard/clients",
    filename: "clients",
    label: "Klienter",
  },
  {
    url: "/dashboard/projects",
    filename: "projects",
    label: "Projekter",
  },
  // Klippekort skipped — seed data doesn't include prepaid packages
  {
    url: "/dashboard/invoices",
    filename: "invoices",
    label: "Fakturaer",
  },
  {
    url: "/dashboard/reports",
    filename: "reports",
    label: "Rapporter",
  },
  {
    url: "/dashboard/tasks",
    filename: "tasks",
    label: "Opgaver",
  },
];

async function captureDashboardPages(browser) {
  console.log("── Dashboard Screenshots (til landing pages) ──\n");

  // Desktop
  const desktopCtx = await createContext(browser, {
    width: 1920,
    height: 1080,
  });
  const desktopPage = await desktopCtx.newPage();

  await login(desktopPage);
  await dismissOverlays(desktopPage);

  for (const pg of DASHBOARD_PAGES) {
    await desktopPage.goto(`${BASE_URL}${pg.url}`, {
      waitUntil: "networkidle",
    });
    await desktopPage.waitForTimeout(2000);
    await dismissOverlays(desktopPage);

    if (pg.action) await pg.action(desktopPage);

    await desktopPage.screenshot({
      path: join(DASHBOARD_DIR, `desktop-${pg.filename}.png`),
      fullPage: false,
    });
    console.log(`  ✓ desktop-${pg.filename}.png (${pg.label})`);
  }
  await desktopCtx.close();

  // Mobile
  const mobileCtx = await createContext(
    browser,
    { width: 375, height: 667 },
    true,
  );
  const mobilePage = await mobileCtx.newPage();

  await login(mobilePage);
  await dismissOverlays(mobilePage);

  for (const pg of DASHBOARD_PAGES) {
    await mobilePage.goto(`${BASE_URL}${pg.url}`, { waitUntil: "networkidle" });
    await mobilePage.waitForTimeout(2000);
    await dismissOverlays(mobilePage);

    if (pg.action) await pg.action(mobilePage);

    await mobilePage.screenshot({
      path: join(DASHBOARD_DIR, `mobile-${pg.filename}.png`),
      fullPage: false,
    });
    console.log(`  ✓ mobile-${pg.filename}.png (${pg.label})`);
  }
  await mobileCtx.close();
}

// ─── Browser Extension Screenshots ──────────────────────────────────────────

async function captureExtension() {
  console.log("\n── Browser Extension ──\n");

  if (!existsSync(EXTENSION_DIR)) {
    console.log(
      "  ⚠ Extension not built. Run: cd browser-extension && npm run build",
    );
    return;
  }

  const userDataDir = join(ROOT, ".playwright-extension-profile");

  // Clean up stale profile from previous run
  try {
    rmSync(userDataDir, { recursive: true, force: true });
  } catch (_) {}

  const context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${EXTENSION_DIR}`,
      `--load-extension=${EXTENSION_DIR}`,
      "--no-first-run",
      "--disable-popup-blocking",
    ],
    viewport: { width: 1280, height: 800 },
    colorScheme: "light",
    locale: "da-DK",
  });

  try {
    // Find extension ID
    let extensionId = null;
    for (let i = 0; i < 15 && !extensionId; i++) {
      for (const w of context.serviceWorkers()) {
        const url = w.url();
        if (url.includes("chrome-extension://")) {
          extensionId = url.split("//")[1].split("/")[0];
          break;
        }
      }
      if (!extensionId) {
        for (const p of context.backgroundPages()) {
          const url = p.url();
          if (url.includes("chrome-extension://")) {
            extensionId = url.split("//")[1].split("/")[0];
            break;
          }
        }
      }
      if (!extensionId) await new Promise((r) => setTimeout(r, 1000));
    }

    if (!extensionId) {
      console.log("  ✗ Could not find extension ID. Skipping.");
      return;
    }

    console.log(`  Extension ID: ${extensionId}`);

    // ── Pre-inject settings and token into chrome.storage.local ──
    // Open a blank extension page so we can access chrome.storage.local
    const setupPage = await context.newPage();
    await setupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await setupPage.waitForTimeout(2000);

    // Inject API URL (point to local dev server) and auth token
    await setupPage.evaluate(
      ({ apiUrl, token }) => {
        return new Promise((resolve) => {
          chrome.storage.local.set(
            {
              extensionSettings: {
                apiUrl: apiUrl,
                autoSyncInterval: 5,
                showSiteSuggestions: true,
                showPrepaidStatus: true,
                compactMode: false,
                newTabEnabled: true,
                newTabWidgets: [
                  "clock",
                  "todayStats",
                  "timer",
                  "recentEntries",
                  "weeklyChart",
                ],
              },
              extensionToken: token,
            },
            () => resolve(true),
          );
        });
      },
      { apiUrl: BASE_URL, token: EXTENSION_TOKEN },
    );
    console.log(`  Injected settings: apiUrl=${BASE_URL}, token set`);
    await setupPage.close();

    // ── Popup: Login state (without token) ──
    // Take a clean login screenshot first by temporarily clearing the token
    const loginPage = await context.newPage();
    await loginPage.setViewportSize({ width: 400, height: 600 });
    await loginPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await loginPage.waitForTimeout(1000);
    await loginPage.evaluate(() => {
      return new Promise((resolve) => {
        chrome.storage.local.remove(["extensionToken"], () => resolve(true));
      });
    });
    await loginPage.reload();
    await loginPage.waitForTimeout(2000);

    await loginPage.screenshot({
      path: join(EXTENSION_SCREENSHOT_DIR, "popup-login.png"),
      fullPage: false,
    });
    console.log("  ✓ popup-login.png (login state)");
    await loginPage.close();

    // ── Re-inject token and capture logged-in popup ──
    const popupPage = await context.newPage();
    await popupPage.setViewportSize({ width: 400, height: 600 });
    await popupPage.goto(`chrome-extension://${extensionId}/popup.html`);
    await popupPage.waitForTimeout(1000);

    // Set token back
    await popupPage.evaluate((token) => {
      return new Promise((resolve) => {
        chrome.storage.local.set({ extensionToken: token }, () =>
          resolve(true),
        );
      });
    }, EXTENSION_TOKEN);
    // Reload to pick up the token
    await popupPage.reload();
    await popupPage.waitForTimeout(4000);

    await popupPage.screenshot({
      path: join(EXTENSION_SCREENSHOT_DIR, "popup-dashboard.png"),
      fullPage: false,
    });
    console.log("  ✓ popup-dashboard.png (logged in)");
    await popupPage.close();

    // ── New Tab ──
    const newtabPage = await context.newPage();
    await newtabPage.setViewportSize({ width: 1280, height: 800 });
    await newtabPage.goto(`chrome-extension://${extensionId}/newtab.html`);
    await newtabPage.waitForTimeout(4000);

    await newtabPage.screenshot({
      path: join(EXTENSION_SCREENSHOT_DIR, "newtab.png"),
      fullPage: false,
    });
    console.log("  ✓ newtab.png (new tab)");
    await newtabPage.close();
  } finally {
    await context.close();
    try {
      rmSync(userDataDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`Capturing marketing screenshots from ${BASE_URL}...`);
  console.log(`Using account: ${EMAIL}\n`);

  // Dashboard pages — headless
  const browser = await chromium.launch({ headless: true });
  try {
    await captureDashboardPages(browser);
  } finally {
    await browser.close();
  }

  // Extension — headed (required for extensions)
  await captureExtension();

  console.log("\nDone! Screenshots saved to public/screenshots/");
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
