import { marketingUrlEnv } from "@/lib/runtime-env";
/**
 * Delt samtykke-lagring på tværs af marketing-hosten (timetrack.dk) og
 * app-hosten (app.timetrack.dk).
 *
 * localStorage er per-origin, så samtykke givet på timetrack.dk fulgte
 * aldrig med til app.timetrack.dk hvor signup sker — Google Ads-konverteringer
 * blev derfor sendt uden samtykke (cookieless ping) og talte reelt 0.
 * Samtykket gemmes nu i en cookie på `.timetrack.dk` som begge hosts kan
 * læse. localStorage beholdes som skrive-mål af hensyn til eksisterende
 * besøgende og som fallback på andre domæner (localhost, previews).
 */

export interface CookiePreferences {
  necessary: boolean;
  analytics: boolean;
  marketing: boolean;
  timestamp: number;
  version?: string;
}

export const COOKIE_CONSENT_KEY = "timetrack_cookie_consent";
const CONSENT_COOKIE = "tt_consent";
const CONSENT_DAYS = 365;

/**
 * Deler cookien på tværs af subdomæner i produktion. beta.timetrack.dk
 * holdes bevidst isoleret så beta-besøg ikke forurener prod-samtykke.
 */
export function sharedCookieDomain(): string | undefined {
  if (typeof window === "undefined") return undefined;
  const host = window.location.hostname;
  if (host.startsWith("beta.")) return undefined;
  return sharedCookieDomainFor(host, marketingUrlEnv());
}

/**
 * `.<marketing-domæne>` når værten er marketing-domænet eller et subdomæne af
 * det, og marketing-URL'en er et bart domæne (fx timetrack.dk). Ellers
 * host-only, så selvhostede instanser aldrig deler cookie med andre.
 */
export function sharedCookieDomainFor(
  host: string,
  marketingUrl: string | undefined,
): string | undefined {
  if (!marketingUrl) return undefined;
  let marketingHost: string;
  try {
    marketingHost = new URL(marketingUrl).hostname;
  } catch {
    return undefined;
  }
  if (marketingHost.split(".").length !== 2) return undefined;
  if (host === marketingHost || host.endsWith(`.${marketingHost}`)) {
    return `.${marketingHost}`;
  }
  return undefined;
}

function readCookieValue(name: string): string | null {
  if (typeof document === "undefined") return null;
  const match = document.cookie
    .split("; ")
    .find((c) => c.startsWith(`${name}=`));
  return match ? decodeURIComponent(match.slice(name.length + 1)) : null;
}

export function readConsent(): CookiePreferences | null {
  // Cookie først (delt på tværs af hosts), localStorage som fallback for
  // besøgende der gav samtykke før cookie-lagringen fandtes.
  try {
    const fromCookie = readCookieValue(CONSENT_COOKIE);
    if (fromCookie) return JSON.parse(fromCookie) as CookiePreferences;
  } catch {}
  try {
    const stored = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (stored) return JSON.parse(stored) as CookiePreferences;
  } catch {}
  return null;
}

export function writeConsent(prefs: CookiePreferences): void {
  try {
    localStorage.setItem(COOKIE_CONSENT_KEY, JSON.stringify(prefs));
  } catch {}
  if (typeof document === "undefined") return;
  const domain = sharedCookieDomain();
  const value = encodeURIComponent(JSON.stringify(prefs));
  const maxAge = CONSENT_DAYS * 86400;
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API mangler i Safari/Firefox, og samtykkecookien skal kunne sættes synkront
  document.cookie = `${CONSENT_COOKIE}=${value}; path=/; max-age=${maxAge}; SameSite=Lax${
    domain ? `; domain=${domain}` : ""
  }`;
}
