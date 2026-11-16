import { t } from "./i18n/core";
/**
 * Extension Configuration
 *
 * Change API URL defaults here to switch between development and production.
 * After changing, rebuild the extension: npm run build
 */

import { normalizeServerAddress } from "./server-discovery";

// Defaults (production)
export const DEFAULT_WEB_APP_URL = "https://timetrack.dk";
export const DEFAULT_API_URL = `${DEFAULT_WEB_APP_URL}/api/trpc`;

export const WEB_APP_URL = DEFAULT_WEB_APP_URL;
let approvedOrigin: string | null = null;

/** Built-in origins; custom origins additionally require a saved permission grant. */
const ALLOWED_ORIGINS = [
  "https://timetrack.dk",
  "https://www.timetrack.dk",
  // Subdomain split (app.*) + staging (beta.*) — lets the settings apiUrl
  // field accept these first-party hosts.
  "https://app.timetrack.dk",
  "https://beta.timetrack.dk",
];

export function isFirstPartyApiUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const origin = parsed.origin;
    return ALLOWED_ORIGINS.some(
      (allowed) => origin === allowed || origin === new URL(allowed).origin,
    );
  } catch {
    return false;
  }
}

function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";

  // Allow users to paste full API URL or base URL
  const withoutApi = trimmed.replace(/\/api\/trpc\/?$/i, "");
  const normalized = withoutApi.replace(/\/+$/, "");

  if (isFirstPartyApiUrl(normalized)) {
    const url = new URL(normalized);
    return url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
      ? ""
      : url.origin;
  }
  try {
    return normalizeServerAddress(
      normalized,
      import.meta.env.MODE === "development",
    );
  } catch {
    return "";
  }
}

export async function resolveApiUrl(): Promise<string> {
  const result = await chrome.storage.local.get([
    "extensionSettings",
    "approvedServerOrigin",
  ]);
  const settings = result.extensionSettings as { apiUrl?: string } | undefined;
  const base = normalizeBaseUrl(settings?.apiUrl || "");
  // A saved address that is no longer accepted (e.g. http://localhost from an
  // older build) falls back to Cloud; tokens are origin-bound, so nothing leaks.
  if (base) {
    if (result.approvedServerOrigin === base) approvedOrigin = base;
    if (
      !isFirstPartyApiUrl(base) &&
      (result.approvedServerOrigin !== base ||
        !(await chrome.permissions.contains({ origins: [`${base}/*`] })))
    )
      throw new Error(t("errors.server.noPermission"));
    return `${base}/api/trpc`;
  }

  return DEFAULT_API_URL;
}

export async function resolveWebAppUrl(): Promise<string> {
  const apiUrl = await resolveApiUrl();
  return apiUrl.replace(/\/api\/trpc$/i, "");
}

/**
 * Derive the web app URL from a settings apiUrl value (synchronous).
 * Use this in components that already have settings loaded.
 */
export function deriveWebAppUrl(apiUrl: string): string {
  const base = (apiUrl || DEFAULT_WEB_APP_URL)
    .replace(/\/api\/trpc\/?$/i, "")
    .replace(/\/+$/, "");
  // Navigation may also use a previously approved custom server. Credential
  // requests separately recheck the browser permission and fail closed.
  return (isFirstPartyApiUrl(base) || base === approvedOrigin) &&
    normalizeBaseUrl(base)
    ? normalizeBaseUrl(base)
    : DEFAULT_WEB_APP_URL;
}

/**
 * Syntaksvalidering. connectServer kontrollerer tilladelse og discovery,
 * før en ny adresse gemmes. Tomt felt = standardadressen.
 */
export function validateApiUrlInput(
  value: string,
): { ok: true; value: string } | { ok: false; error: string } {
  const trimmed = value.trim();
  if (!trimmed) return { ok: true, value: DEFAULT_WEB_APP_URL };
  const normalized = trimmed
    .replace(/\/api\/trpc\/?$/i, "")
    .replace(/\/+$/, "");
  if (!normalizeBaseUrl(normalized)) {
    return {
      ok: false,
      error: t("errors.url.invalid"),
    };
  }
  return { ok: true, value: normalizeBaseUrl(normalized) };
}
