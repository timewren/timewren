import { expect, test } from "./helpers";

/**
 * Regression for QA-fund #1 (rebrand-qa.rapport.md): kalenderens auto-scroll
 * til nuværende klokkeslæt scrollede window, så ugedags-headeren (sticky
 * top-0) delte vinduets scroll-kontekst med DashboardShells sticky topbar og
 * kunne lande oven i den (reproducerede tydeligst når nu er lige efter
 * START_HOUR, fx kl. 07, hvor auto-scrollet lander præcis ved gittertoppen).
 * Fixet ved at lade kalenderens eget gitter-kort scrolle (gridScrollRef),
 * ikke window — derfor tjekkes her også at window slet ikke scroller.
 */
test.describe("Kalenderens ugedags-header overlapper ikke topbaren", () => {
  const viewports = [
    { width: 375, height: 667, label: "mobil" },
    { width: 1280, height: 900, label: "desktop" },
  ];
  const themes = ["light", "dark"] as const;

  for (const viewport of viewports) {
    for (const theme of themes) {
      test(`${viewport.label}, ${theme}`, async ({ page }) => {
        // kl. 07 = START_HOUR+1: auto-scrollet lander præcis ved
        // gittertoppen, hvilket var det reproducerbare worst case.
        await page.clock.setFixedTime(new Date("2026-01-14T07:00:00"));
        await page.addInitScript((t: string) => {
          localStorage.setItem("theme", t);
        }, theme);
        await page.setViewportSize(viewport);

        await page.goto("/dashboard/calendar");

        const dayHeader = page.getByTestId("calendar-week-day-header").first();
        await expect(dayHeader).toBeVisible();

        // Vent på at auto-scroll-effekten (smooth scroll) er færdig.
        await page.waitForTimeout(700);

        const windowScrollY = await page.evaluate(() => window.scrollY);
        expect(windowScrollY).toBe(0);

        const topbarBox = await page
          .getByTestId("dashboard-topbar")
          .boundingBox();
        const dayHeaderBox = await dayHeader.boundingBox();
        if (!topbarBox || !dayHeaderBox) {
          throw new Error("topbar eller ugedags-header blev ikke målt");
        }

        // Ugedags-headeren må starte, hvor topbaren slutter — aldrig oven i den.
        expect(dayHeaderBox.y).toBeGreaterThanOrEqual(
          topbarBox.y + topbarBox.height - 1,
        );
      });
    }
  }
});
