// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/serverSync.json";
import en from "../messages/en/serverSync.json";
import de from "../messages/de/serverSync.json";
import es from "../messages/es/serverSync.json";
import sv from "../messages/sv/serverSync.json";
import nb from "../messages/nb/serverSync.json";
import fi from "../messages/fi/serverSync.json";
import nl from "../messages/nl/serverSync.json";
import fr from "../messages/fr/serverSync.json";
import it from "../messages/it/serverSync.json";
import pt from "../messages/pt/serverSync.json";
import pt_BR from "../messages/pt-BR/serverSync.json";
import pl from "../messages/pl/serverSync.json";
import cs from "../messages/cs/serverSync.json";
import ja from "../messages/ja/serverSync.json";
import ko from "../messages/ko/serverSync.json";
import zh_Hans from "../messages/zh-Hans/serverSync.json";
import tr from "../messages/tr/serverSync.json";

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
