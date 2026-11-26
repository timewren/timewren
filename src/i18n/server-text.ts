import { AsyncLocalStorage } from "node:async_hooks";
import type { BrandId } from "@/lib/brand-id";
import { isMultibrandEnabled, resolveBrandByHost } from "@/lib/brands/registry";
import { registerBrandResolver } from "./brandize";
import {
  DEFAULT_LOCALE,
  isAvailableLocale,
  type Locale,
  pickFromAcceptLanguage,
} from "./config";
import { getT } from "./server";
import { registerLocaleResolver, type TextValues } from "./sync-text";

// `st` bor i sync-text (uden Node-afhængigheder), så klientkode kan bruge den. Her kun for bagudkompatibilitet.
export { st } from "./sync-text";

const localeStore = new AsyncLocalStorage<Locale>();
registerLocaleResolver(() => localeStore.getStore());

// Kaldets brand (hosten), så tRPC-fejl og andre servertekster siger TimeWren
// på timewren.com, selv om buildet er TimeTrack.
const brandStore = new AsyncLocalStorage<BrandId>();
registerBrandResolver(() => brandStore.getStore());

/**
 * Kort vej til en serveroversættelse udenfor React (tRPC-fejl, API-svar, eksport).
 * Sproget er `locale`, ellers tRPC-kaldets sprog, ellers forespørgslens (cookie/profil/header);
 * uden forespørgselskontekst (cron, tests) er det dansk.
 *
 *   throw new TRPCError({ code: "NOT_FOUND", message: await tr("serverErrors", "clients.notFound") });
 */
export async function tr(
  namespace: string,
  key: string,
  values?: TextValues,
  locale?: Locale | string | null,
): Promise<string> {
  const t = await getT(namespace, locale ?? localeStore.getStore());
  return (t as unknown as (k: string, v?: TextValues) => string)(key, values);
}

export function localeFromCookie(
  headers: Headers | null | undefined,
): Locale | undefined {
  const cookie = headers?.get("cookie") ?? "";
  const match = /(?:^|;\s*)locale=([^;]+)/.exec(cookie)?.[1];
  return isAvailableLocale(match) ? match : undefined;
}

/** Sproget fra cookie eller Accept-Language uden databaseopslag. */
export function localeFromHeaders(headers: Headers | null | undefined): Locale {
  if (!headers) return DEFAULT_LOCALE;
  return (
    localeFromCookie(headers) ??
    pickFromAcceptLanguage(headers.get("accept-language")) ??
    DEFAULT_LOCALE
  );
}

/**
 * Brandet for teksterne i et kald ud fra Host-headeren. Kun med multibrand og
 * kun for andre brands end build-brandets standard; ellers undefined, og
 * teksterne er som før.
 */
export function textBrandFromHeaders(
  headers: Headers | null | undefined,
): BrandId | undefined {
  if (!headers || !isMultibrandEnabled()) return undefined;
  const key = resolveBrandByHost(headers.get("host")).key;
  return key === "timetrack" ? undefined : key;
}

/** Kør `fn` med et bestemt brand for teksterne (se textBrandFromHeaders). */
export function runWithBrand<T>(brand: BrandId | undefined, fn: () => T): T {
  return brand ? brandStore.run(brand, fn) : fn();
}

/** Kør `fn` med et bestemt sprog, så `st` og `tr` følger kaldets sprog. */
export function runWithLocale<T>(locale: Locale, fn: () => T): T {
  return localeStore.run(locale, fn);
}

/** Kaldets sprog i tRPC (ellers dansk), til Intl-formatering af datoer og tal. */
export function activeLocale(): Locale {
  return localeStore.getStore() ?? DEFAULT_LOCALE;
}

export type Tx = (key: string, values?: TextValues) => string;

/**
 * Som `getT`, men med løst typet nøgle (strengnøgler bygget ved kørsel, fx pr. tabel).
 * Bruges i eksport og PDF, hvor sproget gives udtrykkeligt.
 */
export async function getTx(
  namespace: string,
  locale?: Locale | string | null,
): Promise<Tx> {
  const t = await getT(namespace, locale ?? localeStore.getStore());
  return t as unknown as Tx;
}
