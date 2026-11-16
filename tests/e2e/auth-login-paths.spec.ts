import { createHmac } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  expect,
  generateUniqueEmail,
  login,
  markEmailVerified,
  register,
  TEST_PASSWORD,
  test,
} from "./helpers";

/**
 * Røgtest af login-vejene efter better-auth 1.7 (#624). Magic link kræver at
 * dev-serveren sender mails til en lokal Resend-mock (RESEND_BASE_URL), der
 * lægger hver mail som JSON i E2E_MAIL_DIR. Microsoft/Google kræver
 * MICROSOFT_/GOOGLE_CLIENT_ID+SECRET (dummy-værdier er nok) — de tests
 * følger kun redirecten til udbyderen, som isolateContext afbryder.
 */

// Ingen gemt session: hver test logger selv ind.
test.use({ storageState: { cookies: [], origins: [] } });

const MAIL_DIR = process.env.E2E_MAIL_DIR;

async function findMagicLink(to: string): Promise<string> {
  if (!MAIL_DIR) throw new Error("E2E_MAIL_DIR mangler");
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    for (const file of await readdir(MAIL_DIR)) {
      const mail = JSON.parse(await readFile(join(MAIL_DIR, file), "utf8")) as {
        to: string | string[];
        subject: string;
        html: string;
      };
      const recipients = Array.isArray(mail.to) ? mail.to : [mail.to];
      if (!recipients.includes(to) || mail.subject !== "Log ind på TimeTrack") {
        continue;
      }
      const match = mail.html.match(
        /href="([^"]*\/api\/auth\/magic-link\/verify[^"]*)"/,
      );
      if (match) return match[1].replaceAll("&amp;", "&");
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Ingen magic link-mail til ${to}`);
}

/** RFC 6238-kode (SHA-1, 6 cifre, 30 s) ud fra base32-secret'en i totpURI. */
async function totpCode(secret: string): Promise<string> {
  // Undgå at koden udløber mellem beregning og indsendelse.
  const left = 30 - (Math.floor(Date.now() / 1000) % 30);
  if (left < 4) await new Promise((r) => setTimeout(r, left * 1000 + 200));
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const c of secret.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(c).toString(2).padStart(5, "0");
  }
  const key = Buffer.from(
    (bits.match(/.{8}/g) ?? []).map((b) => Number.parseInt(b, 2)),
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 1000 / 30)));
  const hmac = createHmac("sha1", key).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 0xf;
  const value = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return value.toString().padStart(6, "0");
}

async function registeredUser(page: Parameters<typeof register>[0]) {
  const email = generateUniqueEmail();
  await register(page, "Login Røgtest", email);
  await markEmailVerified(email);
  return email;
}

test.describe("Login-veje (better-auth 1.7)", () => {
  test("e-mail og adgangskode", async ({ page }) => {
    const email = await registeredUser(page);
    await login(page, email);
    await expect(page).toHaveURL(/\/dashboard/);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json())?.user?.email).toBe(email);
  });

  test("magic link", async ({ page }) => {
    test.skip(!MAIL_DIR, "kræver Resend-mock (E2E_MAIL_DIR)");
    const email = await registeredUser(page);
    await page.context().clearCookies();
    await page.goto("/login");
    await page.getByRole("button", { name: "Link på e-mail" }).click();
    await page.fill("#magic-email", email);
    const sent = page.waitForResponse((r) =>
      r.url().includes("/api/auth/sign-in/magic-link"),
    );
    await page.getByRole("button", { name: "Send login link" }).click();
    expect((await sent).status()).toBe(200);

    const link = await findMagicLink(email);
    // Verify-endpointet redirecter, og dashboardet sender videre på
    // klienten — vent kun på svaret og poll URL'en (som login-helperen).
    await page.goto(link, { waitUntil: "commit" });
    await expect(page).toHaveURL(/\/dashboard/);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json())?.user?.email).toBe(email);

    // Engangslink: genbrug giver ingen ny session.
    await page.context().clearCookies();
    await page.goto(link, { waitUntil: "commit" });
    await expect(page).not.toHaveURL(/\/dashboard/);
    const after = await page.request.get("/api/auth/get-session");
    expect(await after.json()).toBeNull();
  });

  test("2FA: aktivér med TOTP og log ind med kode", async ({ page }) => {
    const email = await registeredUser(page);
    await login(page, email);

    await page.goto("/dashboard/settings/security");
    await page.getByRole("button", { name: "Aktiver 2FA" }).click();
    await page.getByPlaceholder("Din adgangskode").fill(TEST_PASSWORD);
    const enabled = page.waitForResponse((r) =>
      r.url().includes("/api/auth/two-factor/enable"),
    );
    await page.getByRole("button", { name: "Fortsæt" }).click();
    const enableRes = await enabled;
    expect(enableRes.status()).toBe(200);
    const { totpURI } = (await enableRes.json()) as { totpURI: string };
    const secret = new URL(totpURI).searchParams.get("secret") ?? "";
    expect(secret).not.toBe("");

    await page.getByPlaceholder("000000").fill(await totpCode(secret));
    const verified = page.waitForResponse((r) =>
      r.url().includes("/api/auth/two-factor/verify-totp"),
    );
    await page.getByRole("button", { name: "Verificer" }).click();
    expect((await verified).status()).toBe(200);

    // Nyt login kræver nu koden.
    await page.context().clearCookies();
    await page.goto("/login");
    await page.fill("#email", email);
    await page.fill("#password", TEST_PASSWORD);
    await page.getByRole("button", { name: "Log ind", exact: true }).click();
    await expect(page).toHaveURL(/\/login\/two-factor/);
    expect(
      await (await page.request.get("/api/auth/get-session")).json(),
    ).toBeNull();
    await page.getByPlaceholder("000000").fill(await totpCode(secret));
    await page.getByRole("button", { name: "Bekræft" }).click();
    await expect(page).toHaveURL(/\/dashboard/);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json())?.user?.email).toBe(email);
  });

  test("passkey: registrér i Indstillinger og log ind uden adgangskode", async ({
    page,
  }) => {
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

    const email = await registeredUser(page);
    await login(page, email);
    await page.goto("/dashboard/settings/security");
    const registered = page.waitForResponse((r) =>
      r.url().includes("/api/auth/passkey/verify-registration"),
    );
    await page.getByRole("button", { name: "Tilføj passkey" }).click();
    expect((await registered).status()).toBe(200);

    await page.context().clearCookies();
    await page.goto("/login");
    const authenticated = page.waitForResponse((r) =>
      r.url().includes("/api/auth/passkey/verify-authentication"),
    );
    await page.getByRole("button", { name: "Passkey", exact: true }).click();
    expect((await authenticated).status()).toBe(200);
    await expect(page).toHaveURL(/\/dashboard/);
    const session = await page.request.get("/api/auth/get-session");
    expect((await session.json())?.user?.email).toBe(email);
  });

  test("Microsoft sender til common-tenant med 1.7-callbacken", async ({
    page,
  }) => {
    test.skip(!process.env.MICROSOFT_CLIENT_ID, "kræver MICROSOFT_CLIENT_ID");
    await page.goto("/login");
    const authorize = page.waitForRequest(/login\.microsoftonline\.com/);
    await page.getByRole("button", { name: /Microsoft/ }).click();
    const url = new URL((await authorize).url());
    expect(url.pathname).toBe("/common/oauth2/v2.0/authorize");
    expect(url.searchParams.get("redirect_uri")).toMatch(
      /\/api\/auth\/callback\/microsoft-entra-id$/,
    );
  });

  test("Google sender til /api/auth/callback/google", async ({ page }) => {
    test.skip(!process.env.GOOGLE_CLIENT_ID, "kræver GOOGLE_CLIENT_ID");
    await page.goto("/login");
    const authorize = page.waitForRequest(/accounts\.google\.com/);
    await page.getByRole("button", { name: "Fortsæt med Google" }).click();
    const url = new URL((await authorize).url());
    expect(url.searchParams.get("redirect_uri")).toMatch(
      /\/api\/auth\/callback\/google$/,
    );
  });
});
