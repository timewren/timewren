// GENERERET af scripts/i18n/build-loader.mjs. Ret ikke i hånden: kør `npm run i18n:build`.
import da from "../messages/da/forms.json";
import en from "../messages/en/forms.json";
import de from "../messages/de/forms.json";
import es from "../messages/es/forms.json";
import sv from "../messages/sv/forms.json";
import nb from "../messages/nb/forms.json";
import fi from "../messages/fi/forms.json";
import nl from "../messages/nl/forms.json";
import fr from "../messages/fr/forms.json";
import it from "../messages/it/forms.json";
import pt from "../messages/pt/forms.json";
import pt_BR from "../messages/pt-BR/forms.json";
import pl from "../messages/pl/forms.json";
import cs from "../messages/cs/forms.json";
import ja from "../messages/ja/forms.json";
import ko from "../messages/ko/forms.json";
import zh_Hans from "../messages/zh-Hans/forms.json";
import tr from "../messages/tr/forms.json";

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
