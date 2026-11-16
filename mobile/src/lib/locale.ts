import type { Locale } from 'date-fns';
import { da, de, es } from 'date-fns/locale';
import i18n from 'i18next';

/**
 * Sprogets Intl-kode og date-fns-locale til tal, datoer og sortering.
 * Dansk er kildesprog; engelsk beholder dansk talformat (appen er til danske
 * freelancere), mens tysk og spansk følger deres eget sprog.
 */
type FormatLanguage = 'da' | 'de' | 'es';

function formatLanguage(): FormatLanguage {
  const code = (i18n.language ?? 'da').slice(0, 2);
  return code === 'de' || code === 'es' ? code : 'da';
}

const INTL_LOCALES: Record<FormatLanguage, string> = {
  da: 'da-DK',
  de: 'de-DE',
  es: 'es-ES',
};

const DATE_FNS_LOCALES: Record<FormatLanguage, Locale> = { da, de, es };

/** Intl-kode til `toLocaleString`, `localeCompare` og `toLocaleLowerCase`. */
export function intlLocale(): string {
  return INTL_LOCALES[formatLanguage()];
}

/** date-fns-locale til ugedage, måneder og relative tider. */
export function dateFnsLocale(): Locale {
  return DATE_FNS_LOCALES[formatLanguage()];
}

type Words = {
  week: string;
  today: string;
  yesterday: string;
  hourUnit: string;
  day: string;
  days: string;
  ago: (distance: string) => string;
};

const WORDS: Record<FormatLanguage, Words> = {
  da: { week: 'Uge', today: 'I dag', yesterday: 'I går', hourUnit: 't', day: 'dag', days: 'dage', ago: d => `for ${d} siden` },
  de: { week: 'Woche', today: 'Heute', yesterday: 'Gestern', hourUnit: 'Std.', day: 'Tag', days: 'Tage', ago: d => `vor ${d}` },
  es: { week: 'Semana', today: 'Hoy', yesterday: 'Ayer', hourUnit: 'h', day: 'día', days: 'días', ago: d => `hace ${d}` },
};

/** De få faste ord i formaterede tekster ("Uge 36", "I dag", "2 dage", "for 3 min. siden"). */
export function formatWords(): Words {
  return WORDS[formatLanguage()];
}

/** Timeenhed pr. sprog: dansk 't', tysk 'Std.', engelsk og spansk 'h'. */
export function hourUnit(): string {
  return (i18n.language ?? 'da').startsWith('en') ? 'h' : formatWords().hourUnit;
}
