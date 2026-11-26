/**
 * Browserens egen nye fane, når "Åbn TimeTrack på nye faner" er slået fra (#1322).
 *
 * En `chrome_url_overrides.newtab` kan ikke give fanen tilbage til browseren,
 * så siden skal selv sende fanen videre. Det virker kun i Google Chrome:
 * chrome://new-tab-page/ er Chromes rigtige nye fane og er ikke selv overtaget.
 * Edges egen side (edge://newtab) er overtaget af udvidelsen, og Firefox
 * afviser privilegerede about:-adresser fra udvidelser. Dér viser ny fane i
 * stedet en enkel side med søgefelt (NewTabSearch).
 *
 * Browseren afgøres ud fra navigator.userAgentData, så der kræves ingen ekstra
 * tilladelse: chrome.tabs.getCurrent og chrome.tabs.update kræver ikke "tabs".
 */

export const CHROME_NEW_TAB_URL = "chrome://new-tab-page/";

interface NavigatorWithBrands {
  userAgentData?: { brands?: { brand: string }[] };
}

export function nativeNewTabUrl(
  nav: NavigatorWithBrands = navigator as NavigatorWithBrands,
): string | null {
  const isChrome = nav.userAgentData?.brands?.some(
    (b) => b.brand === "Google Chrome",
  );
  return isChrome ? CHROME_NEW_TAB_URL : null;
}

export async function isNewTabDisabled(): Promise<boolean> {
  const result = await chrome.storage.local.get(["extensionSettings"]);
  const settings = result.extensionSettings as
    | { newTabEnabled?: unknown }
    | undefined;
  return settings?.newTabEnabled === false;
}

/** Sender fanen til browserens egen nye fane. false = bliv og vis søgesiden. */
export async function openNativeNewTab(
  nav?: NavigatorWithBrands,
): Promise<boolean> {
  const url = nativeNewTabUrl(nav);
  if (!url) return false;
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) return false;
    await chrome.tabs.update(tab.id, { url });
    return true;
  } catch {
    return false;
  }
}

/**
 * Søger med browserens standardsøgemaskine i netop denne fane. Fanens id sendes
 * med, for Firefox binder ellers CURRENT_TAB til den fane, der er aktiv, når
 * søgetjenesten svarer, og det kan være en anden fane eller et andet vindue.
 * Kendes fanens id ikke, søges der derfor slet ikke.
 * false = søgningen kunne ikke startes (fx ingen standardsøgemaskine).
 */
export async function searchInCurrentTab(text: string): Promise<boolean> {
  try {
    const tab = await chrome.tabs.getCurrent();
    if (tab?.id === undefined) return false;
    await chrome.search.query({ text, tabId: tab.id });
    return true;
  } catch {
    return false;
  }
}

/**
 * Holder styr på, hvilken indsendelse der stadig er aktuel, så et sent svar
 * på en gammel søgning ikke overskriver det, brugeren gør nu.
 */
export function latestOnly() {
  let current = 0;
  return {
    /** Ny indsendelse; den returnerede funktion siger, om den stadig gælder. */
    next() {
      const id = ++current;
      return () => id === current;
    },
    /** Glem alle ventende indsendelser. */
    cancel() {
      current++;
    },
  };
}
