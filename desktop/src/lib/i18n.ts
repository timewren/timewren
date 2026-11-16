import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import es from "@/locales/es.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

i18n.use(initReactI18next).init({
  resources: {
    da: { translation: da },
    en: { translation: en },
    sv: { translation: sv },
    nb: { translation: nb },
    de: { translation: de },
    es: { translation: es },
  },
  lng: "da",
  fallbackLng: "da",
  interpolation: { escapeValue: false },
});

export default i18n;
