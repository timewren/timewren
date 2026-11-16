import { expect, test } from "@playwright/test";

const baseURL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
const baseline = process.env.MARKETING_BASELINE === "1";

test("marketing cache headers and app locale isolation", async ({
  request,
}) => {
  for (const locale of ["da", "en"]) {
    for (const path of ["/", "/klippekort"]) {
      const response = await request.get(path, {
        headers: { cookie: `locale=${locale}` },
      });
      expect(response.status()).toBe(200);
      expect(await response.text()).toContain(
        `<html lang="${baseline ? locale : "da"}"`,
      );
      const cache = response.headers()["cache-control"];
      console.log(
        `${path} cookie=${locale} cache-control=${cache} x-nextjs-cache=${response.headers()["x-nextjs-cache"]}`,
      );
      if (baseline) expect(cache).toContain("no-store");
      else {
        expect(cache).not.toContain("no-store");
        expect(response.headers()["x-nextjs-cache"]).toBe("HIT");
      }
    }
    for (const path of [
      "/dashboard",
      "/admin",
      "/portal/login",
      "/login",
      "/register",
    ]) {
      const response = await request.get(path, {
        headers: { cookie: `locale=${locale}` },
      });
      expect(response.status()).toBe(200);
      const html = await response.text();
      const expectedLocale =
        baseline && path === "/portal/login" ? "da" : locale;
      expect(
        html.match(/<html[^>]*lang="([^"]+)"/)?.[1],
        `${path} cookie=${locale}`,
      ).toBe(expectedLocale);
      if (!baseline) expect(html.match(/<html[ >]/g)).toHaveLength(1);
      expect(response.headers()["cache-control"]).toContain("no-store");
    }
  }
});

test("switching locale and navigating between marketing and app roots", async ({
  page,
  context,
}) => {
  await context.addCookies([{ name: "locale", value: "da", url: baseURL }]);
  await page.goto("/login");
  await page.screenshot({
    path: `/tmp/tt-static-evidence/${baseline ? "before" : "after"}-login.png`,
  });
  await expect(page.locator("html")).toHaveAttribute("lang", "da");
  // The settings language selector writes this cookie and reloads the document.
  for (const locale of ["en", "da"]) {
    await context.addCookies([{ name: "locale", value: locale, url: baseURL }]);
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await page.locator(`a[href="${baseURL}/"]`).first().click();
    await expect(page).toHaveURL(`${baseURL}/`);
    await page.screenshot({
      path: `/tmp/tt-static-evidence/${baseline ? "before" : "after"}-marketing-${locale}.png`,
    });
    await expect(page.locator("html")).toHaveAttribute(
      "lang",
      baseline ? locale : "da",
    );
    await page.locator('a[href="/login"]').first().click();
    await expect(page).toHaveURL(`${baseURL}/login`);
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
  }
});

test("settings language switch translates the dashboard in both directions", async ({
  page,
  context,
}) => {
  let locale = "da";
  const profile = () => ({
    id: "locale-test-user",
    name: "Locale test",
    email: "locale@example.invalid",
    locale,
    onboardingCompleted: true,
    onboardingTourCompleted: true,
    theme: "light",
    startPage: "/dashboard",
    image: null,
  });
  await context.addCookies([{ name: "locale", value: locale, url: baseURL }]);
  await page.route("**/api/auth/**", (route) =>
    route.fulfill({
      json: {
        user: profile(),
        session: {
          id: "locale-test-session",
          userId: "locale-test-user",
          expiresAt: "2099-01-01T00:00:00.000Z",
        },
      },
    }),
  );
  await page.route("**/api/trpc/**", async (route) => {
    const url = new URL(route.request().url());
    const procedures = decodeURIComponent(
      url.pathname.split("/api/trpc/")[1],
    ).split(",");
    const responses = procedures.map((procedure) => {
      let data: unknown = null;
      if (procedure === "user.updateProfile") {
        const body = route.request().postDataJSON();
        const input = body?.["0"]?.json ?? body?.json;
        locale = input?.locale ?? locale;
        data = profile();
      } else if (procedure === "user.getProfile") data = profile();
      else if (procedure === "user.getTheme") data = { theme: "light" };
      else if (procedure === "subscription.getDetails")
        data = { status: "active", plan: "solo" };
      else if (procedure === "organization.getCurrent")
        data = { modules: [], orgProfile: "freelance" };
      else if (procedure.endsWith("getMyRole"))
        data = { role: "owner", canManage: true, isSolo: true };
      else if (procedure.endsWith("getMyPermissions")) data = [];
      return { result: { data: { json: data } } };
    });
    await route.fulfill({
      json: url.searchParams.has("batch") ? responses : responses[0],
    });
  });
  await page.goto("/dashboard/settings");
  const selector = page.locator("#sprog select");
  await expect(selector).toHaveValue("da");
  for (const [nextLocale, heading] of [
    ["en", "Language"],
    ["da", "Sprog"],
  ]) {
    await selector.selectOption(nextLocale);
    await expect(page.locator("html")).toHaveAttribute("lang", nextLocale);
    await expect(page.locator("#sprog h2")).toHaveText(heading);
    await expect(selector).toHaveValue(nextLocale);
    expect(
      (await context.cookies()).find((cookie) => cookie.name === "locale")
        ?.value,
    ).toBe(nextLocale);
  }
});

test("unknown URLs retain the branded 404", async ({ request }) => {
  const response = await request.get("/missing-static-marketing-test", {
    headers: { cookie: "locale=da" },
  });
  expect(response.status()).toBe(404);
  expect(await response.text()).toContain("Siden findes ikke");
});

test("invalid report links retain the branded app 404", async ({
  page,
  context,
}) => {
  for (const locale of ["da", "en"]) {
    await context.addCookies([{ name: "locale", value: locale, url: baseURL }]);
    const response = await page.goto(`/r/${"a".repeat(65)}`);
    expect(response?.status()).toBe(404);
    const html = await response?.text();
    expect(html).toContain("Siden findes ikke");
    expect(html).not.toContain("This page could not be found");
    await expect(page.locator("html")).toHaveAttribute("lang", locale);
    await expect(
      page.getByRole("heading", { name: "Rapporten kan ikke vises" }),
    ).toBeVisible();
    expect(html).toContain("/dashboard");
    expect(html).toContain("Gå til forsiden");
    await expect(page.getByText("This page could not be found")).toHaveCount(0);
    await page.screenshot({
      path: `/tmp/tt-static-evidence/report-404-${locale}.png`,
    });
  }
});
