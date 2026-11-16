/**
 * "Kun SSO"-politik (E12, #470) — rene hjælpere til Better-Auth-hooks.
 *
 * Alle login-veje der ikke er Microsoft Entra ID skal kunne blokeres for
 * domæner med politikken slået til. Passkeys er phishing-resistente og
 * bevidst undtaget.
 */

export const SSO_PROVIDER_ID = "microsoft-entra-id";

/** Stier med e-mail/telefon i body der kan blokeres FØR sessionen oprettes. */
export const NON_SSO_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  "/sign-in/email",
  "/sign-up/email",
  "/sign-in/magic-link",
  "/sign-in/phone-number",
  "/phone-number/verify",
]);

export function isNonSsoSignInPath(path: string): boolean {
  return NON_SSO_SIGN_IN_PATHS.has(path);
}

/**
 * Provider-id fra et OAuth-login der kan oprette en session. Alle providers,
 * også Microsoft, rammer `/callback/:id` (better-auth 1.7). Id-token-login
 * (Apple/Google fra mobilappen) opretter sessionen direkte på
 * `/sign-in/social` med provideren i body. Andre stier → null.
 */
export function callbackProviderId(
  path: string,
  params: Record<string, string | undefined> | undefined,
  body?: unknown,
): string | null {
  if (path === "/callback/:id") return params?.id ?? null;
  if (path === "/sign-in/social") {
    const provider = (body as { provider?: unknown } | undefined)?.provider;
    return typeof provider === "string" ? provider : null;
  }
  return null;
}

/** true når et OAuth-login er fra en IKKE-SSO-provider (Google/GitHub/…). */
export function callbackBypassesSso(
  path: string,
  params: Record<string, string | undefined> | undefined,
  body?: unknown,
): boolean {
  const provider = callbackProviderId(path, params, body);
  return provider !== null && provider !== SSO_PROVIDER_ID;
}

/**
 * Må en netop oprettet bruger slettes igen, når kun-SSO afviser loginnet?
 * Kun hvis brugeren er helt ny: én konto (den afviste provider), ingen
 * medlemskaber, oprettet for under fem minutter siden. Ellers ville
 * Microsoft-login efterfølgende fejle med "account not linked" (Microsoft er
 * bevidst ikke trusted provider).
 */
export function shouldDeleteRejectedNewUser(input: {
  accountCount: number;
  membershipCount: number;
  createdAt: Date;
  now?: Date;
}): boolean {
  const now = input.now ?? new Date();
  const ageMs = now.getTime() - input.createdAt.getTime();
  return (
    input.accountCount <= 1 &&
    input.membershipCount === 0 &&
    ageMs >= 0 &&
    ageMs < 5 * 60 * 1000
  );
}
