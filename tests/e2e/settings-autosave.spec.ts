import type { Page } from "@playwright/test";
import { CONSENT_STATE } from "./consent";
import { dismissTour, expect, signUpAndOnboard, test } from "./helpers";

/**
 * Indstillinger gemmer selv (ingen Gem-knap). Egen bruger, så afrunding
 * og timepris ikke påvirker de andre specs, der deler kernebrugeren.
 */
test.describe("Indstillinger gemmer selv", () => {
  test.use({ storageState: CONSENT_STATE });

  async function openProfile(page: Page) {
    // Rundvisningen for nye brugere dukker op lidt efter login og sender
    // tilbage til Hjem; luk den, før indstillingerne åbnes.
    const skip = page.getByRole("button", { name: "Spring over", exact: true });
    await skip.waitFor({ timeout: 10_000 }).catch(() => {});
    await dismissTour(page);
    await page.goto("/dashboard/settings");
    await expect(page.locator("#hourlyRate")).toBeVisible();
  }

  const status = (page: Page, cardId: string) =>
    page.locator(`#${cardId} [data-testid="autosave-status"]`);

  test("timepris, afrunding og et toggle er gemt efter genindlæsning", async ({
    page,
  }) => {
    await signUpAndOnboard(page, "E2E Autogem");
    await openProfile(page);
    await expect(
      page.getByRole("button", { name: "Gem ændringer" }),
    ).toHaveCount(0);

    // Tekstfelt: gemmes efter pausen, uden at der trykkes på noget
    await page.locator("#hourlyRate").fill("875");
    await expect(status(page, "profil")).toHaveAttribute(
      "data-status",
      "saved",
    );
    await expect(status(page, "profil")).toContainText("Gemt");

    // Toggle og selects: gemmes med det samme
    await page.getByLabel("Afrund tidsregistreringer").check();
    await page.locator("#roundingMinutes").selectOption("30");
    await page.locator("#roundingMethod").selectOption("nearest");
    await expect(status(page, "afrunding")).toHaveAttribute(
      "data-status",
      "saved",
    );
    await page.getByLabel("Skjul beløb på klippekort").check();
    await expect(status(page, "klippekort")).toHaveAttribute(
      "data-status",
      "saved",
    );

    // "Gemt" forsvinder igen
    await expect(status(page, "klippekort")).toHaveAttribute(
      "data-status",
      "idle",
      { timeout: 5000 },
    );

    await page.reload();
    // Databasen gemmer beløbet som numeric(…, 2)
    await expect(page.locator("#hourlyRate")).toHaveValue(/^875(\.00)?$/);
    await expect(page.getByLabel("Afrund tidsregistreringer")).toBeChecked();
    await expect(page.locator("#roundingMinutes")).toHaveValue("30");
    await expect(page.locator("#roundingMethod")).toHaveValue("nearest");
    await expect(page.getByLabel("Skjul beløb på klippekort")).toBeChecked();
  });

  test("et ugyldigt felt viser fejlen og gemmes ikke", async ({ page }) => {
    await signUpAndOnboard(page, "E2E Autogem ugyldig");
    await openProfile(page);
    const name = page.locator("#name");
    await name.fill("A");
    await name.blur();
    await expect(page.getByText("Navn skal være mindst 2 tegn")).toBeVisible();

    await page.reload();
    await expect(page.locator("#name")).toHaveValue("E2E Autogem ugyldig");
  });

  test("fejler gemningen, ruller feltet tilbage med Prøv igen", async ({
    page,
  }) => {
    await signUpAndOnboard(page, "E2E Autogem fejl");
    await openProfile(page);
    const toggle = page.getByLabel("Skjul beløb på klippekort");
    await expect(toggle).not.toBeChecked();

    // updateProfile svarer 500, til testen slipper igen
    let fail = true;
    await page.route(/\/api\/trpc\/[^?]*user\.updateProfile/, (route) =>
      fail
        ? route.fulfill({
            status: 500,
            contentType: "application/json",
            body: JSON.stringify([
              {
                error: {
                  json: {
                    message: "Serveren er nede",
                    code: -32603,
                    data: { code: "INTERNAL_SERVER_ERROR", httpStatus: 500 },
                  },
                },
              },
            ]),
          })
        : route.continue(),
    );

    await toggle.check();
    await expect(status(page, "klippekort")).toHaveAttribute(
      "data-status",
      "error",
    );
    await expect(toggle).not.toBeChecked();
    await expect(status(page, "klippekort")).toContainText("Kunne ikke gemme");

    // "Prøv igen" sender ændringen igen, når serveren svarer
    fail = false;
    await status(page, "klippekort")
      .getByRole("button", { name: "Prøv igen" })
      .click();
    await expect(status(page, "klippekort")).toHaveAttribute(
      "data-status",
      "saved",
    );
    await expect(toggle).toBeChecked();

    await page.reload();
    await expect(page.getByLabel("Skjul beløb på klippekort")).toBeChecked();
  });

  test("virksomhedsprofilen viser, hvorfor intet gemmes, når navnet mangler", async ({
    page,
  }) => {
    await signUpAndOnboard(page, "E2E Autogem firma");
    const skip = page.getByRole("button", { name: "Spring over", exact: true });
    await skip.waitFor({ timeout: 10_000 }).catch(() => {});
    await dismissTour(page);
    await page.goto("/dashboard/settings/company");
    const phone = page.locator("#companyPhone");
    await expect(phone).toBeEnabled();

    // Ny bruger uden virksomhedsprofil: navnet er tomt og påkrævet
    await phone.fill("+45 12 34 56 78");
    await phone.blur();
    await expect(
      page.getByText("Virksomhedsnavn skal være mindst 2 tegn"),
    ).toBeVisible();
    await expect(
      page
        .locator('[data-testid="autosave-status"][data-status="blocked"]')
        .first(),
    ).toContainText("Ikke gemt");

    // Når navnet er rettet, gemmes det hele samlet
    await page.locator("#companyName").fill("Autogem ApS");
    await page.locator("#companyName").blur();
    await expect(
      page
        .locator('[data-testid="autosave-status"][data-status="saved"]')
        .first(),
    ).toBeVisible();
    await page.reload();
    await expect(page.locator("#companyName")).toHaveValue("Autogem ApS");
    await expect(page.locator("#companyPhone")).toHaveValue("+45 12 34 56 78");
  });
});
