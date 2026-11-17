// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/sharedReports.json";
import en from "../messages/en/sharedReports.json";
import de from "../messages/de/sharedReports.json";
import es from "../messages/es/sharedReports.json";
import sv from "../messages/sv/sharedReports.json";
import nb from "../messages/nb/sharedReports.json";
import fi from "../messages/fi/sharedReports.json";
import nl from "../messages/nl/sharedReports.json";
import fr from "../messages/fr/sharedReports.json";
import it from "../messages/it/sharedReports.json";
import pt from "../messages/pt/sharedReports.json";
import pt_BR from "../messages/pt-BR/sharedReports.json";
import pl from "../messages/pl/sharedReports.json";
import cs from "../messages/cs/sharedReports.json";
import ja from "../messages/ja/sharedReports.json";
import ko from "../messages/ko/sharedReports.json";
import zh_Hans from "../messages/zh-Hans/sharedReports.json";
import tr from "../messages/tr/sharedReports.json";

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
