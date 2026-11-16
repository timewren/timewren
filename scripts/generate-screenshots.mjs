#!/usr/bin/env node

/**
 * Generate PWA install screenshots (placeholder images).
 *
 * Replace these with real screenshots of the app for production.
 * Recommended: use Playwright to capture actual app screenshots.
 *
 * Usage:
 *   node scripts/generate-screenshots.mjs
 */

import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const SCREENSHOTS_DIR = join(ROOT, "public", "screenshots");

if (!existsSync(SCREENSHOTS_DIR)) {
  mkdirSync(SCREENSHOTS_DIR, { recursive: true });
}

const BRAND_BLUE = "#3b82f6";
const BG_LIGHT = "#f8fafc";

/**
 * Create a placeholder screenshot with text overlay using pure SVG.
 */
async function createScreenshot(width, height, label, filename) {
  const svg = `
    <svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="${BG_LIGHT}"/>
      <!-- Header bar -->
      <rect width="100%" height="${Math.round(height * 0.08)}" fill="${BRAND_BLUE}"/>
      <text x="${Math.round(width * 0.04)}" y="${Math.round(height * 0.05)}"
            font-family="system-ui, sans-serif" font-size="${Math.round(height * 0.03)}"
            font-weight="bold" fill="white">TimeTrack</text>
      <!-- Center content -->
      <text x="50%" y="45%" text-anchor="middle"
            font-family="system-ui, sans-serif" font-size="${Math.round(height * 0.04)}"
            font-weight="bold" fill="#1e293b">${label}</text>
      <text x="50%" y="52%" text-anchor="middle"
            font-family="system-ui, sans-serif" font-size="${Math.round(height * 0.025)}"
            fill="#64748b">Tidstracking til danske freelancere</text>
      <!-- Feature pills -->
      <rect x="${Math.round(width * 0.15)}" y="${Math.round(height * 0.58)}"
            width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.04)}"
            rx="12" fill="${BRAND_BLUE}" opacity="0.1"/>
      <text x="${Math.round(width * 0.25)}" y="${Math.round(height * 0.607)}"
            text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="${Math.round(height * 0.02)}" fill="${BRAND_BLUE}">Klippekort</text>
      <rect x="${Math.round(width * 0.4)}" y="${Math.round(height * 0.58)}"
            width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.04)}"
            rx="12" fill="${BRAND_BLUE}" opacity="0.1"/>
      <text x="${Math.round(width * 0.5)}" y="${Math.round(height * 0.607)}"
            text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="${Math.round(height * 0.02)}" fill="${BRAND_BLUE}">Fakturering</text>
      <rect x="${Math.round(width * 0.65)}" y="${Math.round(height * 0.58)}"
            width="${Math.round(width * 0.2)}" height="${Math.round(height * 0.04)}"
            rx="12" fill="${BRAND_BLUE}" opacity="0.1"/>
      <text x="${Math.round(width * 0.75)}" y="${Math.round(height * 0.607)}"
            text-anchor="middle" font-family="system-ui, sans-serif"
            font-size="${Math.round(height * 0.02)}" fill="${BRAND_BLUE}">Rapporter</text>
    </svg>`;

  const outPath = join(SCREENSHOTS_DIR, filename);
  await sharp(Buffer.from(svg)).png({ quality: 90 }).toFile(outPath);
  console.log(`✓ ${filename} (${width}x${height})`);
}

async function generate() {
  // Desktop screenshots (wide form factor)
  await createScreenshot(1920, 1080, "Dashboard", "desktop-dashboard.png");
  await createScreenshot(1920, 1080, "Tidsregistrering", "desktop-time.png");

  // Mobile screenshots (narrow form factor)
  await createScreenshot(750, 1334, "Dashboard", "mobile-dashboard.png");
  await createScreenshot(750, 1334, "Tidsregistrering", "mobile-time.png");

  console.log(
    "\nDone! Replace these placeholders with real screenshots for production.",
  );
  console.log(
    "Tip: Use Playwright to capture real screenshots of the running app.",
  );
}

generate().catch((err) => {
  console.error("Failed to generate screenshots:", err);
  process.exit(1);
});
