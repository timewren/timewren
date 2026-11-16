import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";
import { demoData, locales, scenes } from "./demo";
import { seedDemo } from "./seed-demo";

export async function captureTimewren() {
  const base = process.env.SCREENSHOT_BASE_URL ?? "http://127.0.0.1:3000";
  const url = new URL(base);
  if (url.hostname !== "127.0.0.1")
    throw new Error("Capture only accepts 127.0.0.1");
  const { password, today } = await seedDemo();
  const browser = await chromium.launch({ chromiumSandbox: true });
  const rows: string[] = [];
  try {
    for (const locale of locales) {
      const d = demoData(locale, today);
      const out = join("public/brand/timewren/screens", locale);
      await mkdir(out, { recursive: true });
      const context = await browser.newContext({
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 2,
        locale,
        timezoneId: "UTC",
        colorScheme: "light",
        reducedMotion: "reduce",
        serviceWorkers: "block",
      });
      // No external connections, including analytics and release checks.
      await context.route("**/*", (route) =>
        new URL(route.request().url()).origin === url.origin
          ? route.continue()
          : route.abort(),
      );
      await context.addCookies([
        { name: "locale", value: locale, url: base },
        {
          name: "tt_consent",
          value: encodeURIComponent(
            JSON.stringify({
              necessary: true,
              analytics: false,
              marketing: false,
              timestamp: +today,
              version: "1.0",
            }),
          ),
          url: base,
        },
      ]);
      await context.addInitScript(() => {
        Reflect.deleteProperty(Navigator.prototype, "serviceWorker");
        localStorage.setItem(
          "tour-storage",
          JSON.stringify({ state: { hasCompletedTour: true }, version: 0 }),
        );
        localStorage.setItem("theme", "light");
        localStorage.setItem("pwa-install-dismissed", String(Date.now()));
        localStorage.setItem("tasks-email-banner-dismissed", "true");
      });
      const login = await context.request.post(
        `${base}/api/auth/sign-in/email`,
        {
          data: { email: d.email, password },
          headers: { origin: base },
          timeout: 600000,
        },
      );
      if (!login.ok()) throw new Error(`Demo login failed (${login.status()})`);
      console.log(`Logged in to the ${locale} demo.`);
      const page = await context.newPage();
      const pending = new Set<string>();
      page.on("request", (request) =>
        pending.add(new URL(request.url()).pathname),
      );
      page.on("requestfinished", (request) =>
        pending.delete(new URL(request.url()).pathname),
      );
      page.on("requestfailed", (request) =>
        pending.delete(new URL(request.url()).pathname),
      );
      await page.clock.setFixedTime(today);
      for (const [name, path] of Object.entries(scenes)) {
        console.log(`Opening ${locale}/${name}...`);
        const dark = name.endsWith("-dark");
        const mobile = name === "mobile-dashboard";
        const overview = name === "dashboard" || name === "dashboard-dark";
        await page.setViewportSize(
          mobile ? { width: 390, height: 844 } : { width: 1440, height: 900 },
        );
        try {
          await page.goto(`${base}${overview ? "/dashboard" : path}`, {
            waitUntil: "networkidle",
            timeout: 600000,
          });
          if (overview) {
            await page
              .locator('a[href="/dashboard/tasks"]')
              .first()
              .waitFor({ timeout: 600000 });
            await page
              .locator('a[href="/dashboard/overblik"]')
              .first()
              .click({ timeout: 600000 });
            await page.waitForURL("**/dashboard/overblik", { timeout: 600000 });
            await page.waitForLoadState("networkidle", { timeout: 600000 });
            await page.locator('[data-tour="dashboard-widgets"]').waitFor();
          }
        } catch (error) {
          console.error(`Pending paths: ${[...pending].join(", ")}`);
          await page.screenshot({ path: "/tmp/timewren-capture-failure.png" });
          console.error(
            (await page.locator("body").textContent())?.slice(0, 1500),
          );
          throw error;
        }
        await page.evaluate(async (isDark) => {
          localStorage.setItem("theme", isDark ? "dark" : "light");
          document.documentElement.classList.toggle("dark", isDark);
          document.documentElement.style.colorScheme = isDark
            ? "dark"
            : "light";
          await document.fonts.ready;
        }, dark);
        await page.locator("#main-content").waitFor();
        const scene = name.replace(/-dark$/, "");
        const expected = scene.includes("dashboard")
          ? d.clients[5].name
          : scene === "calendar"
            ? d.text.meeting
            : scene === "timer" || scene === "tasks" || scene === "reports"
              ? d.text.work[0]
              : scene === "projects"
                ? d.text.projects[0]
                : d.clients[0].name;
        await page
          .locator("#main-content")
          .getByText(expected, { exact: false })
          .first()
          .waitFor({ timeout: 60000 });
        await page.waitForFunction(
          () =>
            !document.querySelector(
              "#main-content .animate-pulse, #main-content .animate-spin, #main-content [aria-busy=true]",
            ),
          undefined,
          { timeout: 30000 },
        );
        if (
          await page.locator('[data-sonner-toast][data-type="error"]').count()
        )
          throw new Error(`App error toast: ${locale}/${name}`);
        if (name.includes("dashboard")) {
          const close = page.getByTitle(
            {
              en: "Dismiss alert",
              da: "Luk advarsel",
              de: "Warnung schließen",
              es: "Cerrar aviso",
            }[locale],
            { exact: true },
          );
          while (await close.count()) await close.first().click();
        }
        await page.addStyleTag({
          content:
            'nextjs-portal, [data-sonner-toaster], [data-cookie-banner], [data-bugbottle="ui"] { display:none!important } *, *::before, *::after { animation:none!important; transition:none!important; caret-color:transparent!important }',
        });
        // biome-ignore lint/performance/useDomNodeTextContent: validate visible screenshot text
        const body = await page.locator("body").innerText();
        if (
          /Mahope|TimeTrack|Application error|Internal Server Error|Feature disabled|Funktion deaktiveret|Funktion deaktiviert|Función desactivada/.test(
            body,
          )
        )
          throw new Error(`Brand/error check failed: ${locale}/${name}`);
        if ((await page.locator("html").getAttribute("lang")) !== locale)
          throw new Error(`Wrong locale: ${locale}/${name}`);
        if (name === "tasks" && (locale === "de" || locale === "es")) {
          await page
            .getByRole("combobox", {
              name: locale === "de" ? "Sortieren" : "Ordenar",
              exact: true,
            })
            .waitFor();
          await page
            .getByRole("button", {
              name:
                locale === "de" ? "Spalten anpassen" : "Personalizar columnas",
              exact: true,
            })
            .waitFor();
        }
        if (
          !body.includes(d.text.people[0].split(" ")[0]) &&
          name === "dashboard"
        )
          throw new Error(`Missing demo content: ${locale}`);
        const png = await page.screenshot({ animations: "disabled" });
        let quality = 82;
        let webp = await sharp(png).webp({ quality }).toBuffer();
        while (webp.length > 250 * 1024 && quality > 45) {
          quality -= 5;
          webp = await sharp(png).webp({ quality }).toBuffer();
        }
        if (webp.length > 250 * 1024)
          throw new Error(`Image exceeds size limit: ${locale}/${name}`);
        await writeFile(join(out, `${name}.webp`), webp);
        rows.push(
          `| ${locale} | ${name} | ${mobile ? "780×1688" : "2880×1800"} | ${Math.ceil(webp.length / 1024)} KB | [Image](../../${out}/${name}.webp) |`,
        );
        console.log(
          `Captured ${locale}/${name}.webp (${Math.ceil(webp.length / 1024)} KB)`,
        );
      }
      const tiles = await Promise.all(
        Object.keys(scenes).map(async (name, i) => ({
          input: await sharp(join(out, `${name}.webp`))
            .resize(576, 360, { fit: "contain", background: "#e5e7eb" })
            .png()
            .toBuffer(),
          left: (i % 3) * 576,
          top: Math.floor(i / 3) * 390 + 30,
        })),
      );
      const labels = Buffer.from(
        `<svg width="1728" height="1560" xmlns="http://www.w3.org/2000/svg">${Object.keys(
          scenes,
        )
          .map(
            (name, i) =>
              `<text x="${(i % 3) * 576 + 12}" y="${Math.floor(i / 3) * 390 + 22}" font-family="sans-serif" font-size="18" fill="#111827">${locale} / ${name}</text>`,
          )
          .join("")}</svg>`,
      );
      await mkdir("docs/research", { recursive: true });
      await sharp({
        create: {
          width: 1728,
          height: 1560,
          channels: 3,
          background: "#e5e7eb",
        },
      })
        .composite([{ input: labels }, ...tiles])
        .webp({ quality: 85 })
        .toFile(`docs/research/timewren-contact-${locale}.webp`);
      await context.close();
    }
    await mkdir("docs/research", { recursive: true });
    await writeFile(
      "docs/research/2026-11-09-timewren-screens.md",
      `# TimeWren screenshots\n\nFictional demo organisations. Captured locally on ${today.toISOString().slice(0, 10)}; light mode unless marked dark. CSS viewport: desktop 1440×900, mobile 390×844; scale 2. No browser chrome.\n\n${locales.map((locale) => `## ${locale}\n\n![${locale} contact sheet](timewren-contact-${locale}.webp)\n`).join("\n")}\n| Locale | Scene | Pixels | Size | Preview |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
    );
    execFileSync(
      process.execPath,
      [
        "node_modules/@biomejs/biome/bin/biome",
        "format",
        "--write",
        "docs/research/2026-11-09-timewren-screens.md",
      ],
      { stdio: "ignore" },
    );
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  captureTimewren().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

import { execFileSync } from "node:child_process";
