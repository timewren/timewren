/**
 * Navneområder der kun læses på serveren (tRPC-fejl, mails, eksport, sync-tekster
 * via getT/createTranslator). Ingen klientkomponent bruger dem, så dashboard-
 * og admin-layoutet sender dem ikke med i HTML'en som RSC-payload.
 * Testen client-messages.test.ts fejler, hvis en klientfil begynder at bruge
 * ét af dem.
 */
export const SERVER_ONLY_NAMESPACES = [
  "serverErrors",
  "serverExports",
  "serverMisc",
  "serverSync",
  "emails",
  "emailsAuth",
  "emailsBilling",
  "emailsDrip",
  "emailsReports",
] as const;

const SERVER_ONLY = new Set<string>(SERVER_ONLY_NAMESPACES);

/** Beskeder til <NextIntlClientProvider>: hele kataloget minus serverens egne. */
export function withoutServerNamespaces<T extends Record<string, unknown>>(
  messages: T,
): Partial<T> {
  return Object.fromEntries(
    Object.entries(messages).filter(([ns]) => !SERVER_ONLY.has(ns)),
  ) as Partial<T>;
}
