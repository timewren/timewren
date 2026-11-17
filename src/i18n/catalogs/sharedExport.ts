// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/sharedExport.json";
import en from "../messages/en/sharedExport.json";
import de from "../messages/de/sharedExport.json";
import es from "../messages/es/sharedExport.json";
import sv from "../messages/sv/sharedExport.json";
import nb from "../messages/nb/sharedExport.json";
import fi from "../messages/fi/sharedExport.json";
import nl from "../messages/nl/sharedExport.json";
import fr from "../messages/fr/sharedExport.json";
import it from "../messages/it/sharedExport.json";
import pt from "../messages/pt/sharedExport.json";
import pt_BR from "../messages/pt-BR/sharedExport.json";
import pl from "../messages/pl/sharedExport.json";
import cs from "../messages/cs/sharedExport.json";
import ja from "../messages/ja/sharedExport.json";
import ko from "../messages/ko/sharedExport.json";
import zh_Hans from "../messages/zh-Hans/sharedExport.json";
import tr from "../messages/tr/sharedExport.json";

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
