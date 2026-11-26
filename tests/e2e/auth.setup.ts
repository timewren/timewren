import { writeFile } from "node:fs/promises";
import { db, expect, test as setup, signUpAndOnboard } from "./helpers";

/**
 * Opretter én frisk bruger gennem den rigtige signup-flow (registrér →
 * bekræft e-mail → log ind → onboarding/trial → tour afvist) og gemmer
 * sessionen, så kernetestene starter logget ind uden at logge ind igen.
 */
setup("opret og onboard testbruger", async ({ page }, testInfo) => {
  const authDir = testInfo.config.metadata.authDir as string;
  const email = await signUpAndOnboard(page, "E2E Kerne");
  const response = await page.request.get("/api/auth/get-session");
  expect(response.ok()).toBe(true);
  const { user, session } = await response.json();
  expect(user.role).toBe("user");
  const rows = await db()`
    SELECT u.role, s."activeOrganizationId" IS NULL AS no_active_org
    FROM session s JOIN "user" u ON u.id = s."userId"
    WHERE s.id = ${session.id} AND u.id = ${user.id}
  `;
  expect([...rows]).toEqual([{ role: "user", no_active_org: true }]);
  await page.context().storageState({ path: `${authDir}/user.json` });
  await writeFile(`${authDir}/account`, email);
});
