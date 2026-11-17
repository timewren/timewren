// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/pdf.json";
import en from "../messages/en/pdf.json";
import de from "../messages/de/pdf.json";
import es from "../messages/es/pdf.json";
import sv from "../messages/sv/pdf.json";
import nb from "../messages/nb/pdf.json";
import fi from "../messages/fi/pdf.json";
import nl from "../messages/nl/pdf.json";
import fr from "../messages/fr/pdf.json";
import it from "../messages/it/pdf.json";
import pt from "../messages/pt/pdf.json";
import pt_BR from "../messages/pt-BR/pdf.json";
import pl from "../messages/pl/pdf.json";
import cs from "../messages/cs/pdf.json";
import ja from "../messages/ja/pdf.json";
import ko from "../messages/ko/pdf.json";
import zh_Hans from "../messages/zh-Hans/pdf.json";
import tr from "../messages/tr/pdf.json";

import type { Locale } from "../config";

const catalogs: Partial<Record<Locale, Record<string, unknown>>> = {
  "da": da,
  "en": en,
  "de": de,
  "es": es,
  "sv": sv,
  "nb": nb,
  "fi": fi,
  "nl": nl,
  "fr": fr,
  "it": it,
  "pt": pt,
  "pt-BR": pt_BR,
  "pl": pl,
  "cs": cs,
  "ja": ja,
  "ko": ko,
  "zh-Hans": zh_Hans,
  "tr": tr,
};

export default catalogs;
