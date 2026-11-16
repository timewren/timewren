import { createTranslator } from "next-intl";
import { brandize } from "@/i18n/brandize";
import { DEFAULT_LOCALE, isAvailableLocale, type Locale } from "@/i18n/config";
import { toIntlLocale } from "@/i18n/format-locale";
import { staticMessages } from "@/i18n/static-catalog";
import type { BrandId } from "@/lib/brand-id";

const MAIL_NAMESPACES = [
  "emails",
  "emailsAuth",
  "emailsBilling",
  "emailsDrip",
  "emailsReports",
  "notifications",
] as const;

/**
 * Mails renderes synkront (React Email), så mailkataloget læses statisk (static-catalog) i
 * stedet for via den asynkrone `loadMessages`. Nye mail-navneområder tilføjes her og i
 * `staticNamespaces` i scripts/i18n/catalogs.json. Manglende nøgler læses på engelsk.
 */
function mailMessages(locale: Locale): Record<string, unknown> {
  return Object.fromEntries(
    MAIL_NAMESPACES.map((ns) => [ns, staticMessages(ns, locale)]),
  );
}

export type MailLocale = Locale;

/** Gyldigt sprog eller dansk. */
export function normalizeMailLocale(value: unknown): Locale {
  return isAvailableLocale(value) ? value : DEFAULT_LOCALE;
}

/**
 * Synkron oversætter til mailskabeloner og emnelinjer.
 *
 *   const t = mailT("emailsAuth", locale);
 *   t("welcome.heading", { name })
 *
 * `brandId` (multibrand): produktnavnet i teksterne følger modtagerens brand i
 * stedet for build-brandet.
 */
export function mailT(
  namespace: string,
  locale?: string | null,
  brandId?: BrandId,
) {
  const resolved = normalizeMailLocale(locale);
  return createTranslator({
    locale: resolved,
    messages: brandize(mailMessages(resolved), brandId) as never,
    namespace: namespace as never,
  }) as unknown as (
    key: string,
    values?: Record<string, string | number | Date>,
  ) => string;
}

/** Timer som i UI'et: højst to decimaler efter sprogets regler ("7,5" / "7.5"). */
export function formatMailHours(hours: number, locale?: string | null): string {
  return new Intl.NumberFormat(toIntlLocale(normalizeMailLocale(locale)), {
    maximumFractionDigits: 2,
  }).format(hours);
}

/**
 * "27. aug. 2026", "27. aug. – 29. aug. 2026" eller "fra 27. aug. 2026" (åben)
 * i modtagerens sprog. Samme form som `formatAbsencePeriod`.
 */
export function formatMailPeriod(
  startDate: string,
  endDate: string | null | undefined,
  locale?: string | null,
): string {
  const resolved = normalizeMailLocale(locale);
  const t = mailT("notifications", resolved);
  const fmt = (dateStr: string) => {
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(toIntlLocale(resolved), {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };
  if (!endDate) return t("periodFrom", { date: fmt(startDate) });
  if (endDate === startDate) return fmt(startDate);
  return t("periodRange", { start: fmt(startDate), end: fmt(endDate) });
}
