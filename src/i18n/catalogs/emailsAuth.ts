// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/emailsAuth.json";
import en from "../messages/en/emailsAuth.json";
import de from "../messages/de/emailsAuth.json";
import es from "../messages/es/emailsAuth.json";
import sv from "../messages/sv/emailsAuth.json";
import nb from "../messages/nb/emailsAuth.json";
import fi from "../messages/fi/emailsAuth.json";
import nl from "../messages/nl/emailsAuth.json";
import fr from "../messages/fr/emailsAuth.json";
import it from "../messages/it/emailsAuth.json";
import pt from "../messages/pt/emailsAuth.json";
import pt_BR from "../messages/pt-BR/emailsAuth.json";
import pl from "../messages/pl/emailsAuth.json";
import cs from "../messages/cs/emailsAuth.json";
import ja from "../messages/ja/emailsAuth.json";
import ko from "../messages/ko/emailsAuth.json";
import zh_Hans from "../messages/zh-Hans/emailsAuth.json";
import tr from "../messages/tr/emailsAuth.json";

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
