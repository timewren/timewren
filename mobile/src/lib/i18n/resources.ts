import da from '~/translations/da.json';
import de from '~/translations/de.json';
import en from '~/translations/en.json';
import es from '~/translations/es.json';

export const resources = {
  da: {
    translation: da,
  },
  en: {
    translation: en,
  },
  de: {
    translation: de,
  },
  es: {
    translation: es,
  },
};

export type Language = keyof typeof resources;
