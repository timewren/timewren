// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/notifications.json";
import en from "../messages/en/notifications.json";
import de from "../messages/de/notifications.json";
import es from "../messages/es/notifications.json";
import sv from "../messages/sv/notifications.json";
import nb from "../messages/nb/notifications.json";
import fi from "../messages/fi/notifications.json";
import nl from "../messages/nl/notifications.json";
import fr from "../messages/fr/notifications.json";
import it from "../messages/it/notifications.json";
import pt from "../messages/pt/notifications.json";
import pt_BR from "../messages/pt-BR/notifications.json";
import pl from "../messages/pl/notifications.json";
import cs from "../messages/cs/notifications.json";
import ja from "../messages/ja/notifications.json";
import ko from "../messages/ko/notifications.json";
import zh_Hans from "../messages/zh-Hans/notifications.json";
import tr from "../messages/tr/notifications.json";

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
