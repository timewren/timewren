import { t } from "../i18n/core";
import {
  extensionVersion,
  liveSaves,
  nextUpdateCheckAt,
  RELOAD_MAX_WAIT_MS,
  shouldDeferReload,
  shouldRequestUpdateCheck,
} from "../lib/client-version";
import {
  CLIENT_TOO_OLD_KEY,
  type ClientTooOldFlag,
  readClientTooOld,
  readSavesInFlight,
} from "../lib/update-state";
import { badgeManager } from "./badgeManager";

/**
 * Opdateringer i baggrunden:
 *
 * - Ved opstart og når serveren melder CLIENT_TOO_OLD beder vi Chrome om at
 *   lede efter en ny version (`requestUpdateCheck`). Chrome fraråder
 *   rutinemæssige kald, så vi gør det højst hvert 10. minut og venter en
 *   time, hvis Chrome svarer "throttled".
 * - Når en ny version er hentet (`onUpdateAvailable`), genstarter vi
 *   extensionen — men først når intet gem er i gang (højst 2 min venten)
 *   og popup'en er lukket (den kan have en ugemt manuel registrering).
 * - CLIENT_TOO_OLD: rødt "!"-badge og én notifikation pr. version.
 */

const NEXT_CHECK_KEY = "nextUpdateCheckAt";
const NOTIFIED_KEY = "clientTooOldNotified";
const NOTIFICATION_ID = "timetrack-update";
/**
 * En ventende genstart overlever at service workeren lægges i dvale: den
 * gemmes i storage.session og genoptages ved næste opvågning (sync-alarmen
 * vækker workeren hvert 30. sekund).
 */
const PENDING_RELOAD_KEY = "pendingReloadSince";

let reloadScheduled = false;

/** Er popup'en åben (kan have en ugemt manuel registrering)? */
async function isPopupOpen(): Promise<boolean> {
  try {
    const getContexts = (
      chrome.runtime as unknown as {
        getContexts?: (filter: {
          contextTypes: string[];
        }) => Promise<unknown[]>;
      }
    ).getContexts;
    if (typeof getContexts !== "function") return false;
    const contexts = await getContexts.call(chrome.runtime, {
      contextTypes: ["POPUP"],
    });
    return contexts.length > 0;
  } catch {
    return false;
  }
}

export async function requestUpdateCheck(reason: string): Promise<void> {
  try {
    if (typeof chrome.runtime.requestUpdateCheck !== "function") return;
    const now = Date.now();
    const stored = await chrome.storage.local.get([NEXT_CHECK_KEY]);
    if (!shouldRequestUpdateCheck(stored[NEXT_CHECK_KEY] as number, now)) {
      return;
    }
    // Sæt fristen før kaldet, så samtidige afvisninger ikke kalder igen
    await chrome.storage.local.set({
      [NEXT_CHECK_KEY]: nextUpdateCheckAt(undefined, now),
    });
    const result = (await chrome.runtime.requestUpdateCheck()) as unknown as
      | { status?: string; version?: string }
      | string
      | undefined;
    const status = typeof result === "string" ? result : result?.status;
    await chrome.storage.local.set({
      [NEXT_CHECK_KEY]: nextUpdateCheckAt(status, now),
    });
    console.log(`[Update] Tjek (${reason}): ${status ?? "ukendt"}`);
    // "update_available" betyder kun, at Chrome henter den; genstarten
    // sker fra onUpdateAvailable, når versionen faktisk er klar.
  } catch (error) {
    console.warn("[Update] requestUpdateCheck fejlede:", error);
  }
}

/** Genstart så snart intet gem er i gang (eller efter højst 2 min). */
export function scheduleReload(since: number = Date.now()): void {
  if (reloadScheduled) return;
  reloadScheduled = true;
  void chrome.storage.session
    ?.set({ [PENDING_RELOAD_KEY]: since })
    .catch(() => {});
  const deadline = since + RELOAD_MAX_WAIT_MS;
  const attempt = async () => {
    const now = Date.now();
    const live = liveSaves(await readSavesInFlight(), now);
    if (
      shouldDeferReload({
        savesInFlight: Object.keys(live).length,
        popupOpen: await isPopupOpen(),
        now,
        deadline,
      })
    ) {
      setTimeout(() => void attempt(), 2000);
      return;
    }
    console.log("[Update] Ny version klar — genstarter extensionen");
    chrome.runtime.reload();
  };
  void attempt();
}

async function showTooOld(flag: ClientTooOldFlag | null): Promise<void> {
  await badgeManager.setClientTooOld(!!flag);
  if (!flag) return;
  try {
    const stored = await chrome.storage.local.get([NOTIFIED_KEY]);
    if (stored[NOTIFIED_KEY] !== flag.version) {
      await chrome.storage.local.set({ [NOTIFIED_KEY]: flag.version });
      await chrome.notifications.create(NOTIFICATION_ID, {
        type: "basic",
        iconUrl: "icons/icon-128.png",
        title: t("notifications.updateTitle"),
        message: t("notifications.updateBody"),
        priority: 2,
      });
    }
  } catch {
    // Notifikationer kan være slået fra — badget og popup-banneret står
  }
  await requestUpdateCheck("client_too_old");
}

export function initUpdateHandling(): void {
  chrome.runtime.onUpdateAvailable?.addListener((details) => {
    console.log(`[Update] Version ${details.version} er klar`);
    scheduleReload();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local" || !(CLIENT_TOO_OLD_KEY in changes)) return;
    const flag = changes[CLIENT_TOO_OLD_KEY].newValue as
      | ClientTooOldFlag
      | undefined;
    void showTooOld(flag && flag.version === extensionVersion() ? flag : null);
  });

  // Ved hver opvågning: et flag fra en tidligere version er forældet (vi er
  // opdateret), et gældende flag skal vises igen.
  // Genoptag en genstart, der ventede da workeren gik i dvale
  void (async () => {
    try {
      const stored = await chrome.storage.session?.get([PENDING_RELOAD_KEY]);
      const since = stored?.[PENDING_RELOAD_KEY];
      if (typeof since === "number") scheduleReload(since);
    } catch {
      // storage.session mangler (ældre Firefox) — Chrome installerer så
      // opdateringen ved næste browserstart
    }
  })();

  void (async () => {
    const flag = await readClientTooOld();
    if (!flag) {
      await chrome.storage.local.remove([CLIENT_TOO_OLD_KEY]).catch(() => {});
      await badgeManager.setClientTooOld(false);
      return;
    }
    await showTooOld(flag);
  })();

  chrome.runtime.onStartup.addListener(() => {
    void requestUpdateCheck("startup");
  });
}
