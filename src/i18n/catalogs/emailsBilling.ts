// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/emailsBilling.json";
import en from "../messages/en/emailsBilling.json";
import de from "../messages/de/emailsBilling.json";
import es from "../messages/es/emailsBilling.json";
import sv from "../messages/sv/emailsBilling.json";
import nb from "../messages/nb/emailsBilling.json";
import fi from "../messages/fi/emailsBilling.json";
import nl from "../messages/nl/emailsBilling.json";
import fr from "../messages/fr/emailsBilling.json";
import it from "../messages/it/emailsBilling.json";
import pt from "../messages/pt/emailsBilling.json";
import pt_BR from "../messages/pt-BR/emailsBilling.json";
import pl from "../messages/pl/emailsBilling.json";
import cs from "../messages/cs/emailsBilling.json";
import ja from "../messages/ja/emailsBilling.json";
import ko from "../messages/ko/emailsBilling.json";
import zh_Hans from "../messages/zh-Hans/emailsBilling.json";
import tr from "../messages/tr/emailsBilling.json";

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
