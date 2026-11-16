import { CONSENT_STATE } from "./consent";
import { expect, test } from "./helpers";

/**
 * Røgtest af de offentlige marketingsider: de skal loade (200, synlig h1) uden
 * konsolfejl eller ufangede exceptions. Eksterne requests er blokeret af
 * test-fixturen, så fejl fra dem filtreres fra.
 */
const PUBLIC_PAGES = [
  "/",
  "/pricing",
  "/privat",
  "/selvstaendig",
  "/teams-og-bureauer",
  "/virksomheder",
];

// Kendt dev-only-advarsel: <GoogleAds /> renderer next/script direkte under
// <html> i root-layoutet. React logger det kun i development (beskeden kommer
// uformateret med %s-pladsholdere), så kun netop html/script-kombinationen ignoreres.
function isKnownDevNoise(text: string) {
  if (
    text.includes(
      "Cannot render a sync or defer <script> outside the main document",
    )
  ) {
    return true;
  }
  return (
    /cannot be a child of|cannot contain a nested/.test(text) &&
    /<script> html|html <script>/.test(text)
  );
}

function isIgnorable(text: string) {
  return (
    // Eksterne requests afvises bevidst af fixturen.
    text.includes("net::ERR_FAILED") ||
    text.includes("net::ERR_BLOCKED_BY_CLIENT") ||
    /googletagmanager|googlesyndication|google-analytics|analytics\.holstjensen/.test(
      text,
    ) ||
    isKnownDevNoise(text)
  );
}

test.describe("Offentlige sider", () => {
  test.use({ storageState: CONSENT_STATE });

  for (const path of PUBLIC_PAGES) {
    test(`${path} loader uden konsolfejl`, async ({ page }) => {
      const errors: string[] = [];
      page.on("console", (msg) => {
        if (msg.type() === "error" && !isIgnorable(msg.text())) {
          errors.push(msg.text());
        }
      });
      page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));

      const response = await page.goto(path, { waitUntil: "load" });
      expect(response?.status(), `HTTP-status for ${path}`).toBeLessThan(400);
      await expect(page.locator("h1").first()).toBeVisible();
      // Giv hydrering og klient-effekter tid til at melde fejl.
      await page.waitForLoadState("networkidle");

      expect(errors, `konsolfejl på ${path}`).toEqual([]);
    });
  }
});

test.describe("Offline-side", () => {
  test.use({ storageState: CONSENT_STATE });

  test("/offline hydrerer uden mismatch (React #418)", async ({ page }) => {
    const hydrationErrors: string[] = [];
    const isHydrationError = (text: string) =>
      /hydrat|#418|didn't match|did not match/i.test(text) &&
      !isKnownDevNoise(text);
    page.on("console", (msg) => {
      if (msg.type() === "error" && isHydrationError(msg.text())) {
        hydrationErrors.push(msg.text());
      }
    });
    page.on("pageerror", (err) => {
      if (isHydrationError(err.message)) hydrationErrors.push(err.message);
    });

    await page.goto("/offline");
    // Online → siden sender videre til dashboardet (og derfra til login).
    await expect(page).toHaveURL(/\/(dashboard|login)/);
    expect(hydrationErrors).toEqual([]);
  });
});
