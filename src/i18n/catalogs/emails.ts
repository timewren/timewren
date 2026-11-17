// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/emails.json";
import en from "../messages/en/emails.json";
import de from "../messages/de/emails.json";
import es from "../messages/es/emails.json";
import sv from "../messages/sv/emails.json";
import nb from "../messages/nb/emails.json";
import fi from "../messages/fi/emails.json";
import nl from "../messages/nl/emails.json";
import fr from "../messages/fr/emails.json";
import it from "../messages/it/emails.json";
import pt from "../messages/pt/emails.json";
import pt_BR from "../messages/pt-BR/emails.json";
import pl from "../messages/pl/emails.json";
import cs from "../messages/cs/emails.json";
import ja from "../messages/ja/emails.json";
import ko from "../messages/ko/emails.json";
import zh_Hans from "../messages/zh-Hans/emails.json";
import tr from "../messages/tr/emails.json";

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
