import {
  DEFAULT_WEB_APP_URL,
  isFirstPartyApiUrl,
  resolveWebAppUrl,
  validateApiUrlInput,
} from "./config";
import { t } from "./i18n/core";
import { discoverServer } from "./server-discovery";

/** All credential-bearing fetches must verify the origin again at send time. */
export async function serverFetch(
  url: string,
  init: RequestInit,
  token: string,
  manualServer?: string,
): Promise<Response> {
  const origin = new URL(url).origin;
  if (origin !== (await resolveWebAppUrl()))
    throw new Error(t("errors.server.changedLoginAgain"));
  const stored = await chrome.storage.local.get([
    "extensionToken",
    "extensionTokenServer",
  ]);
  if (manualServer !== undefined && manualServer !== origin) {
    throw new Error(t("errors.server.changedRetry"));
  }
  // Legacy tokens predate origin binding and were limited to built-in hosts.
  // Switching servers clears them; never infer a binding for a custom host.
  if (
    manualServer === undefined &&
    (stored.extensionToken !== token ||
      (stored.extensionTokenServer ??
        (isFirstPartyApiUrl(origin) ? origin : undefined)) !== origin)
  )
    throw new Error(t("errors.server.loginOnSelected"));
  const response = await fetch(url, {
    ...init,
    redirect: "error",
    credentials: "omit",
  });
  if (origin !== (await resolveWebAppUrl()))
    throw new Error(t("errors.server.changedRetry"));
  return response;
}

/** Invoke directly from a click: optional permission requests need a user gesture. */
export async function connectServer(value: string): Promise<void> {
  const result = validateApiUrlInput(value);
  if (!result.ok) throw new Error(result.error);
  const origin = result.value;
  if (!isFirstPartyApiUrl(origin)) {
    const target = { origins: [`${origin}/*`] };
    // No await before request(): it needs the click's user gesture.
    const granted = await chrome.permissions.request(target);
    if (!granted) throw new Error(t("errors.server.grantAccess"));
    try {
      await discoverServer(origin);
    } catch (error) {
      // Don't leave a freshly granted permission behind for a rejected server.
      const { approvedServerOrigin } = await chrome.storage.local.get(
        "approvedServerOrigin",
      );
      if (approvedServerOrigin !== origin)
        await chrome.permissions.remove(target);
      throw error;
    }
  }
  const stored = await chrome.storage.local.get([
    "extensionSettings",
    "offlineQueue",
    "approvedServerOrigin",
  ]);
  const settings = stored.extensionSettings as
    | Record<string, unknown>
    | undefined;
  if ((settings?.apiUrl || DEFAULT_WEB_APP_URL) === origin) return;
  if (Array.isArray(stored.offlineQueue) && stored.offlineQueue.length > 0) {
    throw new Error(t("errors.server.syncPendingFirst"));
  }
  // Reload all extension contexts after clearing persisted account data. This
  // also discards in-memory query caches and stops the old Electric stream.
  const previous = stored.approvedServerOrigin;
  await chrome.storage.local.clear();
  await chrome.storage.local.set({
    extensionSettings: { ...settings, apiUrl: origin },
    approvedServerOrigin: origin,
  });
  if (
    typeof previous === "string" &&
    previous !== origin &&
    !isFirstPartyApiUrl(previous)
  )
    await chrome.permissions.remove({ origins: [`${previous}/*`] });
  chrome.runtime.reload();
}
