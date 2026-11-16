import { useCallback, useSyncExternalStore } from "react";
import {
  getLocale,
  type Locale,
  type Params,
  subscribeLocale,
  translate,
} from "./core";

export {
  DEFAULT_LOCALE,
  dateFormat,
  detectLocale,
  getLocale,
  isLocale,
  type LanguageSetting,
  LOCALE_META,
  LOCALES,
  type Locale,
  localeOptionLabel,
  numberFormat,
  resolveLanguage,
  setLocale,
  t,
  toIntlLocale,
} from "./core";
export { initLocale } from "./init";
export { renderRich } from "./rich";

/** React-hook: `const { t, locale } = useT()`. Gentegner ved sprogskifte. */
export function useT(): {
  t: (key: string, params?: Params) => string;
  locale: Locale;
} {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, getLocale);
  const t = useCallback(
    (key: string, params?: Params) => translate(locale, key, params),
    [locale],
  );
  return { t, locale };
}
