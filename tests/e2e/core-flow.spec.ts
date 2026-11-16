import { CONSENT_STATE } from "./consent";
import {
  expect,
  generateUniqueName,
  pickComboboxOption,
  TEST_PASSWORD,
  test,
} from "./helpers";

/**
 * Kerneflowet for en ny freelancer: kunde → projekt → tidsregistrering → ses
 * i listen. Kører som brugeren fra auth.setup.ts (onboardet, trial).
 */
test.describe("Kerneflow", () => {
  test("opret kunde, projekt og tidspostering og se den i listen", async ({
    page,
  }) => {
    const clientName = generateUniqueName("Kunde");
    const projectName = generateUniqueName("Projekt");
    const description = generateUniqueName("Arbejde");

    // Kunde
    await page.goto("/dashboard/clients/new");
    await page.getByLabel("Navn *").fill(clientName);
    await page.getByLabel("Email").fill("kontakt@example.dk");
    await page.getByLabel("Standard Timepris (kr)").fill("850");
    await page.getByRole("button", { name: "Gem kunde" }).click();
    await expect(page).not.toHaveURL(/\/clients\/new/);

    await page.goto("/dashboard/clients");
    await expect(page.getByText(clientName).first()).toBeVisible();

    // Projekt
    await page.goto("/dashboard/projects/new");
    await pickComboboxOption(page, "Vælg kunde", clientName);
    await page.getByLabel("Projektnavn *").fill(projectName);
    await page.getByLabel("Timepris (kr)").fill("900");
    await page.getByRole("button", { name: "Gem Projekt" }).click();
    await expect(page).not.toHaveURL(/\/projects\/new/);

    await page.goto("/dashboard/projects");
    await expect(page.getByText(projectName).first()).toBeVisible();

    // Tidspostering
    await page.goto("/dashboard/time/new");
    await pickComboboxOption(page, "Vælg kunde", clientName);
    // Kundens eneste aktive projekt vælges automatisk.
    await expect(
      page.getByRole("combobox").filter({ hasText: projectName }),
    ).toBeVisible();
    await page.getByLabel("Beskrivelse *").fill(description);
    await page.getByLabel("Timer *").fill("2.5");
    await page.getByRole("button", { name: "Gem post" }).click();
    await expect(page).not.toHaveURL(/\/time\/new/);

    await page.goto("/dashboard/time");
    await expect(page.getByText(description).first()).toBeVisible();
  });
});

test.describe("Beskyttede ruter", () => {
  test.use({ storageState: CONSENT_STATE });

  test("uden session sendes /dashboard til login", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.getByRole("heading", { name: "Log ind på din konto" }),
    ).toBeVisible();
  });

  test("forkert adgangskode giver fejl og ingen session", async ({ page }) => {
    await page.goto("/login");
    await page.fill("#email", "findes-ikke@example.dk");
    const wrongPassword = `${TEST_PASSWORD}-x`; // bevidst forkert (test)
    await page.fill("#password", wrongPassword);
    await page.getByRole("button", { name: "Log ind", exact: true }).click();
    await expect(page).toHaveURL(/\/login/);
    await expect(
      page.locator(".text-red-800, .text-red-600").first(),
    ).toBeVisible();
  });
});
