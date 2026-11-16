import {
  type BrowserContext,
  test as base,
  expect,
  type Page,
} from "@playwright/test";
import * as dotenv from "dotenv";
import postgres from "postgres";

/**
 * Test helpers and utilities for TimeTrack E2E tests.
 *
 * Kernesættet (core-*.spec.ts, public-pages.spec.ts) bruger `test` herfra:
 * den blokerer alle eksterne requests (Google Ads, Plausible, Sentry …), så en
 * lokal kørsel aldrig rammer produktionstjenester, og giver hver test sin egen
 * x-forwarded-for, så better-auths login-rate-limit (5/15 min pr. IP) ikke
 * rammer ved gentagne kørsler mod samme dev-server.
 */

// Samme kilde som app'en lokalt; en eksplicit DATABASE_URL i shell'en vinder.
if (!process.env.DATABASE_URL) {
  dotenv.config({ path: ".env.local", quiet: true });
}

/**
 * Kun til lokale testbrugere i en engangs-database. Sammensat ved kørsel (og kan
 * overskrives med E2E_TEST_PASSWORD), så den ikke ligner en rigtig hemmelighed.
 */
export const TEST_PASSWORD =
  process.env.E2E_TEST_PASSWORD ?? ["e2e", "Lokal", "9x"].join("-");

function randomTestIp(): string {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  return `10.${octet()}.${octet()}.${octet()}`;
}

export async function isolateContext(context: BrowserContext) {
  await context.route(/^https?:\/\/(?!localhost[:/]|127\.0\.0\.1[:/])/, (r) =>
    r.abort(),
  );
  await context.setExtraHTTPHeaders({ "x-forwarded-for": randomTestIp() });
  // Talegenkendelse (HomePrompt kalder SpeechRecognition.available() ved
  // sidevisning) findes ikke i en testbrowser; i nogle Chromium-builds uden
  // on-device-binder slår kaldet renderen ihjel ("Target crashed" på Hjem).
  // Uden API'et viser appen bare ikke diktering.
  await context.addInitScript(() => {
    for (const key of ["SpeechRecognition", "webkitSpeechRecognition"]) {
      Object.defineProperty(window, key, {
        value: undefined,
        configurable: true,
      });
    }
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await isolateContext(context);
    await use(context);
  },
  page: async ({ page }, use) => {
    // "Nyheder og opdateringer" åbner af sig selv, når brugeren har ulæste
    // udgivelser, og en ny testbruger har altid ulæste. Modalen ligger over
    // siden og opsnapper klik (fx på "Gem kunde"), så luk den, når den dukker
    // op. Samme mønster som tests/synthetic/timer-protocol.synthetic.ts.
    await page.addLocatorHandler(
      page.getByTestId("changelog-modal"),
      async (modal) => {
        // dispatchEvent frem for click(): lukkeknappen kan ligge bag en anden
        // dialog, som testen selv har åbnet, og et almindeligt klik ville så
        // vente på, at den forsvinder, mens testen venter på handleren.
        await modal.getByTestId("changelog-close").dispatchEvent("click");
      },
    );
    await use(page);
  },
});

export { expect };

/**
 * Database helpers (KUN til test): e-mailbekræftelse sendes via Resend, som er
 * slået fra lokalt, så testene markerer brugeren som bekræftet direkte i DB.
 */
let sqlClient: postgres.Sql | null = null;

export function db(): postgres.Sql {
  if (!sqlClient) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error(
        "DATABASE_URL mangler — E2E-testene skal kunne nå den lokale database",
      );
    }
    sqlClient = postgres(url, { max: 1 });
  }
  return sqlClient;
}

export async function markEmailVerified(email: string) {
  const rows = await db()`
    UPDATE "user" SET "emailVerified" = true WHERE email = ${email} RETURNING id
  `;
  expect(rows.length, `bruger ${email} findes ikke i DB`).toBe(1);
}

