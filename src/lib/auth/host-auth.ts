/**
 * Auth pr. host (TimeWren Cloud, docs/specs/timewren-cloud.md → 5). Rene
 * funktioner uden db-import, så reglerne kan testes uden database.
 *
 * Kun aktiv med både MULTIBRAND_ENABLED=1 og TIMEWREN_APP_ENABLED=1. Ellers
 * går alt gennem standardinstansen i src/lib/auth.ts, præcis som før.
 *
 * TimeWrens app kører på brandets primære host (hosts[0], fx timewren.com)
 * sammen med marketingsiderne; www.- og øvrige hosts sendes dertil af
 * middleware. Derfor én fast baseURL, ét RP ID og host-only cookies.
 */

import {
  BRAND_KEYS,
  type BrandHostConfig,
  type BrandKey,
  DEFAULT_BRAND_KEY,
  isMultibrandEnabled,
  type Locale,
  pickLocale,
  resolveBrandByHost,
} from "@/lib/brands/registry";
import { isBrandAppEnabled } from "@/lib/brands/timewren-site";
import { APPLE_ORIGIN, BRAND_APP_SCHEMES } from "./trusted-origins";

/** Begge flag til: TimeWren-hosts får egen auth-instans. */
export function isHostAuthEnabled(): boolean {
  return isMultibrandEnabled() && isBrandAppEnabled();
}

/**
 * Brandet, hvis auth-instans en host skal bruge. Flag fra, ukendt host og
 * alle TimeTrack-hosts giver standardbrandet (timetrack).
 */
export function authBrandForHost(host: string | null | undefined): BrandKey {
  if (!isHostAuthEnabled()) return DEFAULT_BRAND_KEY;
  return resolveBrandByHost(host).key;
}

export interface BrandAuthParams {
  key: BrandKey;
  /** better-auth appName, passkey rpName og TOTP-issuer. */
  appName: string;
  /** Kort navn til SMS-afsender. */
  shortName: string;
  baseURL: string;
  rpID: string;
  trustedOrigins: string[];
  /** undefined = host-only cookie. */
  cookieDomain: string | undefined;
}

/**
 * Auth-opsætningen for et ikke-standardbrand. Bevidst uden AUTH_COOKIE_DOMAIN,
 * AUTH_RP_ID og TRUSTED_ORIGINS: de er TimeTracks og må aldrig give en
 * TimeWren-host en `.timetrack.dk`-cookie eller et fremmed RP ID.
 */
export function brandAuthParams(
  cfg: BrandHostConfig,
  names: { name: string; shortName: string },
): BrandAuthParams {
  const primary = cfg.hosts[0];
  return {
    key: cfg.key,
    appName: names.name,
    shortName: names.shortName,
    baseURL: `https://${primary}`,
    rpID: primary,
    trustedOrigins: [
      ...cfg.hosts.map((h) => `https://${h}`),
      APPLE_ORIGIN,
      ...(BRAND_APP_SCHEMES[cfg.key] ?? []),
    ],
    cookieDomain: undefined,
  };
}

/** users.brand / organizations.brand som BrandKey (ukendt = timetrack). */
export function toBrandKey(value: string | null | undefined): BrandKey {
  return BRAND_KEYS.find((k) => k === value) ?? DEFAULT_BRAND_KEY;
}

/**
 * Hører kontoen til et andet brand end sitet? Kun med flagene; uden dem kan
 * alle konti logge ind overalt som før.
 */
export function isWrongBrand(
  userBrand: string | null | undefined,
  siteBrand: BrandKey,
): boolean {
  if (!isHostAuthEnabled()) return false;
  return toBrandKey(userBrand) !== siteBrand;
}

/**
 * Fejl ved login på forkert brand. Samme tekst uanset om kontoen findes andre
 * steder, så adresser ikke lækkes mellem brands. Login-siden oversætter koden
 * (login-helpers.ts) og ?error=account_not_here (redirect-flows).
 */
export const WRONG_BRAND_CODE = "ACCOUNT_NOT_ON_THIS_SITE";
export const WRONG_BRAND_QUERY = "account_not_here";
export const WRONG_BRAND_MESSAGE =
  "We could not find an account with those details here.";

/** Flows, der ender i en browser-redirect (OAuth-callback, mail-links). */
export function isRedirectFlow(path: string | undefined): boolean {
  if (!path) return false;
  return (
    path.startsWith("/callback/") ||
    path.startsWith("/oauth2/callback/") ||
    path === "/magic-link/verify" ||
    path === "/verify-email"
  );
}

/**
 * Sproget, en ny konto på et ikke-standardbrand får i users.locale (mails,
 * app). Kolonnens default er "da" (TimeTrack), så TimeWren sætter det i samme
 * insert: locale-cookien (sat af middleware ud fra sti-præfiks), ellers
 * Accept-Language, begrænset til brandets sprog, ellers brandets standard.
 */
export function signupLocale(
  cfg: BrandHostConfig,
  headers: Headers | null | undefined,
): Locale {
  const cookie = (headers?.get("cookie") ?? "")
    .split(";")
    .map((c) => c.trim().split("="))
    .find(([k]) => k === "locale")?.[1];
  return pickLocale(cfg, {
    cookie,
    acceptLanguage: headers?.get("accept-language"),
  });
}
