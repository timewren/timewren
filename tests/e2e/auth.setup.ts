import { test as setup, signUpAndOnboard } from "./helpers";

export const AUTH_FILE = "tests/e2e/.auth/user.json";

/**
 * Opretter én frisk bruger gennem den rigtige signup-flow (registrér →
 * bekræft e-mail → log ind → onboarding/trial → tour afvist) og gemmer
 * sessionen, så kernetestene starter logget ind uden at logge ind igen.
 */
setup("opret og onboard testbruger", async ({ page }) => {
  await signUpAndOnboard(page, "E2E Kerne");
  await page.context().storageState({ path: AUTH_FILE });
});
