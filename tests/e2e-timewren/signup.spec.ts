import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BrowserContext, expect, type Page, test } from "@playwright/test";
import postgres from "postgres";

/**
 * TimeWren Cloud ende til ende på https://timewren.com (prods
 * BRANDS_CONFIG-form, MULTIBRAND_ENABLED=1, TIMEWREN_APP_ENABLED=1):
 * tilmelding med mail → bekræftelsesmail fra timewren.com → onboarding →
 * dashboard på Gratis, derefter passkey og magic link. Ingen sociale logins
 * (TimeTracks Google-nøgler er sat på serveren, men må ikke vises her).
 * Køres af scripts/e2e/timewren-cloud.sh.
 */

const MAIL_DIR = process.env.E2E_MAIL_DIR ?? "";
const PASSWORD =
  process.env.E2E_TEST_PASSWORD ?? ["e2e", "Lokal", "9x"].join("-");
const EMAIL = `tw-e2e-${Date.now()}@example.com`;
const consent = encodeURIComponent(
  JSON.stringify({
    necessary: true,
    analytics: false,
    marketing: false,
    timestamp: Date.now(),
    version: "1.0",
  }),
);

let sql: postgres.Sql;
test.beforeAll(() => {
  sql = postgres(process.env.DATABASE_URL ?? "", { max: 1 });
});
test.afterAll(async () => {
  await sql?.end();
});

/** Kun timewren.com; alt eksternt afbrydes, og cookie-banneret er besvaret. */
async function isolate(context: BrowserContext) {
  await context.route(
    (url) => !/^https:\/\/(www\.)?timewren\.com(\/|$)/.test(url.toString()),
    (r) => r.abort(),
  );
  await context.addCookies([
    {
      name: "tt_consent",
      value: consent,
      domain: "timewren.com",
      path: "/",
    },
  ]);
}

/**
 * Siden nævner ikke TimeTrack: synlig tekst, titel og de attributter, en
 * bruger eller skærmlæser møder. Venter på, at klientens tekster er
 * renderet (netværket i ro). Se docs/specs/timewren-cloud.md → App-tekster.
 */
async function expectNoTimeTrack(page: Page) {
  await page.waitForLoadState("networkidle");
  const found = await page.evaluate(() => {
    // biome-ignore lint/performance/useDomNodeTextContent: kun synlig tekst; textContent tager også RSC-payloadens <script> med
    const parts = [document.title, document.body.innerText];
    for (const el of document.querySelectorAll(
      "[title],[aria-label],[placeholder],[alt]",
    )) {
      for (const a of ["title", "aria-label", "placeholder", "alt"]) {
        const v = el.getAttribute(a);
        if (v) parts.push(v);
      }
    }
    return parts
      .join("\n")
      .split("\n")
      .filter((line) => line.includes("TimeTrack"));
  });
  expect(found, `TimeTrack på ${page.url()}`).toEqual([]);
}

type Mail = {
  from: string;
  to: string | string[];
  subject: string;
  html?: string;
};

function mailsTo(email: string): Mail[] {
  return readdirSync(MAIL_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(MAIL_DIR, f), "utf8")) as Mail)
    .filter((m) => [m.to].flat().includes(email));
}

/** Venter på en mail til `email` med et link, der indeholder `path`. */
async function waitForLink(
  email: string,
  path: string,
): Promise<{ mail: Mail; url: string }> {
  let found: { mail: Mail; url: string } | undefined;
  await expect
    .poll(
      () => {
        for (const mail of mailsTo(email).reverse()) {
          const m = (mail.html ?? "").match(
            new RegExp(
              `href="(https://[^"]*${path.replace(/[/.]/g, "\\$&")}[^"]*)"`,
            ),
          );
          if (m) {
            found = { mail, url: m[1].replaceAll("&amp;", "&") };
            return true;
          }
        }
        return false;
      },
      { message: `mail med ${path} til ${email}`, timeout: 30_000 },
    )
    .toBe(true);
  return found as { mail: Mail; url: string };
}

/** Ingen knapper til sociale logins (TimeWren har ingen egne klienter her). */
async function expectNoSocialButtons(page: Page) {
  for (const p of ["Google", "GitHub", "Discord", "Microsoft", "Apple"]) {
    await expect(page.getByRole("button", { name: new RegExp(p) })).toHaveCount(
      0,
    );
  }
}

