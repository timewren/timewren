import { CONSENT_STATE } from "./consent";
import {
  expect,
  generateUniqueName,
  setFreeTier,
  signUpAndOnboard,
  test,
} from "./helpers";

/**
 * Gratis-tieren har plads til 3 aktive kunder. Den 4. blokeres med en rolig
 * inline-note (ingen modal) — og serveren afviser oprettelsen.
 */
test.describe("Gratis-grænse", () => {
  // Egen bruger: nedgraderingen til Gratis må ikke ramme kernetestenes bruger.
  test.use({ storageState: CONSENT_STATE });

  test("4. aktive kunde blokeres med rolig note", async ({ page }) => {
    const email = await signUpAndOnboard(page, "E2E Gratis");
    await setFreeTier(email);

    for (let i = 1; i <= 3; i++) {
      await page.goto("/dashboard/clients/new");
      await page.getByLabel("Navn *").fill(generateUniqueName(`Gratis ${i}`));
      await page.getByRole("button", { name: "Gem kunde" }).click();
      await expect(page).not.toHaveURL(/\/clients\/new/);
    }

    await page.goto("/dashboard/clients");
    await expect(
      page.getByText("Gratis har plads til 3 aktive kunder", { exact: false }),
    ).toBeVisible();

    // Direkte forsøg på den 4. afvises af serveren med samme besked.
    await page.goto("/dashboard/clients/new");
    await page.getByLabel("Navn *").fill(generateUniqueName("Gratis 4"));
    await page.getByRole("button", { name: "Gem kunde" }).click();
    await expect(
      page.getByText(/Gratis har plads til 3 aktive kunder/).first(),
    ).toBeVisible();
    await expect(page).toHaveURL(/\/clients\/new/);
  });
});
