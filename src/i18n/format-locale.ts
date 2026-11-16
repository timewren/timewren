import { DEFAULT_LOCALE, isLocale, LOCALE_META } from "./config";

// BCP 47-sprogkoder til Intl.* og toLocaleDateString (registret: config.ts). Brug dem i stedet for "da-DK".
export function toIntlLocale(locale: string): string {
  return LOCALE_META[isLocale(locale) ? locale : DEFAULT_LOCALE].intl;
}