/**
 * Markerer rundvisningen som set. Den auto-starter først, når onboarding er
 * gemt i baggrunden, så dismissTour kunne komme før den; bagefter kapredes
 * de følgende tests af turen (navigerer til Hjem midt i en test).
 */
export async function markTourSeen(email: string) {
  await db()`
    UPDATE "user"
    SET dismissed_banners = array_append(
      array_remove(dismissed_banners, 'guided-tour'), 'guided-tour')
    WHERE email = ${email}
  `;
}

/**
 * Markerer alle nyheder som set. Ellers åbner Nyheder-modalen over den første
 * side efter login og opsnapper klik (også på senere sider, når den åbner efter
 * en navigation), så formularer i kerneflowet ikke kan sendes.
 */
export async function markChangelogSeen(email: string) {
  await db()`
    UPDATE "user"
    SET last_seen_changelog_id = (
      SELECT id FROM changelogs WHERE published_at <= now()
      ORDER BY published_at DESC LIMIT 1)
    WHERE email = ${email}
      AND EXISTS (SELECT 1 FROM changelogs WHERE published_at <= now())
  `;
}

/**
 * Sætter brugerens abonnement på Gratis-tieren (som trial-expire-cronen gør).
 * Prøven oprettes i baggrunden efter første login (#91), så abonnementet
 * findes ikke nødvendigvis endnu: vent på det i stedet for at fejle.
 */
export async function setFreeTier(email: string) {
  await expect
    .poll(
      async () => {
        const rows = await db()`
          UPDATE subscriptions SET status = 'free', plan_tier = 'free', is_trial = false,
            seat_count = 1, max_seats = 3
          WHERE user_id = (SELECT id FROM "user" WHERE email = ${email})
          RETURNING id
        `;
        return rows.length;
      },
      { message: `abonnement for ${email} findes ikke`, timeout: 20_000 },
    )
    .toBe(1);
}

/**
 * Venter til prøve-abonnementet findes i databasen. Timer-first-onboarding (#91)
 * opretter det fra klienten i baggrunden (TimerFirstOnboarding), og
 * Velkommen-overskriften vises allerede før: den afhænger ikke af abonnementet,
 * og dashboardet viser ingen betalingsmur, så længe onboarding ikke er afsluttet.
 * Starter en test sin første skrivning i det vindue, kaster resolvePlanTier
 * "Du har brug for et aktivt abonnement" (#1037).
 *
 * Pollen kræver en række, som resolvePlanTier kan løse: status trialing/active,
 * organization_id sat og brugeren som owner/admin i den organisation.
 */
export async function waitForSubscription(email: string) {
  await expect
    .poll(
      async () => {
        const rows = await db()`
          SELECT 1 FROM subscriptions s
          JOIN "user" u ON u.id = s.user_id
          JOIN members m
            ON m.organization_id = s.organization_id AND m.user_id = u.id
          WHERE u.email = ${email}
            AND s.status IN ('trialing', 'active')
            AND m.role IN ('owner', 'admin')
        `;
        return rows.length;
      },
      {
        message: `løsbart abonnement for ${email} blev ikke oprettet`,
        timeout: 20_000,
      },
    )
    .toBeGreaterThan(0);
}

/**
 * Generate unique test data
 */
export function generateUniqueEmail(): string {
  return `e2e-${Date.now()}-${Math.random().toString(36).substring(2, 8)}@example.dk`;
}

