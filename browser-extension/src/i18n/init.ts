import { resolveLanguage, setLocale } from "./core";

const STORAGE_KEY = "extensionSettings";
let started = false;

function apply(settings: unknown): void {
  const language =
    settings && typeof settings === "object"
      ? (settings as { language?: unknown }).language
      : undefined;
  const locale = resolveLanguage(language);
  setLocale(locale);
  if (typeof document !== "undefined") document.documentElement.lang = locale;
}

/**
 * Henter det gemte sprogvalg (extensionSettings.language i chrome.storage) og
 * følger senere ændringer, så popup, ny fane og baggrund skifter sammen.
 * Uden gemt valg bruges browserens sprog, ellers dansk.
 */
export async function initLocale(): Promise<void> {
  apply(undefined);
  if (typeof chrome === "undefined" || !chrome.storage?.local) return;
  try {
    const result = await chrome.storage.local.get([STORAGE_KEY]);
    apply(result[STORAGE_KEY]);
  } catch {
    // behold browserens sprog
  }
  if (started) return;
  started = true;
  chrome.storage.onChanged?.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE_KEY]) {
      apply(changes[STORAGE_KEY].newValue);
    }
  });
}
