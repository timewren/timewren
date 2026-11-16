/**
 * Shared helpers for the browser-extension OAuth login flow.
 * Kept pure (no DB / no Next request) so they are unit-testable.
 */

/**
 * Hosts that `chrome.identity.launchWebAuthFlow` redirects back to.
 * Chrome/Edge use <ext-id>.chromiumapp.org; Firefox uses
 * <uuid>.extensions.allizom.org. We match on the host suffix with a leading
 * dot so a lookalike like "chromiumapp.org.evil.com" is rejected.
 */
const ALLOWED_REDIRECT_HOST_SUFFIXES = [
  ".chromiumapp.org",
  ".extensions.allizom.org",
];

/** True if `uri` is a safe extension redirect target (prevents token leak). */
export function isAllowedExtensionRedirectUri(uri: string): boolean {
  try {
    const url = new URL(uri);
    if (url.protocol !== "https:") return false;
    return ALLOWED_REDIRECT_HOST_SUFFIXES.some((suffix) =>
      url.hostname.endsWith(suffix),
    );
  } catch {
    return false;
  }
}

/**
 * Decide which organization an extension request is scoped to.
 * Honors `requestedOrgId` only if the user is a member; otherwise falls back
 * to `primaryOrgId`. Returns null if the user has no org at all.
 */
export function pickExtensionOrgId(
  requestedOrgId: string | null | undefined,
  memberOrgIds: string[],
  primaryOrgId: string | null,
): string | null {
  if (requestedOrgId && memberOrgIds.includes(requestedOrgId)) {
    return requestedOrgId;
  }
  return primaryOrgId;
}

/** Generate a 64-char URL-safe extension token (same alphabet as before). */
export function generateExtensionToken(): string {
  const chars =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let token = "";
  const array = new Uint8Array(64);
  crypto.getRandomValues(array);
  for (let i = 0; i < 64; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}
