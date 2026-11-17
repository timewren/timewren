// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/enterpriseReports.json";
import en from "../messages/en/enterpriseReports.json";
import de from "../messages/de/enterpriseReports.json";
import es from "../messages/es/enterpriseReports.json";
import sv from "../messages/sv/enterpriseReports.json";
import nb from "../messages/nb/enterpriseReports.json";
import fi from "../messages/fi/enterpriseReports.json";
import nl from "../messages/nl/enterpriseReports.json";
import fr from "../messages/fr/enterpriseReports.json";
import it from "../messages/it/enterpriseReports.json";
import pt from "../messages/pt/enterpriseReports.json";
import pt_BR from "../messages/pt-BR/enterpriseReports.json";
import pl from "../messages/pl/enterpriseReports.json";
import cs from "../messages/cs/enterpriseReports.json";
import ja from "../messages/ja/enterpriseReports.json";
import ko from "../messages/ko/enterpriseReports.json";
import zh_Hans from "../messages/zh-Hans/enterpriseReports.json";
import tr from "../messages/tr/enterpriseReports.json";

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
