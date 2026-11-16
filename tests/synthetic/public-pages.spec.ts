import { expect, test } from "@playwright/test";

// Syntetisk check af offentlige sider i prod (ingen login). Køres dagligt af
// .github/workflows/synthetic.yml, ikke af den almindelige E2E-suite.

test("login-siden renderer med e-mail- og adgangskodefelt", async ({
  page,
}) => {
  const res = await page.goto("https://app.timetrack.dk/login");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/TimeTrack/);
  await expect(page.locator('input[type="email"]').first()).toBeVisible();
  await expect(page.locator('input[type="password"]').first()).toBeVisible();
});

test("forsiden timetrack.dk renderer", async ({ page }) => {
  const res = await page.goto("https://timetrack.dk/");
  expect(res?.status()).toBe(200);
  await expect(page).toHaveTitle(/TimeTrack/);
  await expect(page.locator("h1").first()).toBeVisible();
});

test("app-health svarer healthy", async ({ request }) => {
  const res = await request.get("https://app.timetrack.dk/api/health");
  expect(res.status()).toBe(200);
  expect((await res.json()).status).toBe("healthy");
});
