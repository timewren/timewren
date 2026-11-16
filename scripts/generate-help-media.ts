/**
 * Generate screenshots and video demos for the help section.
 *
 * Usage:
 *   npx tsx scripts/generate-help-media.ts
 *   npx tsx scripts/generate-help-media.ts --videos   # also record video demos
 *
 * Prerequisites:
 *   - App running on http://localhost:3000
 *   - Seeded database with test data (npm run db:seed)
 *   - Playwright browsers installed (npx playwright install chromium)
 *   - ffmpeg installed (only needed for --videos to convert webm -> mp4/gif)
 *
 * Output:
 *   public/help/screenshots/*.png     — optimized screenshots (1280x800)
 *   public/help/videos/*.webm         — short video recordings (if --videos)
 *   public/help/videos/*.mp4          — converted mp4 (if ffmpeg available)
 */

import { execSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { type BrowserContext, chromium, type Page } from "playwright";

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const OUTPUT_DIR = path.resolve(__dirname, "../public/help");
const SCREENSHOT_DIR = path.join(OUTPUT_DIR, "screenshots");
const VIDEO_DIR = path.join(OUTPUT_DIR, "videos");
const INCLUDE_VIDEOS = process.argv.includes("--videos");

// Test credentials — matches db:seed
const TEST_EMAIL = process.env.TEST_EMAIL || "test@example.com";
const TEST_PASSWORD = process.env.TEST_PASSWORD || "password123";

// Screenshot definitions: what to capture for each help topic
const screenshots: {
  id: string;
  topicId: string;
  label: string;
  path: string;
  waitFor?: string;
  action?: (page: Page) => Promise<void>;
}[] = [
  {
    id: "dashboard-overview",
    topicId: "dashboard",
    label: "Dashboard overblik",
    path: "/dashboard",
    waitFor: "[data-testid='dashboard'], .grid",
  },
  {
    id: "clients-list",
    topicId: "clients",
    label: "Klientoversigt",
    path: "/dashboard/clients",
    waitFor: "table, .grid",
  },
  {
    id: "projects-list",
    topicId: "projects",
    label: "Projektoversigt",
    path: "/dashboard/projects",
    waitFor: "table, .grid",
  },
  {
    id: "time-tracking",
    topicId: "time-tracking",
    label: "Tidstracking med timer",
    path: "/dashboard/time",
    waitFor: "button, table",
  },
  {
    id: "tasks-kanban",
    topicId: "tasks",
    label: "Opgaver kanban-board",
    path: "/dashboard/tasks",
    waitFor: ".grid, table, [data-testid]",
  },
  {
    id: "klippekort-overview",
    topicId: "klippekort",
    label: "Klippekort oversigt",
    path: "/dashboard/klippekort",
    waitFor: "table, .grid",
  },
  {
    id: "invoices-list",
    topicId: "invoices",
    label: "Fakturaoversigt",
    path: "/dashboard/invoices",
    waitFor: "table, .grid",
  },
  {
    id: "reports-view",
    topicId: "reports",
    label: "Rapporter",
    path: "/dashboard/reports",
    waitFor: "table, .grid, svg",
  },
  {
    id: "templates-list",
    topicId: "templates",
    label: "Tilbagevendende skabeloner",
    path: "/dashboard/templates",
    waitFor: "table, .grid",
  },
  {
    id: "integrations-page",
    topicId: "integrations",
    label: "Integrationer",
    path: "/dashboard/integrations",
    waitFor: ".grid, .card",
  },
  {
    id: "settings-page",
    topicId: "settings",
    label: "Indstillinger",
    path: "/dashboard/settings",
    waitFor: "form, .card",
  },
  {
    id: "security-settings",
    topicId: "security",
    label: "Sikkerhedsindstillinger",
    path: "/dashboard/settings/security",
    waitFor: "form, .card, button",
  },
];

// Video/GIF demo definitions: short interactions to record
const videoDemos: {
  id: string;
  topicId: string;
  label: string;
  steps: (page: Page) => Promise<void>;
}[] = [
  {
    id: "timer-start-stop",
    topicId: "time-tracking",
    label: "Start og stop timer",
    steps: async (page) => {
      await page.goto(`${BASE_URL}/dashboard/time`);
      await page.waitForLoadState("networkidle");
      await wait(1000);
      // Click start button if visible
      const startBtn = page.locator(
        'button:has-text("Start"), button[aria-label*="Start"]',
      );
      if (
        await startBtn
          .first()
          .isVisible({ timeout: 3000 })
          .catch(() => false)
      ) {
        await startBtn.first().click();
        await wait(3000);
        // Click stop
        const stopBtn = page.locator(
          'button:has-text("Stop"), button[aria-label*="Stop"]',
        );
        if (
          await stopBtn
            .first()
            .isVisible({ timeout: 2000 })
            .catch(() => false)
        ) {
          await stopBtn.first().click();
        }
      }
      await wait(1000);
    },
  },
  {
    id: "command-palette",
    topicId: "keyboard-shortcuts",
    label: "Command Palette (Ctrl+K)",
    steps: async (page) => {
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");
      await wait(1000);
      // Open command palette
      await page.keyboard.press("Control+k");
      await wait(1500);
      // Type a search
      await page.keyboard.type("klient", { delay: 100 });
      await wait(2000);
      // Close
      await page.keyboard.press("Escape");
      await wait(500);
    },
  },
  {
    id: "dashboard-widgets",
    topicId: "dashboard",
    label: "Dashboard widgets",
    steps: async (page) => {
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");
      await wait(2000);
      // Scroll down slowly to show widgets
      await page.evaluate(() => {
        window.scrollBy({ top: 400, behavior: "smooth" });
      });
      await wait(2000);
    },
  },
  {
    id: "keyboard-navigation",
    topicId: "keyboard-shortcuts",
    label: "Tastaturnavigation",
    steps: async (page) => {
      await page.goto(`${BASE_URL}/dashboard`);
      await page.waitForLoadState("networkidle");
      await wait(1000);
      // Show shortcut overlay
      await page.keyboard.press("?");
      await wait(3000);
      await page.keyboard.press("Escape");
      await wait(500);
    },
  },
];

// --- Helpers ---

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hasFfmpeg(): boolean {
  try {
    execSync("ffmpeg -version", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function convertToMp4(inputPath: string, outputPath: string) {
  try {
    execSync(
      `ffmpeg -y -i "${inputPath}" -c:v libx264 -preset fast -crf 28 -an -movflags +faststart -vf "scale=1280:-2" "${outputPath}"`,
      { stdio: "ignore" },
    );
    console.log(`  -> Converted to MP4: ${path.basename(outputPath)}`);
  } catch (e) {
    console.warn(`  -> Failed to convert to MP4: ${e}`);
  }
}

function convertToGif(inputPath: string, outputPath: string) {
  try {
    // Two-pass GIF generation for smaller files
    const palettePath = inputPath.replace(".webm", "-palette.png");
    execSync(
      `ffmpeg -y -i "${inputPath}" -vf "fps=10,scale=640:-1:flags=lanczos,palettegen=max_colors=128" "${palettePath}"`,
      { stdio: "ignore" },
    );
    execSync(
      `ffmpeg -y -i "${inputPath}" -i "${palettePath}" -lavfi "fps=10,scale=640:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer:bayer_scale=3" "${outputPath}"`,
      { stdio: "ignore" },
    );
    // Clean up palette
    try {
      execSync(`rm "${palettePath}"`, { stdio: "ignore" });
    } catch {}
    console.log(`  -> Converted to GIF: ${path.basename(outputPath)}`);
  } catch (e) {
    console.warn(`  -> Failed to convert to GIF: ${e}`);
  }
}

// --- Main ---

async function login(page: Page) {
  console.log("Logging in...");
  await page.goto(`${BASE_URL}/login`);
  await page.waitForLoadState("networkidle");

  // Try to find email/password fields
  const emailInput = page.locator(
    'input[type="email"], input[name="email"], input[placeholder*="mail"]',
  );
  const passwordInput = page.locator(
    'input[type="password"], input[name="password"]',
  );

  if (
    (await emailInput
      .first()
      .isVisible({ timeout: 5000 })
      .catch(() => false)) &&
    (await passwordInput
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false))
  ) {
    await emailInput.first().fill(TEST_EMAIL);
    await passwordInput.first().fill(TEST_PASSWORD);
    const submitBtn = page.locator(
      'button[type="submit"], button:has-text("Log ind")',
    );
    await submitBtn.first().click();
    await page.waitForURL("**/dashboard**", { timeout: 15000 });
    console.log("Logged in successfully!");
  } else {
    console.log(
      "Could not find login form. Make sure the app is running and has a test user.",
    );
    console.log("Continuing without login — screenshots may show login page.");
  }
}

async function captureScreenshots(page: Page) {
  console.log("\n--- Capturing Screenshots ---\n");

  for (const ss of screenshots) {
    try {
      console.log(`Capturing: ${ss.label} (${ss.path})`);
      await page.goto(`${BASE_URL}${ss.path}`);
      await page.waitForLoadState("networkidle");

      // Wait for content
      if (ss.waitFor) {
        try {
          await page.waitForSelector(ss.waitFor, { timeout: 5000 });
        } catch {
          // Content may not exist with test data, continue anyway
        }
      }

      // Run custom action if defined
      if (ss.action) {
        await ss.action(page);
      }

      // Small delay for animations to complete
      await wait(500);

      const filePath = path.join(SCREENSHOT_DIR, `${ss.id}.png`);
      await page.screenshot({
        path: filePath,
        fullPage: false,
        type: "png",
      });
      console.log(`  -> Saved: ${ss.id}.png`);
    } catch (e) {
      console.error(`  -> Failed: ${ss.id} — ${e}`);
    }
  }
}

async function captureVideos(context: BrowserContext) {
  console.log("\n--- Recording Video Demos ---\n");
  const ffmpegAvailable = hasFfmpeg();
  if (!ffmpegAvailable) {
    console.warn(
      "ffmpeg not found — videos will be saved as .webm only (no MP4/GIF conversion)",
    );
  }

  for (const demo of videoDemos) {
    try {
      console.log(`Recording: ${demo.label}`);

      // Create a new page with video recording
      const videoPage = await context.newPage();

      // Run the demo steps
      await demo.steps(videoPage);

      // Close page to finalize video
      await videoPage.close();

      // Get the video file
      const video = videoPage.video();
      if (video) {
        const videoPath = await video.path();
        if (videoPath) {
          const outputWebm = path.join(VIDEO_DIR, `${demo.id}.webm`);
          // Move the recorded video
          execSync(`cp "${videoPath}" "${outputWebm}"`);
          console.log(`  -> Saved: ${demo.id}.webm`);

          // Convert if ffmpeg available
          if (ffmpegAvailable) {
            const outputMp4 = path.join(VIDEO_DIR, `${demo.id}.mp4`);
            const outputGif = path.join(VIDEO_DIR, `${demo.id}.gif`);
            convertToMp4(outputWebm, outputMp4);
            convertToGif(outputWebm, outputGif);
          }
        }
      }
    } catch (e) {
      console.error(`  -> Failed: ${demo.id} — ${e}`);
    }
  }
}

async function main() {
  // Ensure output directories exist
  mkdirSync(SCREENSHOT_DIR, { recursive: true });
  if (INCLUDE_VIDEOS) {
    mkdirSync(VIDEO_DIR, { recursive: true });
  }

  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Output: ${OUTPUT_DIR}`);
  console.log(
    `Videos: ${INCLUDE_VIDEOS ? "Yes" : "No (use --videos to enable)"}`,
  );
  console.log("");

  const browser = await chromium.launch({ headless: true });

  // Create context with viewport and optional video recording
  const contextOptions: Parameters<typeof browser.newContext>[0] = {
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 2, // Retina-quality screenshots
    colorScheme: "light",
    locale: "da-DK",
    // Dismiss cookie consent
    storageState: {
      cookies: [],
      origins: [
        {
          origin: BASE_URL,
          localStorage: [
            {
              name: "timetrack_cookie_consent",
              value: JSON.stringify({
                necessary: true,
                analytics: false,
                timestamp: Date.now(),
                version: "1.0",
              }),
            },
          ],
        },
      ],
    },
  };

  if (INCLUDE_VIDEOS) {
    contextOptions.recordVideo = {
      dir: path.join(OUTPUT_DIR, "videos-raw"),
      size: { width: 1280, height: 800 },
    };
  }

  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();

  // Login first
  await login(page);

  // Take screenshots
  await captureScreenshots(page);

  // Record videos if requested
  if (INCLUDE_VIDEOS) {
    await captureVideos(context);
  }

  // Also capture dark mode screenshots
  console.log("\n--- Capturing Dark Mode Screenshots ---\n");
  await context.close();

  const darkContext = await browser.newContext({
    ...contextOptions,
    colorScheme: "dark",
    recordVideo: undefined, // No videos for dark mode
  });
  const darkPage = await darkContext.newPage();
  await login(darkPage);

  // Just capture a few key dark mode screenshots
  const darkScreenshots = screenshots.filter((s) =>
    ["dashboard-overview", "time-tracking", "clients-list"].includes(s.id),
  );

  for (const ss of darkScreenshots) {
    try {
      console.log(`Capturing (dark): ${ss.label}`);
      await darkPage.goto(`${BASE_URL}${ss.path}`);
      await darkPage.waitForLoadState("networkidle");
      if (ss.waitFor) {
        try {
          await darkPage.waitForSelector(ss.waitFor, { timeout: 5000 });
        } catch {}
      }
      await wait(500);
      const filePath = path.join(SCREENSHOT_DIR, `${ss.id}-dark.png`);
      await darkPage.screenshot({
        path: filePath,
        fullPage: false,
        type: "png",
      });
      console.log(`  -> Saved: ${ss.id}-dark.png`);
    } catch (e) {
      console.error(`  -> Failed (dark): ${ss.id} — ${e}`);
    }
  }

  await darkContext.close();
  await browser.close();

  console.log("\nDone! Media files saved to:", OUTPUT_DIR);

  // Summary
  console.log("\n--- Summary ---");
  console.log(
    `Screenshots: ${screenshots.length} light + ${darkScreenshots.length} dark`,
  );
  if (INCLUDE_VIDEOS) {
    console.log(`Videos: ${videoDemos.length} demos`);
    if (hasFfmpeg()) {
      console.log("Formats: .webm + .mp4 + .gif");
    } else {
      console.log("Formats: .webm only (install ffmpeg for .mp4 and .gif)");
    }
  }

  console.log("\nTo use in the help section, reference:");
  console.log("  Screenshots: /help/screenshots/{id}.png");
  console.log("  Videos: /help/videos/{id}.mp4 (or .webm/.gif)");
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
