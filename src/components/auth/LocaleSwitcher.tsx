"use client";

import { Globe } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  availableLocales,
  type Locale,
  localeOptionLabel,
} from "@/i18n/config";

/**
 * Sprogvælger til sider uden for dashboardet (login, registrering). Gemmer
 * valget i cookien `locale` (1 år) og genindlæser, så serveren renderer på
 * det nye sprog. Indloggede brugere vælger sprog under Indstillinger.
 */
export function LocaleSwitcher({ className = "" }: { className?: string }) {
  const t = useTranslations("auth.language");
  const locale = useLocale();

  function change(next: string) {
    // biome-ignore lint/suspicious/noDocumentCookie: samme cookie som indstillingerne sætter; Cookie Store API mangler i Safari
    document.cookie = `locale=${next}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.location.reload();
  }

  return (
    <label
      className={`inline-flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-400 ${className}`}
    >
      <Globe className="h-4 w-4" aria-hidden="true" />
      <span className="sr-only">{t("label")}</span>
      <select
        value={locale}
        onChange={(e) => change(e.target.value)}
        className="rounded-md border border-gray-300 bg-white py-1 pl-2 pr-6 text-sm text-gray-700 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/20 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-200"
      >
        {availableLocales().map((code: Locale) => (
          <option key={code} value={code} lang={code}>
            {localeOptionLabel(code)}
          </option>
        ))}
      </select>
    </label>
  );
}