/**
 * fetch fra siden selv. page.request følger ikke Chromiums
 * --host-resolver-rules og ville ramme det rigtige timewren.com.
 */
async function browserFetch(
  page: Page,
  path: string,
  init?: { method: string; body: unknown },
): Promise<{ status: number; text: string }> {
  return page.evaluate(
    async ([p, i]) => {
      const res = await fetch(p, {
        method: i?.method ?? "GET",
        headers: i ? { "content-type": "application/json" } : undefined,
        body: i ? JSON.stringify(i.body) : undefined,
        redirect: "manual",
      });
      return { status: res.status, text: await res.text() };
    },
    [path, init] as const,
  );
}

async function addVirtualAuthenticator(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", {
    options: {
      protocol: "ctap2",
      transport: "internal",
      hasResidentKey: true,
      hasUserVerification: true,
      isUserVerified: true,
      automaticPresenceSimulation: true,
    },
  });
}

test.describe
  .serial("TimeWren Cloud uden sociale logins", () => {
    test("tilmelding med mail → bekræftelse → onboarding → dashboard på Gratis", async ({
      page,
      context,
    }) => {
      await isolate(context);

      await page.goto("/register");
      // /api/auth/providers svarer ud fra hosten: ingen OAuth på timewren.com.
      const providers = JSON.parse(
        (await browserFetch(page, "/api/auth/providers")).text,
      );
      expect(providers).toMatchObject({
        google: false,
        github: false,
        discord: false,
        microsoft: false,
        email: true,
        magicLink: true,
        passkey: true,
      });

      await expect(page.locator("#email")).toBeVisible();
      await expectNoSocialButtons(page);
      await expectNoTimeTrack(page);
      await page.fill("#name", "TimeWren E2E");
      await page.fill("#email", EMAIL);
      await page.fill("#password", PASSWORD);
      const signUp = page.waitForResponse((r) =>
        r.url().includes("/api/auth/sign-up/email"),
      );
      await page.getByRole("button", { name: "Create free account" }).click();
      expect((await signUp).status()).toBe(200);
      await expect(page.getByText("Check your inbox")).toBeVisible();

      const [user] =
        await sql`SELECT id, brand, "emailVerified" FROM "user" WHERE email = ${EMAIL}`;
      expect(user).toMatchObject({ brand: "timewren", emailVerified: false });

      // Bekræftelsesmailen: TimeWren-afsender og links til timewren.com.
      const { mail, url } = await waitForLink(EMAIL, "/api/auth/verify-email");
      expect(mail.from).toMatch(/TimeWren/);
      expect(mail.from).toMatch(/@timewren\.com/);
      expect(url).toMatch(
        /^https:\/\/timewren\.com\/api\/auth\/verify-email\?/,
      );
      expect(mail.html).not.toMatch(/timetrack\.dk/i);
      expect(mail.html).not.toMatch(/TimeTrack/);

      await page.goto(url);
      await expect(page).toHaveURL(/^https:\/\/timewren\.com\/dashboard/);
      await expect(
        page.getByRole("heading", { name: /Welcome to TimeWren/ }),
      ).toBeVisible();
      await expectNoTimeTrack(page);

      // Onboarding gav Gratis uden prøveperiode, og org'en er TimeWrens.
      await expect
        .poll(
          async () =>
            (
              await sql`SELECT s.status, s.plan_tier, s.is_trial, o.brand AS org_brand
              FROM subscriptions s JOIN organizations o ON o.id = s.organization_id
              WHERE s.user_id = ${user.id}`
            )[0],
          { timeout: 20_000 },
        )
        .toMatchObject({
          status: "free",
          plan_tier: "free",
          is_trial: false,
          org_brand: "timewren",
        });
      // Onboardingen afsluttes i baggrunden lige efter abonnementet.
      await expect
        .poll(
          async () =>
            (
              await sql`SELECT onboarding_completed, locale FROM "user" WHERE id = ${user.id}`
            )[0],
          { timeout: 20_000 },
        )
        .toEqual({ onboarding_completed: true, locale: "en" });

      // Betaling og Google Calendar: "kommer snart", ingen checkout.
      await page.goto("/dashboard/settings/subscription");
      await expect(page.getByText("Payments are coming soon")).toBeVisible();
      await expectNoTimeTrack(page);
      await page.goto("/dashboard/settings/integrations");
      await expect(
        page.getByText("Google Calendar is coming soon"),
      ).toBeVisible();
      await expectNoTimeTrack(page);

      // Sikkerhed: ingen "Forbind"-knapper til sociale konti; passkey kan tilføjes.
      await addVirtualAuthenticator(page);
      await page.goto("/dashboard/settings/security");
      await expect(
        page.getByRole("button", { name: /Connect|Forbind/ }),
      ).toHaveCount(0);
      await page.getByRole("button", { name: "Add passkey" }).click();
      await expect(page.getByText("Passkey registered")).toBeVisible();
      const passkeys =
        await sql`SELECT id FROM passkey WHERE "userId" = ${user.id}`;
      expect(passkeys).toHaveLength(1);

      // Log ud og ind igen med passkey (samme virtuelle authenticator).
      await context.clearCookies();
      await isolate(context);
      await page.goto("/login");
      await expectNoSocialButtons(page);
      await page.getByRole("button", { name: "Passkey" }).click();
      await expect(page).toHaveURL(/^https:\/\/timewren\.com\/dashboard/);
    });

    test("magic link fra timewren.com logger ind", async ({
      page,
      context,
    }) => {
      await isolate(context);
      await page.goto("/login");
      await expectNoSocialButtons(page);
      const before = mailsTo(EMAIL).length;
      await page.getByRole("button", { name: "Email link" }).click();
      await page.fill("#magic-email", EMAIL);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await expect
        .poll(() => mailsTo(EMAIL).length, { timeout: 30_000 })
        .toBeGreaterThan(before);
      const { mail, url } = await waitForLink(
        EMAIL,
        "/api/auth/magic-link/verify",
      );
      expect(mail.from).toMatch(/@timewren\.com/);
      expect(url).toMatch(
        /^https:\/\/timewren\.com\/api\/auth\/magic-link\/verify\?/,
      );
      await page.goto(url);
      await expect(page).toHaveURL(/^https:\/\/timewren\.com\/dashboard/);
    });

    test("app-siderne nævner ikke TimeTrack", async ({ page, context }) => {
      await isolate(context);
      await page.goto("/login");
      await expectNoTimeTrack(page);
      await page.goto("/auth/forgot-password");
      await expectNoTimeTrack(page);

      // Log ind med magic link og gå appens hovedsider igennem.
      const before = mailsTo(EMAIL).length;
      await page.goto("/login");
      await page.getByRole("button", { name: "Email link" }).click();
      await page.fill("#magic-email", EMAIL);
      await page.getByRole("button", { name: "Send sign-in link" }).click();
      await expect
        .poll(() => mailsTo(EMAIL).length, { timeout: 30_000 })
        .toBeGreaterThan(before);
      const { url } = await waitForLink(EMAIL, "/api/auth/magic-link/verify");
      await page.goto(url);
      await expect(page).toHaveURL(/^https:\/\/timewren\.com\/dashboard/);

      for (const path of [
        "/dashboard",
        "/dashboard/overblik",
        "/dashboard/time",
        "/dashboard/clients",
        "/dashboard/projects",
        "/dashboard/klippekort",
        "/dashboard/invoices",
        "/dashboard/reports",
        "/dashboard/tasks",
        "/dashboard/help",
        "/dashboard/integrations",
        "/dashboard/settings",
        "/dashboard/settings/notifications",
        "/dashboard/settings/api",
        "/dashboard/settings/ai",
        "/dashboard/settings/data",
        "/dashboard/settings/desktop",
        "/dashboard/settings/integrations",
        "/dashboard/settings/subscription",
        "/dashboard/settings/security",
      ]) {
        await page.goto(path);
        await expectNoTimeTrack(page);
      }

      // Manifest og runtime-config: TimeWren.
      const manifest = JSON.parse(
        (await browserFetch(page, "/manifest.json")).text,
      );
      expect(manifest.short_name).toBe("TimeWren");
      expect((await browserFetch(page, "/runtime-config.js")).text).toContain(
        '"hostBrand":"timewren"',
      );
    });

    test("OAuth-endpoints kender ikke udbyderne på timewren.com", async ({
      page,
      context,
    }) => {
      await isolate(context);
      await page.goto("/login");
      const res = await browserFetch(page, "/api/auth/sign-in/social", {
        method: "POST",
        body: { provider: "google", callbackURL: "/dashboard" },
      });
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.text).not.toMatch(/accounts\.google\.com/);
    });
  });
