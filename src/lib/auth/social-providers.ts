/**
 * Sociale login-udbydere pr. brand (docs/specs/timewren-cloud.md → 5,
 * "Login-udbydere"). Rene funktioner uden db-import, så de kan testes uden
 * database og bruges af både auth-instanserne, /api/auth/providers og
 * kontoindstillingerne.
 *
 * TimeTrack læser de gamle env-navne (GOOGLE_CLIENT_ID osv.) præcis som før.
 * TimeWren læser kun TIMEWREN_-præfiksede navne og falder aldrig tilbage til
 * TimeTracks klienter: uden en TimeWren-klient er udbyderen hverken
 * registreret i TimeWren-instansen eller vist i UI'et.
 */

import { type BrandKey, DEFAULT_BRAND_KEY } from "@/lib/brands/registry";

export type SocialProvider =
  | "google"
  | "github"
  | "discord"
  | "microsoft"
  | "apple";

export const SOCIAL_PROVIDERS: readonly SocialProvider[] = [
  "google",
  "github",
  "discord",
  "microsoft",
  "apple",
];

const ENV_PREFIX: Record<BrandKey, string> = {
  timetrack: "",
  timewren: "TIMEWREN_",
};

const ENV_NAME: Record<SocialProvider, string> = {
  google: "GOOGLE",
  github: "GITHUB",
  discord: "DISCORD",
  microsoft: "MICROSOFT",
  apple: "APPLE",
};

/** Env-navnet for en udbyders nøgle, fx TIMEWREN_GOOGLE_CLIENT_ID. */
export function providerEnvName(
  brand: BrandKey,
  provider: SocialProvider,
  suffix: "CLIENT_ID" | "CLIENT_SECRET" | "TENANT_ID",
): string {
  return `${ENV_PREFIX[brand]}${ENV_NAME[provider]}_${suffix}`;
}

export interface SocialClient {
  clientId: string;
  /** Tom for Apple: secret'en er en JWT, der signeres ved brug (apple.ts). */
  clientSecret: string;
}

/**
 * Brandets OAuth-klient for en udbyder, eller null hvis den ikke er sat.
 * Apple kræver kun Services ID'et her; signeringsnøglen (APPLE_TEAM_ID,
 * APPLE_KEY_ID, APPLE_PRIVATE_KEY) er teamets og deles af brands.
 */
export function socialClient(
  brand: BrandKey,
  provider: SocialProvider,
  env: NodeJS.ProcessEnv = process.env,
): SocialClient | null {
  const clientId = env[providerEnvName(brand, provider, "CLIENT_ID")] ?? "";
  if (provider === "apple") {
    return clientId ? { clientId, clientSecret: "" } : null;
  }
  const clientSecret =
    env[providerEnvName(brand, provider, "CLIENT_SECRET")] ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Microsoft-tenant for brandet ("common" = alle Microsoft-konti). */
export function microsoftTenant(
  brand: BrandKey,
  env: NodeJS.ProcessEnv = process.env,
): string {
  return env[providerEnvName(brand, "microsoft", "TENANT_ID")] || "common";
}

/** De udbydere, login- og tilmeldingssiden kan vise knapper for. */
export interface OAuthAvailability {
  google: boolean;
  github: boolean;
  discord: boolean;
  microsoft: boolean;
}

export function oauthAvailability(
  brand: BrandKey = DEFAULT_BRAND_KEY,
  env: NodeJS.ProcessEnv = process.env,
): OAuthAvailability {
  return {
    google: Boolean(socialClient(brand, "google", env)),
    github: Boolean(socialClient(brand, "github", env)),
    discord: Boolean(socialClient(brand, "discord", env)),
    microsoft: Boolean(socialClient(brand, "microsoft", env)),
  };
}

/**
 * Udbydere, en konto kan forbinde under Sikkerhed. Nøglerne er better-auths
 * provider-id'er (Microsoft hedder "microsoft-entra-id").
 */
export function linkableProviders(
  brand: BrandKey = DEFAULT_BRAND_KEY,
  env: NodeJS.ProcessEnv = process.env,
) {
  const a = oauthAvailability(brand, env);
  return {
    google: a.google,
    github: a.github,
    discord: a.discord,
    "microsoft-entra-id": a.microsoft,
  };
}
