/**
 * Tager screenshots af renderede mails (fra mail-previews.preview.tsx).
 *
 *   node scripts/brand/screenshot-mails.mjs <html-mappe> <png-mappe> [id,id,...] [bredder]
 *
 * Fjerde argument er bredderne, fx "375,600" (standard 375 og 1440 px).
 * Ids skal så også angives, fx RebrandVarsel.
 *
 * Tre tilstande pr. mail ved hver bredde:
 * - lys: som Gmail web og Apple Mail i lys tilstand
 * - moerk: prefers-color-scheme: dark (Apple Mail, iOS Mail, Outlook.com)
 * - invert: tvungen inversion som Gmail iOS og Outlook 2021/M365 på Windows
 *
 * Billeder under https://timetrack.dk/brand/ hentes fra public/brand/, så
 * nye logoer kan ses, før de er deployet.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium } from "@playwright/test";

const [, , htmlDir, outDir, only, widthArg] = process.argv;
if (!htmlDir || !outDir) {
  console.error("Brug: screenshot-mails.mjs <html-mappe> <png-mappe> [ids]");
  process.exit(1);
}
const ids = only ? new Set(only.split(",")) : null;
const widths = widthArg ? widthArg.split(",").map(Number) : [375, 1440];
const publicBrand = resolve("public/brand");
mkdirSync(outDir, { recursive: true });

const INVERT_CSS =
  "html{filter:invert(1) hue-rotate(180deg);background:#fff}img{filter:invert(1) hue-rotate(180deg)}";

const browser = await chromium.launch();
const files = readdirSync(htmlDir).filter((f) => f.endsWith(".html"));
for (const file of files) {
  const id = file.replace(/\.html$/, "");
  if (ids && !ids.has(id)) continue;
  const html = readFileSync(join(htmlDir, file), "utf8");
  for (const width of widths) {
    for (const mode of ["lys", "moerk", "invert"]) {
      const context = await browser.newContext({
        viewport: { width, height: 900 },
        colorScheme: mode === "moerk" ? "dark" : "light",
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      await page.route("https://timetrack.dk/brand/**", (route) => {
        const name = new URL(route.request().url()).pathname.replace(
          "/brand/",
          "",
        );
        const local = join(publicBrand, name);
        if (existsSync(local)) return route.fulfill({ path: local });
        return route.fulfill({ status: 404, body: "" });
      });
      await page.setContent(html, { waitUntil: "networkidle" });
      if (mode === "invert") await page.addStyleTag({ content: INVERT_CSS });
      await page.screenshot({
        path: join(outDir, `${id}-${width}-${mode}.png`),
        fullPage: true,
      });
      await context.close();
    }
  }
  console.log("ok", id);
}
await browser.close();