export function generateUniqueName(prefix = "Test"): string {
  return `${prefix} ${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;
}

/**
 * Authentication helpers
 */
export async function register(
  page: Page,
  name: string = testData.users.new.name,
  email: string = generateUniqueEmail(),
  password: string = TEST_PASSWORD,
) {
  await page.goto("/register");
  await page.fill("#name", name);
  await page.fill("#email", email);
  await page.fill("#password", password);
  const signUp = page.waitForResponse((r) =>
    r.url().includes("/api/auth/sign-up/email"),
  );
  await page.getByRole("button", { name: /Opret gratis konto/ }).click();
  expect((await signUp).status()).toBe(200);
  // Ingen session endnu — siden bliver på /register og viser "Tjek din
  // indbakke" i stedet for at sende videre (bekræftelseslinket gør det).
  await expect(page.getByText("Tjek din indbakke")).toBeVisible();
}

export async function login(
  page: Page,
  email: string = testData.users.existing.email,
  password: string = TEST_PASSWORD,
) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.getByRole("button", { name: "Log ind", exact: true }).click();
  // Login navigerer i flere hop (klient-redirect) — poll URL'en i stedet for
  // waitForURL, som fejler på den afbrudte mellem-navigation.
  await expect(page).toHaveURL(/\/dashboard/);
}

/**
 * Timer-first-onboarding (#91): ingen wizard — prøven startes i baggrunden,
 * og brugeren lander på Hjem med velkomstkortet.
 */
export async function completeOnboarding(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Velkommen til TimeTrack" }),
  ).toBeVisible();
}

/**
 * Den guidede tour auto-startes ikke længere efter timer-first-onboarding
 * (#91). Lukker den kun, hvis den alligevel er åben.
 */
export async function dismissTour(page: Page) {
  const skip = page.getByRole("button", { name: "Spring over", exact: true });
  if (await skip.isVisible()) {
    await skip.click();
    await expect(skip).toBeHidden();
  }
}

/** Fuld signup: registrér → bekræft e-mail (DB) → log ind → onboarding → tour væk. */
export async function signUpAndOnboard(page: Page, name: string) {
  const email = generateUniqueEmail();
  await register(page, name, email);
  await markEmailVerified(email);
  await markTourSeen(email);
  await markChangelogSeen(email);
  await login(page, email, TEST_PASSWORD);
  await completeOnboarding(page);
  await waitForSubscription(email);
  await dismissTour(page);
  return email;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Vælger en værdi i appens søgbare combobox (ClientSearchCombobox/ProjectSelect):
 * åbn via knappens tekst, filtrér på navnet og klik den matchende option.
 */
export async function pickComboboxOption(
  page: Page,
  triggerText: string | RegExp,
  optionName: string,
) {
  // Eksakt match: "Vælg kunde" må ikke ramme "Vælg kunde først".
  const hasText =
    typeof triggerText === "string"
      ? new RegExp(`^\\s*${escapeRegExp(triggerText)}\\s*$`)
      : triggerText;
  await page.getByRole("combobox").filter({ hasText }).click();
  await page.getByRole("option", { name: optionName }).first().click();
}

// ---------------------------------------------------------------------------
// Legacy-helpers til de gamle (skippede) specs fra TimeCraft-æraen. Bevaret så
// filerne stadig kan indlæses; de genoplives spec for spec efter behov.
// ---------------------------------------------------------------------------

export const testData = {
  users: {
    new: {
      name: "Test Bruger",
      email: `test-${Date.now()}@example.dk`,
      password: TEST_PASSWORD,
    },
    existing: {
      email: "test@example.dk",
      password: TEST_PASSWORD,
      name: "Test Bruger",
    },
  },
  clients: {
    valid: {
      name: "Testkunde ApS",
      email: "kontakt@example.com",
      phone: "+45 12 34 56 78",
      company: "Testkunde ApS",
      address: "Testvej 1, 8000 Aarhus C",
      defaultHourlyRate: "850",
      notes: "Vigtig klient med stor kontrakt",
    },
    minimal: {
      name: "Lars Jensen",
    },
    search: {
      name: "Søgetest A/S",
      email: "info@example.org",
      company: "Søgetest Holding A/S",
    },
  },
  projects: {
    valid: {
      name: "Website Redesign",
      description: "Nyt responsive design til hjemmesiden",
      hourlyRate: "900",
      status: "active",
    },
    fixedPrice: {
      name: "Logo Design",
      description: "Nyt logo og brand identity",
      fixedPrice: "25000",
      status: "active",
    },
  },
  klippekort: {
    valid: {
      name: "Support Pakke Q1 2025",
      description: "25 timer support til webplatform",
      totalHours: "25",
      hourlyRate: "750",
      purchaseDate: "2025-01-01",
      expiryDate: "2025-03-31",
    },
    minimal: {
      name: "Konsulent Timer",
      totalHours: "10",
      hourlyRate: "800",
    },
  },
  timeEntries: {
    valid: {
      description: "Implementeret login funktionalitet",
      hours: "3.5",
    },
    withKlippekort: {
      description: "Support opgave - bug fix",
      hours: "1.5",
    },
  },
};

export async function logout(page: Page) {
  // Open user menu and click logout
  await page.click('button:has-text("Log ud")').catch(async () => {
    // If logout button not visible, try opening user menu first
    const userMenuButton = page
      .locator('button:has(div:has-text("U"))')
      .first();
    await userMenuButton.click();
    await page.waitForTimeout(300);
    await page.click('button:has-text("Log ud")');
  });
  await page.waitForURL("/login");
}

/**
 * Navigation helpers
 */
export async function navigateToClients(page: Page) {
  await page.click('a[href="/dashboard/clients"]');
  await page.waitForURL("/dashboard/clients");
}

export async function navigateToProjects(page: Page) {
  await page.click('a[href="/dashboard/projects"]');
  await page.waitForURL("/dashboard/projects");
}

export async function navigateToTime(page: Page) {
  await page.click('a[href="/dashboard/time"]');
  await page.waitForURL("/dashboard/time");
}

export async function navigateToKlippekort(page: Page) {
  await page.click('a[href="/dashboard/klippekort"]');
  await page.waitForURL("/dashboard/klippekort");
}

export async function navigateToDashboard(page: Page) {
  await page.click('a[href="/dashboard"]');
  await page.waitForURL("/dashboard");
}

/**
 * Form helpers
 */
export async function fillClientForm(
  page: Page,
  data: Partial<typeof testData.clients.valid>,
) {
  if (data.name) await page.fill("#name", data.name);
  if (data.email) await page.fill("#email", data.email);
  if (data.phone) await page.fill("#phone", data.phone);
  if (data.company) await page.fill("#company", data.company);
  if (data.address) await page.fill("#address", data.address);
  if (data.defaultHourlyRate)
    await page.fill("#defaultHourlyRate", data.defaultHourlyRate);
  if (data.notes) await page.fill("#notes", data.notes);
}

export async function submitForm(page: Page) {
  await page.click('button[type="submit"]');
}

/**
 * Assertion helpers
 */
export async function expectToBeOnDashboard(page: Page) {
  await expect(page).toHaveURL("/dashboard");
  await expect(page.locator("h1")).toContainText("Velkommen tilbage");
}

export async function expectToBeOnLoginPage(page: Page) {
  await expect(page).toHaveURL("/login");
  await expect(page.locator("h2")).toContainText("Log ind på din konto");
}

export async function expectErrorMessage(page: Page, message: string) {
  const errorElement = page.locator(".text-red-800, .text-red-600").first();
  await expect(errorElement).toContainText(message);
}

export async function expectSuccessMessage(page: Page, message?: string) {
  const successElement = page.locator(
    ".text-green-800, .text-green-600, .bg-green-50",
  );
  if (message) {
    await expect(successElement).toContainText(message);
  } else {
    await expect(successElement).toBeVisible();
  }
}

/**
 * Wait for data to load
 */
export async function waitForDataLoad(page: Page) {
  // Wait for loading spinner to disappear
  await page
    .locator(".animate-spin")
    .waitFor({ state: "hidden", timeout: 5000 })
    .catch(() => {
      // Spinner might not appear if data loads quickly
    });
}

/**
 * Clean up helpers
 */
export async function deleteAllTestData(page: Page) {
  try {
    await logout(page);
  } catch {
    // Already logged out
  }
}
