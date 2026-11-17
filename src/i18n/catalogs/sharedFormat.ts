// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/sharedFormat.json";
import en from "../messages/en/sharedFormat.json";
import de from "../messages/de/sharedFormat.json";
import es from "../messages/es/sharedFormat.json";
import sv from "../messages/sv/sharedFormat.json";
import nb from "../messages/nb/sharedFormat.json";
import fi from "../messages/fi/sharedFormat.json";
import nl from "../messages/nl/sharedFormat.json";
import fr from "../messages/fr/sharedFormat.json";
import it from "../messages/it/sharedFormat.json";
import pt from "../messages/pt/sharedFormat.json";
import pt_BR from "../messages/pt-BR/sharedFormat.json";
import pl from "../messages/pl/sharedFormat.json";
import cs from "../messages/cs/sharedFormat.json";
import ja from "../messages/ja/sharedFormat.json";
import ko from "../messages/ko/sharedFormat.json";
import zh_Hans from "../messages/zh-Hans/sharedFormat.json";
import tr from "../messages/tr/sharedFormat.json";

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
