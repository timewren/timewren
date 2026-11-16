/**
 * Test setup: initialize i18n before tests run.
 * This ensures format.ts, calendar.ts etc. can call i18n.t() in tests.
 */
import i18n from "i18next";
import da from "@/locales/da.json";
import en from "@/locales/en.json";

i18n.init({
  resources: {
    da: { translation: da },
    en: { translation: en },
  },
  lng: "da",
  fallbackLng: "da",
  interpolation: { escapeValue: false },
});

// jsdom implements neither scrolling nor focus movement, so components that
// keep the keyboard cursor in view would throw on a missing method instead of
// exercising their own logic.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

// cmdk (kommandopaletten) observerer sit element i en effekt og kaster
// "ResizeObserver is not defined" i jsdom, som ikke implementerer den.
// Uden denne fejler enhver test, der faktisk åbner paletten.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
