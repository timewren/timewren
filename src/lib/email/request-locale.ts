import { getLocale } from "next-intl/server";
import { DEFAULT_LOCALE, isAvailableLocale, type Locale } from "@/i18n/config";

/**
 * Sprog til tekster der sendes UD fra en forespørgsel (test-notifikationer,
 * kvitteringer), men ikke har en modtager-profil at slå op: det angivne
 * sprog, ellers forespørgslens sprog (cookie/profil/header), ellers dansk.
 */
export async function resolveOutgoingLocale(
  locale?: string | null,
): Promise<Locale> {
  if (isAvailableLocale(locale)) return locale;
  try {
    const fromRequest = await getLocale();
    if (isAvailableLocale(fromRequest)) return fromRequest;
  } catch {
    // ingen forespørgselskontekst (cron, tests): dansk
  }
  return DEFAULT_LOCALE;
}
