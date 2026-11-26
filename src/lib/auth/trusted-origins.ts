/**
 * Udleder better-auths `trustedOrigins` fra env, så ingen af Mahopes værter er
 * hårdkodet (#964). Rene funktioner uden env-opslag, så de kan testes.
 */

/** Sign in with Apple poster form_post-svar fra appleid.apple.com. */
export const APPLE_ORIGIN = "https://appleid.apple.com";

/**
 * Native mobilapp (Expo): app-schemes som better-auth's expoClient sender i
 * `expo-origin`-headeren. Kun dev-builds (Expo Go) må bruge exp://.
 */
const APP_SCHEMES = ["timetrack://", "timetrack.preview://"];
const DEV_APP_SCHEMES = ["exp://", "exp://**"];

/**
 * App-schemes for ikke-standardbrands' egne native apps. TimeWren-appen
 * (com.timewren.app) sender `expo-origin: timewren://`; uden den her afviser
 * TimeWren-instansen login og tilmelding med 403 INVALID_ORIGIN.
 * TimeTracks schemes står kun i standardinstansen (APP_SCHEMES).
 */
export const BRAND_APP_SCHEMES: Readonly<Record<string, readonly string[]>> = {
  timewren: ["timewren://"],
};

/**
 * App-schemes (`scheme://`) fra APP_SCHEMES, eller standardlisten uden env.
 * Web-, exp- og andre farlige schemes filtreres fra. Bruges både til
 * trustedOrigins og som allowlist for device-login-callbacket.
 */
export function appSchemes(appSchemesEnv: string | undefined): string[] {
  if (appSchemesEnv === undefined) return [...APP_SCHEMES];
  return appSchemesEnv
    .split(",")
    .map((scheme) => scheme.trim())
    .filter(
      (scheme) =>
        /^[a-z][a-z0-9+.-]*:\/\/$/i.test(scheme) &&
        !/^(https?|javascript|data|file|exp):/i.test(scheme),
    );
}

/** Returnerer `scheme://host[:port]` for en http(s)-URL, ellers null. */
export function originOf(value: string | undefined | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** `https://timetrack.dk` → `https://www.timetrack.dk` (kun for bare domæner). */
function wwwVariant(origin: string): string | null {
  const url = new URL(origin);
  if (url.hostname.startsWith("www.")) return null;
  if (url.hostname.split(".").length !== 2) return null;
  return `${url.protocol}//www.${url.host}`;
}

/** Kommasepareret liste (TRUSTED_ORIGINS). Ugyldige poster springes over. */
export function parseTrustedOriginsEnv(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .map((v) => originOf(v))
    .filter((v): v is string => v !== null);
}

export interface TrustedOriginsInput {
  /** NEXT_PUBLIC_APP_URL (allerede med localhost-fallback). */
  appUrl: string;
  /** NEXT_PUBLIC_MARKETING_URL, hvis sat. */
  marketingUrl?: string;
  /** TRUSTED_ORIGINS, kommasepareret. */
  trustedOriginsEnv?: string;
  appSchemesEnv?: string;
  isDevelopment?: boolean;
}

export function deriveTrustedOrigins({
  appUrl,
  marketingUrl,
  trustedOriginsEnv,
  appSchemesEnv,
  isDevelopment = false,
}: TrustedOriginsInput): string[] {
  const web: string[] = [];
  for (const raw of [appUrl, marketingUrl]) {
    const origin = originOf(raw);
    if (!origin) continue;
    web.push(origin);
    const www = wwwVariant(origin);
    if (www && raw === marketingUrl) web.push(www);
  }

  return [
    // appUrl uændret først (better-auth sammenligner baseURL på den form).
    appUrl,
    ...web,
    APPLE_ORIGIN,
    ...parseTrustedOriginsEnv(trustedOriginsEnv),
    ...appSchemes(appSchemesEnv),
    ...(isDevelopment ? DEV_APP_SCHEMES : []),
  ].filter((v, i, a) => a.indexOf(v) === i);
}
