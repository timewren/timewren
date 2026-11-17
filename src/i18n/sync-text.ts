import { createTranslator } from "next-intl";
import { brandize } from "./brandize";
import { catalogMessages } from "./catalog-messages";
import serverSync from "./catalogs/serverSync";
import { DEFAULT_LOCALE, isLocale, type Locale } from "./config";

export type TextValues = Record<string, string | number | Date>;

let localeResolver: (() => string | undefined) | null = null;

/** Serveren registrerer her kaldets sprog (AsyncLocalStorage), så `syncT` følger det uden parameter. */
export function registerLocaleResolver(fn: () => string | undefined): void {
  localeResolver = fn;
}

/** Sprog uden parameter: serverens kald, ellers browserens html-lang, ellers dansk. */
function ambientLocale(): string | undefined {
  const fromServer = localeResolver?.();
  if (fromServer) return fromServer;
  if (typeof document !== "undefined") {
    return document.documentElement.lang || undefined;
  }
  return undefined;
}

/**
 * Synkron oversættelse fra det lille navneområde `serverSync` (zod-beskeder, tRPC-fejlhjælpere,
 * klientens venlige fejltekster). Kan bruges både på server og i browseren; ingen Node-afhængigheder.
 * Uden sprog: dansk.
 */
export function syncT(
  key: string,
  values?: TextValues,
  locale?: Locale | string | null,
): string {
  const chosen = locale ?? ambientLocale();
  const resolved: Locale = isLocale(chosen) ? chosen : DEFAULT_LOCALE;
  const create = createTranslator as unknown as (opts: {
    locale: string;
    messages: Record<string, unknown>;
    namespace: string;
  }) => (key: string, values?: TextValues) => string;
  const t = create({
    locale: resolved,
    messages: {
      serverSync: brandize(catalogMessages("serverSync", serverSync, resolved)),
    },
    namespace: "serverSync",
  });
  return t(key, values);
}

/** Det sprog `syncT` bruger uden parameter (kaldets, browserens eller dansk). */
export function currentSyncLocale(): Locale {
  const chosen = ambientLocale();
  return isLocale(chosen) ? chosen : DEFAULT_LOCALE;
}

/**
 * Synkron variant af `tr` til zod-skemaer, synkrone hjælpere og delt klient/server-kode. Sproget er
 * kaldets (tRPC, på serveren), ellers browserens `html lang`, ellers dansk.
 */
export function st(key: string, values?: TextValues): string {
  return syncT(key, values);
}
