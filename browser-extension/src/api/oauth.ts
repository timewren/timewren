import { resolveWebAppUrl } from "../config";
import { t } from "../i18n/core";

// Firefox exposes the identity API under `browser.identity`; `chrome.identity`
// can be undefined there. Resolve whichever is available.
const identityApi =
  (globalThis as unknown as { browser?: { identity?: typeof chrome.identity } })
    .browser?.identity ?? chrome.identity;

export interface ExtensionAuthResult {
  token: string;
  orgId: string | null;
  serverUrl?: string;
}

/**
 * Parse the URL that launchWebAuthFlow hands back. The token/org/state live
 * in the URL fragment (#token=...&org=...&state=...). Throws on error, state
 * mismatch, or a missing token.
 */
export function parseAuthCallback(
  callbackUrl: string,
  expectedState: string,
): ExtensionAuthResult {
  const url = new URL(callbackUrl);
  const params = new URLSearchParams(url.hash.replace(/^#/, ""));

  const error = params.get("error");
  if (error) throw new Error(error);

  const state = params.get("state");
  if (state !== expectedState) {
    throw new Error(t("errors.auth.loginCancelled"));
  }

  const token = params.get("token");
  if (!token) throw new Error(t("errors.auth.noToken"));

  return { token, orgId: params.get("org") };
}

function randomState(): string {
  const arr = new Uint8Array(16);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Run the full OAuth flow: open the approval page in a launchWebAuthFlow
 * popup, then parse the captured redirect. Resolves with token + default org.
 */
export async function loginWithOAuth(): Promise<ExtensionAuthResult> {
  const webAppUrl = await resolveWebAppUrl();
  const redirectUri = identityApi.getRedirectURL();
  const state = randomState();

  const authUrl = new URL(`${webAppUrl}/auth/extension`);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("state", state);

  const browserName = navigator.userAgent.includes("Firefox")
    ? "firefox"
    : "chrome";
  authUrl.searchParams.set("browser", browserName);

  const callbackUrl = await identityApi.launchWebAuthFlow({
    url: authUrl.toString(),
    interactive: true,
  });

  if (!callbackUrl) throw new Error(t("errors.auth.loginCancelledShort"));
  const received = new URL(callbackUrl);
  const expected = new URL(redirectUri);
  if (
    received.origin !== expected.origin ||
    received.pathname !== expected.pathname ||
    webAppUrl !== (await resolveWebAppUrl())
  )
    throw new Error(t("errors.server.changedRetry"));
  return { ...parseAuthCallback(callbackUrl, state), serverUrl: webAppUrl };
}
