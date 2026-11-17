// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/emailsDrip.json";
import en from "../messages/en/emailsDrip.json";
import de from "../messages/de/emailsDrip.json";
import es from "../messages/es/emailsDrip.json";
import sv from "../messages/sv/emailsDrip.json";
import nb from "../messages/nb/emailsDrip.json";
import fi from "../messages/fi/emailsDrip.json";
import nl from "../messages/nl/emailsDrip.json";
import fr from "../messages/fr/emailsDrip.json";
import it from "../messages/it/emailsDrip.json";
import pt from "../messages/pt/emailsDrip.json";
import pt_BR from "../messages/pt-BR/emailsDrip.json";
import pl from "../messages/pl/emailsDrip.json";
import cs from "../messages/cs/emailsDrip.json";
import ja from "../messages/ja/emailsDrip.json";
import ko from "../messages/ko/emailsDrip.json";
import zh_Hans from "../messages/zh-Hans/emailsDrip.json";
import tr from "../messages/tr/emailsDrip.json";

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
