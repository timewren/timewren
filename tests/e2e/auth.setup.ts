import { writeFile } from "node:fs/promises";
import { test as setup, signUpAndOnboard } from "./helpers";

/**
 * Opretter én frisk bruger gennem den rigtige signup-flow (registrér →
 * bekræft e-mail → log ind → onboarding/trial → tour afvist) og gemmer
 * sessionen, så kernetestene starter logget ind uden at logge ind igen.
 */
setup("opret og onboard testbruger", async ({ page }, testInfo) => {
  const authDir = testInfo.config.metadata.authDir as string;
  const email = await signUpAndOnboard(page, "E2E Kerne");
  await page.context().storageState({ path: `${authDir}/user.json` });
  await writeFile(`${authDir}/account`, email);
});
