/* eslint-disable react-refresh/only-export-components */
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { I18nManager } from 'react-native';

import { brandVariables } from './brand-variables';
import { resources } from './resources';
import { getLanguage } from './utils';

export * from './utils';

// Dansk-first: gemt sprogvalg > enhedens sprog (hvis understøttet) > dansk
const deviceLanguage = getLocales()[0]?.languageCode;
const defaultLanguage
  = deviceLanguage && deviceLanguage in resources ? deviceLanguage : 'da';

i18n.use(initReactI18next).init({
  resources,
  lng: getLanguage() || defaultLanguage,
  fallbackLng: 'en',

  // allows integrating dynamic values into translations.
  interpolation: {
    escapeValue: false, // escape passed in values to avoid XSS injections
    // {{appName}}, {{site}} og {{webHost}} er brandets navn, website og serverens webadresse.
    defaultVariables: brandVariables(),
  },
});

// Is it a RTL language? (da/en er begge LTR - beholdt så UI-komponenterne virker uændret)
export const isRTL: boolean = i18n.dir() === 'rtl';

I18nManager.allowRTL(isRTL);
I18nManager.forceRTL(isRTL);

export default i18n;
