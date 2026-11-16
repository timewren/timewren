/**
 * Popup'en i et eget vindue (genvejen Hurtig registrering, "Kopier" i ny
 * fane, og når chrome.action.openPopup ikke er tilladt). Et åbent vindue
 * genbruges i stedet for at åbne et nyt hver gang, og størrelsen giver plads
 * til popup'ens 400x580 plus vinduets ramme og titellinje.
 */
const WINDOW_ID_KEY = "popupWindowId";

/**
 * Vindues-id'er genbruges efter en genstart af browseren, så id'et gemmes i
 * session-lageret (ryddes ved genstart), og kun et popup-vindue genbruges —
 * ellers kunne et almindeligt vindue med samme id blive navigeret væk.
 */
function windowIdStorage(): chrome.storage.StorageArea {
  return chrome.storage.session ?? chrome.storage.local;
}

export const POPUP_WINDOW_SIZE = { width: 416, height: 640 };

export async function openPopupWindow(path = "popup.html"): Promise<void> {
  const url = chrome.runtime.getURL(path);
  try {
    const stored = await windowIdStorage().get([WINDOW_ID_KEY]);
    const windowId = stored[WINDOW_ID_KEY];
    if (typeof windowId === "number") {
      const existing = await chrome.windows.get(windowId, { populate: true });
      const tabId = existing.tabs?.[0]?.id;
      if (existing.type === "popup" && tabId !== undefined) {
        await chrome.tabs.update(tabId, { url, active: true });
        await chrome.windows.update(windowId, { focused: true });
        return;
      }
    }
  } catch {
    // Vinduet er lukket — åbn et nyt
  }
  const created = await chrome.windows.create({
    url,
    type: "popup",
    ...POPUP_WINDOW_SIZE,
    focused: true,
  });
  if (created?.id !== undefined) {
    await windowIdStorage().set({ [WINDOW_ID_KEY]: created.id });
  }
}
