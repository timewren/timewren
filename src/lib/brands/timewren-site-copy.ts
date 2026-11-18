/**
 * Tekster til TimeWrens marketingsite (src/i18n/timewren-site/*.json).
 *
 * Bruger next-intl's createTranslator direkte i stedet for getRequestConfig:
 * request-konfigurationen læser headers, cookies og DB, hvilket ville gøre
 * siderne dynamiske. Her er sproget givet af URL'en, så siderne kan bygges
 * statisk pr. sprog. Teksterne holdes uden for appens messages/*.json, så de
 * ikke sendes med til klienten i appen.
 *
 * Engelsk er kilden. da/de/es falder tilbage til engelsk for nøgler, de ikke
 * har. Sprogtestene kræver samme nøgler i alle fire kataloger.
 */

import { createTranslator } from "next-intl";
import da from "@/i18n/timewren-site/da.json";
import de from "@/i18n/timewren-site/de.json";
import en from "@/i18n/timewren-site/en.json";
import es from "@/i18n/timewren-site/es.json";
import type { Locale } from "./registry";

export type SiteMessages = typeof en;

type Obj = Record<string, unknown>;

function merge(base: Obj, over: Obj): Obj {
  const out: Obj = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] =
      v &&
      typeof v === "object" &&
      !Array.isArray(v) &&
      b &&
      typeof b === "object" &&
      !Array.isArray(b)
        ? merge(b as Obj, v as Obj)
        : v;
  }
  return out;
}

export const RAW_SITE_MESSAGES: Record<Locale, Obj> = { en, da, de, es };

const cache = new Map<Locale, SiteMessages>();

export function getSiteMessages(locale: Locale): SiteMessages {
  let m = cache.get(locale);
  if (!m) {
    m =
      locale === "en"
        ? en
        : (merge(en, RAW_SITE_MESSAGES[locale]) as SiteMessages);
    cache.set(locale, m);
  }
  return m;
}

export function siteTranslator(locale: Locale) {
  return createTranslator({ locale, messages: getSiteMessages(locale) });
}

/** BCP 47-tag til Intl og <html lang>. */
export const LOCALE_TAGS: Record<Locale, string> = {
  en: "en",
  da: "da-DK",
  de: "de-DE",
  es: "es-ES",
};

/** Repoet og docs. Offentlige adresser fra README, ikke hemmeligheder. */
export const REPO_URL = "https://github.com/timewren/timewren";
export const TRADEMARK_URL = `${REPO_URL}/blob/main/TRADEMARK.md`;
export const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
/** Listen over udgående forbindelser (ingen docs-slug i kontrakten endnu). */
export const TELEMETRY_DOCS_URL = `${REPO_URL}/blob/main/docs/telemetry.md`;

/**
 * Dato for de juridiske tekster (privacy, terms), vist som "Last updated".
 * Ret den, når teksterne i legal.* ændres.
 */
export const LEGAL_LAST_UPDATED = "2026-11-17";
