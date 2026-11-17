// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/emailsReports.json";
import en from "../messages/en/emailsReports.json";
import de from "../messages/de/emailsReports.json";
import es from "../messages/es/emailsReports.json";
import sv from "../messages/sv/emailsReports.json";
import nb from "../messages/nb/emailsReports.json";
import fi from "../messages/fi/emailsReports.json";
import nl from "../messages/nl/emailsReports.json";
import fr from "../messages/fr/emailsReports.json";
import it from "../messages/it/emailsReports.json";
import pt from "../messages/pt/emailsReports.json";
import pt_BR from "../messages/pt-BR/emailsReports.json";
import pl from "../messages/pl/emailsReports.json";
import cs from "../messages/cs/emailsReports.json";
import ja from "../messages/ja/emailsReports.json";
import ko from "../messages/ko/emailsReports.json";
import zh_Hans from "../messages/zh-Hans/emailsReports.json";
import tr from "../messages/tr/emailsReports.json";

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
