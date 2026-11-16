import { headers } from "next/headers";
import { createTranslator } from "next-intl";
import { getLocale } from "next-intl/server";
import type { BrandId } from "@/lib/brand-id";
import { isMultibrandEnabled, resolveBrandByHost } from "@/lib/brands/registry";
import { ambientBrandId, brandize, currentBrandId } from "./brandize";
import { DEFAULT_LOCALE, isAvailableLocale, type Locale } from "./config";
import { loadMessages } from "./messages/load";

/**
 * Oversætter til brug udenfor React (tRPC-fejl, mails, PDF, eksport, cron).
 *
 * - Med `locale`: bruges direkte (fx modtagerens sprog i en mail).
 * - Uden `locale`: sproget fra den aktuelle forespørgsel (cookie, profil, header).
 * - Uden forespørgselskontekst (cron, tests, scripts): dansk, så eksisterende tekster og tests er uændrede.
 *
 *   const t = await getT("<navneområde>");
 *   throw new TRPCError({ code: "NOT_FOUND", message: t("<nøgle>") });
 */
export async function getT(namespace: string, locale?: Locale | string | null) {
  let resolved: Locale = DEFAULT_LOCALE;
  let brandId = currentBrandId();
  if (isAvailableLocale(locale)) {
    resolved = locale;
  } else if (locale == null) {
    try {
      const fromRequest = await getLocale();
      if (isAvailableLocale(fromRequest)) resolved = fromRequest;
    } catch {
      // ingen forespørgselskontekst: dansk
    }
    // Forespørgslen læses allerede (sproget): brug også dens host.
    brandId = await requestBrandId();
  }
  const messages = await loadMessages(resolved);
  return createTranslator({
    locale: resolved,
    messages: brandize(messages, brandId),
    namespace,
  });
}

/**
 * Brandet for tekster i den aktuelle forespørgsel: kaldets (tRPC), ellers
 * hostens med multibrand (TimeWren på timewren.com), ellers build-brandet.
 * Kun til kode, der allerede læser forespørgslen; uden én er det build-brandet.
 */
async function requestBrandId(): Promise<BrandId> {
  const ambient = ambientBrandId();
  if (ambient) return ambient;
  if (isMultibrandEnabled()) {
    try {
      const key = resolveBrandByHost((await headers()).get("host")).key;
      if (key !== "timetrack") return key;
    } catch {
      // ingen forespørgselskontekst
    }
  }
  return currentBrandId();
}

/**
 * Kun de navneområder en klientkomponent bruger, til <NextIntlClientProvider messages={...}>
 * på sider uden for dashboardet, så offentlige sider ikke sender hele kataloget.
 */
export async function getClientMessages(...namespaces: string[]) {
  const locale = await getLocale();
  const all = brandize(
    await loadMessages(isAvailableLocale(locale) ? locale : DEFAULT_LOCALE),
    await requestBrandId(),
  );
  return Object.fromEntries(
    namespaces.filter((ns) => ns in all).map((ns) => [ns, all[ns]]),
  );
}
