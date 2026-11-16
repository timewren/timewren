#!/usr/bin/env node

/**
 * Capture real PWA screenshots from the running app using Playwright.
 *
 * Prerequisites:
 *   - Dev server running: npm run dev
 *   - Database seeded: npm run db:seed
 *
 * Usage:
 *   node scripts/capture-screenshots.mjs
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCREENSHOTS_DIR = join(ROOT, "public", "screenshots");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

// Seed user with sample data
const EMAIL = process.env.SCREENSHOT_EMAIL || "freelancer@test.dk";
const PASSWORD = process.env.SCREENSHOT_PASSWORD || "test123";

if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

/** localStorage entries that dismiss onboarding, tours, cookie consent etc. */
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
  // Skip guided tour
  {
    name: "tour-storage",
    value: JSON.stringify({ state: { hasCompletedTour: true }, version: 0 }),
  },
  // Dismiss PWA install prompt
  {
    name: "pwa-install-dismissed",
    value: JSON.stringify(Date.now()),
  },
];

async function login(page) {
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");

  await page.fill('input[type="email"], input[name="email"]', EMAIL);
  await page.fill('input[type="password"], input[name="password"]', PASSWORD);
  await page.click('button[type="submit"]');

  // Wait for redirect to dashboard
  await page.waitForURL("**/dashboard**", { timeout: 15000 });
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(2000);
}

async function dismissOverlays(page) {
  // Close any toasts
  const toasts = page.locator("[data-sonner-toast] button[data-close-button]");
  const toastCount = await toasts.count();
  for (let i = 0; i < toastCount; i++) {
    await toasts
      .nth(i)
      .click()
      .catch(() => {});
  }

  // Dismiss tour if still visible
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
      origins: [
        {
          origin: BASE_URL,
          localStorage: CLEAN_LOCAL_STORAGE,
        },
      ],
    },
  });
}

async function captureDesktop(browser) {
  const context = await createContext(browser, { width: 1920, height: 1080 });
  const page = await context.newPage();

  try {
    await login(page);
    await dismissOverlays(page);

    // Screenshot 1: Dashboard
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "desktop-dashboard.png"),
      fullPage: false,
    });
    console.log("✓ desktop-dashboard.png (1920x1080)");

    // Screenshot 2: Time tracking page — select "Denne måned" to show data
    await page.goto(`${BASE_URL}/dashboard/time`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    const monthBtn = page.locator('button:has-text("Denne måned")');
    if (await monthBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
      await monthBtn.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "desktop-time.png"),
      fullPage: false,
    });
    console.log("✓ desktop-time.png (1920x1080)");
  } finally {
    await context.close();
  }
}

async function captureMobile(browser) {
  const context = await createContext(
    browser,
    { width: 375, height: 667 },
    true,
  );
  const page = await context.newPage();

  try {
    await login(page);
    await dismissOverlays(page);

    // Screenshot 1: Dashboard mobile
    await page.goto(`${BASE_URL}/dashboard`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "mobile-dashboard.png"),
      fullPage: false,
    });
    console.log("✓ mobile-dashboard.png (750x1334 @2x)");

    // Screenshot 2: Time tracking mobile — select "Denne måned" to show data
    await page.goto(`${BASE_URL}/dashboard/time`, { waitUntil: "networkidle" });
    await page.waitForTimeout(2000);
    await dismissOverlays(page);
    const monthBtnMobile = page.locator('button:has-text("Denne måned")');
    if (await monthBtnMobile.isVisible({ timeout: 1000 }).catch(() => false)) {
      await monthBtnMobile.click();
      await page.waitForLoadState("networkidle");
      await page.waitForTimeout(2000);
    }
    await page.screenshot({
      path: join(SCREENSHOTS_DIR, "mobile-time.png"),
      fullPage: false,
    });
    console.log("✓ mobile-time.png (750x1334 @2x)");
  } finally {
    await context.close();
  }
}

async function main() {
  console.log(`Capturing PWA screenshots from ${BASE_URL}...`);
  console.log(`Using account: ${EMAIL}\n`);

  const browser = await chromium.launch({ headless: true });

  try {
    await captureDesktop(browser);
    await captureMobile(browser);
    console.log("\nDone! Real screenshots saved to public/screenshots/");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Screenshot capture failed:", err);
  process.exit(1);
});
