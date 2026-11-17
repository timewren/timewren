import { createTranslator } from "next-intl";
import { brandize } from "@/i18n/brandize";
import { catalogMessages } from "@/i18n/catalog-messages";
import pdf from "@/i18n/catalogs/pdf";
import {
  FALLBACK_LOCALE,
  isLocale,
  LOCALE_META,
  type Locale,
} from "@/i18n/config";
import { toIntlLocale } from "@/i18n/format-locale";

export type PdfText = (
  key: string,
  values?: Record<string, string | number>,
) => string;

/**
 * Tekster og Intl-sprogkode til fakturaens PDF (både react-pdf og takumi).
 * PDF'en renderes på serveren uden React-kontekst, så oversætteren bygges
 * direkte fra de statiske kataloger. Uden `locale` bliver den dansk, så
 * eksisterende fakturaer er uændrede.
 *
 * Fakturaens indlejrede font (Schibsted Grotesk, latin + latin-ext) har ingen CJK-tegn. Sprog
 * uden `pdf` i registret (ja, ko, zh-Hans) får derfor PDF'en på engelsk, ellers ville hver
 * tekst blive til tomme firkanter. Se docs/i18n/README.md.
 */
export function pdfText(locale?: string | null): {
  t: PdfText;
  intlLocale: string;
} {
  const requested: Locale = isLocale(locale) ? locale : "da";
  const resolved: Locale = LOCALE_META[requested].pdf
    ? requested
    : FALLBACK_LOCALE;
  const t = createTranslator({
    locale: resolved,
    messages: { pdf: brandize(catalogMessages("pdf", pdf, resolved)) },
    namespace: "pdf",
  }) as unknown as PdfText;
  return { t, intlLocale: toIntlLocale(resolved) };
}
