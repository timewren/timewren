import { extensionVersion } from "./client-version";

/**
 * Delt tilstand mellem popup, ny fane-side og baggrund om opdateringer:
 *
 * - `clientTooOld` (storage.local): serveren har afvist en skrivning fra
 *   denne version. Baggrunden lytter på nøglen og viser badge/notifikation og
 *   beder Chrome om en opdatering; popup'en viser et banner. Ryddes når
 *   extensionen kører en anden version (= er opdateret).
 * - `save:<id>` (storage.session): gem der er i gang lige nu, så
 *   baggrunden ikke genstarter extensionen midt i et timer-stop.
 */

export const CLIENT_TOO_OLD_KEY = "clientTooOld";
const SAVE_PREFIX = "save:";

export interface ClientTooOldFlag {
  /** Versionen der blev afvist */
  version: string;
  at: number;
}

export async function markClientTooOld(): Promise<void> {
  try {
    const current = await chrome.storage.local.get([CLIENT_TOO_OLD_KEY]);
    const existing = current[CLIENT_TOO_OLD_KEY] as
      | ClientTooOldFlag
      | undefined;
    const version = extensionVersion();
    if (existing?.version === version) return;
    await chrome.storage.local.set({
      [CLIENT_TOO_OLD_KEY]: {
        version,
        at: Date.now(),
      } satisfies ClientTooOldFlag,
    });
  } catch {
    // Storage utilgængelig — fejlbeskeden fra serveren vises stadig
  }
}

export async function readClientTooOld(): Promise<ClientTooOldFlag | null> {
  try {
    const current = await chrome.storage.local.get([CLIENT_TOO_OLD_KEY]);
    const flag = current[CLIENT_TOO_OLD_KEY] as ClientTooOldFlag | undefined;
    return flag && flag.version === extensionVersion() ? flag : null;
  } catch {
    return null;
  }
}

function sessionStorage(): chrome.storage.StorageArea | null {
  try {
    return chrome.storage.session ?? null;
  } catch {
    return null;
  }
}

/**
 * Hvert gem har sin egen nøgle (`save:<id>`), så popup og baggrund aldrig
 * overskriver hinandens markører (ingen læs-så-skriv på en fælles nøgle).
 */
export async function readSavesInFlight(): Promise<Record<string, number>> {
  const area = sessionStorage();
  if (!area) return {};
  try {
    const all = await area.get(null);
    const saves: Record<string, number> = {};
    for (const [key, value] of Object.entries(all)) {
      if (key.startsWith(SAVE_PREFIX) && typeof value === "number") {
        saves[key.slice(SAVE_PREFIX.length)] = value;
      }
    }
    return saves;
  } catch {
    return {};
  }
}

/** Kør en skrivning og meld den "i gang" imens. */
export async function trackSave<T>(fn: () => Promise<T>): Promise<T> {
  const area = sessionStorage();
  const key = `${SAVE_PREFIX}${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await area?.set({ [key]: Date.now() }).catch(() => {});
  try {
    return await fn();
  } finally {
    await area?.remove(key).catch(() => {});
  }
}
