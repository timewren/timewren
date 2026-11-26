/**
 * Kalenderens OAuth-klienter pr. brand (docs/specs/timewren-cloud.md → 5,
 * "Kalender"). Rene funktioner uden db-import, så de kan testes uden database
 * og bruges af både integrationerne, tRPC og callback-ruterne.
 *
 * Google: TimeTrack læser som før GOOGLE_CLIENT_ID/_SECRET og
 * GOOGLE_REDIRECT_URI (ellers `<app-URL>/api/integrations/google/callback`).
 * TimeWren læser kun TIMEWREN_GOOGLE_CLIENT_ID/_SECRET (samme app som login)
 * og redirecter til `https://<hosts[0]>/api/integrations/google/callback`
 * (eller TIMEWREN_GOOGLE_REDIRECT_URI). Ingen fallback mellem brands.
 *
 * Outlook (Microsoft Graph): TimeWren læser TIMEWREN_OUTLOOK_CLIENT_ID/_SECRET
 * og falder tilbage til login-appen TIMEWREN_MICROSOFT_CLIENT_ID/_SECRET.
 * TimeTrack kun OUTLOOK_CALENDAR_CLIENT_ID/_SECRET, aldrig TimeTracks
 * Entra-login-app, så TimeTrack er uændret, indtil nøglerne sættes.
 */

import {
  BRAND_KEYS,
  type BrandKey,
  DEFAULT_BRAND_KEY,
  getBrandConfigsSafe,
} from "@/lib/brands/registry";
import { appUrlEnv } from "@/lib/runtime-env";

/** Env-opslag (process.env som standard; tests sender et rent objekt). */
export type CalendarEnv = Record<string, string | undefined>;

export interface CalendarOAuthClient {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export interface OutlookOAuthClient extends CalendarOAuthClient {
  /** "common", "organizations", "consumers" eller en tenant-GUID. */
  tenant: string;
}

export const GOOGLE_CALLBACK_PATH = "/api/integrations/google/callback";
export const OUTLOOK_CALLBACK_PATH = "/api/integrations/outlook/callback";

/**
 * Brandet hvis OAuth-klient udstedte en forbindelses tokens (`oauth_brand`).
 * Rækker uden kolonnen og ukendte værdier giver TimeTrack.
 */
export function connectionOAuthBrand(connection: {
  oauthBrand?: string | null;
}): BrandKey {
  return (
    BRAND_KEYS.find((k) => k === connection.oauthBrand) ?? DEFAULT_BRAND_KEY
  );
}

/** `https://<hosts[0]>` for et ikke-standardbrand (TimeWrens app-host). */
export function brandPrimaryUrl(brand: BrandKey): string {
  return `https://${getBrandConfigsSafe()[brand].hosts[0]}`;
}

/**
 * Appens offentlige URL for brandet, som OAuth-redirects og efterfølgende
 * browser-redirects bygges af. TimeTrack: NEXT_PUBLIC_APP_URL som før.
 */
export function calendarAppUrl(brand: BrandKey): string {
  if (brand === DEFAULT_BRAND_KEY) return appUrlEnv() ?? "";
  return brandPrimaryUrl(brand);
}

function pair(
  env: CalendarEnv,
  idName: string,
  secretName: string,
): { clientId: string; clientSecret: string } | null {
  const clientId = env[idName] ?? "";
  const clientSecret = env[secretName] ?? "";
  return clientId && clientSecret ? { clientId, clientSecret } : null;
}

/** Google Calendar-klienten for brandet, eller null hvis den ikke er sat. */
export function googleCalendarClient(
  brand: BrandKey,
  env: CalendarEnv = process.env,
): CalendarOAuthClient | null {
  if (brand === DEFAULT_BRAND_KEY) {
    const keys = pair(env, "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET");
    if (!keys) return null;
    return {
      ...keys,
      redirectUri:
        env.GOOGLE_REDIRECT_URI || `${appUrlEnv()}${GOOGLE_CALLBACK_PATH}`,
    };
  }
  const keys = pair(
    env,
    "TIMEWREN_GOOGLE_CLIENT_ID",
    "TIMEWREN_GOOGLE_CLIENT_SECRET",
  );
  if (!keys) return null;
  return {
    ...keys,
    redirectUri:
      env.TIMEWREN_GOOGLE_REDIRECT_URI ||
      `${brandPrimaryUrl(brand)}${GOOGLE_CALLBACK_PATH}`,
  };
}

/** Outlook-kalenderklienten for brandet, eller null hvis den ikke er sat. */
export function outlookCalendarClient(
  brand: BrandKey,
  env: CalendarEnv = process.env,
): OutlookOAuthClient | null {
  if (brand === DEFAULT_BRAND_KEY) {
    // Bevidst ingen fallback til MICROSOFT_* (TimeTracks login-app).
    const keys = pair(
      env,
      "OUTLOOK_CALENDAR_CLIENT_ID",
      "OUTLOOK_CALENDAR_CLIENT_SECRET",
    );
    if (!keys) return null;
    return {
      ...keys,
      tenant: env.OUTLOOK_CALENDAR_TENANT_ID || "common",
      redirectUri:
        env.OUTLOOK_CALENDAR_REDIRECT_URI ||
        `${appUrlEnv()}${OUTLOOK_CALLBACK_PATH}`,
    };
  }
  const keys =
    pair(env, "TIMEWREN_OUTLOOK_CLIENT_ID", "TIMEWREN_OUTLOOK_CLIENT_SECRET") ??
    pair(
      env,
      "TIMEWREN_MICROSOFT_CLIENT_ID",
      "TIMEWREN_MICROSOFT_CLIENT_SECRET",
    );
  if (!keys) return null;
  return {
    ...keys,
    tenant: env.TIMEWREN_MICROSOFT_TENANT_ID || "common",
    redirectUri:
      env.TIMEWREN_OUTLOOK_REDIRECT_URI ||
      `${brandPrimaryUrl(brand)}${OUTLOOK_CALLBACK_PATH}`,
  };
}

export interface CalendarProviderAvailability {
  google: boolean;
  outlook: boolean;
  /** iCloud/CalDAV kræver ingen OAuth-klient og er altid slået til. */
  icloud: true;
}

/** Hvilke kalenderudbydere en konto på `brand` kan forbinde. */
export function calendarProvidersForBrand(
  brand: BrandKey,
  env: CalendarEnv = process.env,
): CalendarProviderAvailability {
  return {
    google: googleCalendarClient(brand, env) !== null,
    outlook: outlookCalendarClient(brand, env) !== null,
    icloud: true,
  };
}
