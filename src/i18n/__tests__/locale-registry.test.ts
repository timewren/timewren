import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  availableLocales,
  COMPLETE_LOCALES,
  isAvailableLocale,
  isLocale,
  LOCALE_META,
  LOCALE_NAMES,
  LOCALES,
  localeOptionLabel,
  matchLocale,
  pickFromAcceptLanguage,
} from "../config";
import { toIntlLocale } from "../format-locale";

// The extension is outside the Docker build context, so `next build` cannot
// resolve a static import of it. A runtime path keeps the check in Vitest only.
const extCorePath = "../../../browser-extension/src/i18n/core";
const { LOCALES: EXT_LOCALES, LOCALE_META: EXT_META } = (await import(
  extCorePath
)) as {
  LOCALES: readonly string[];
  LOCALE_META: Record<string, unknown>;
};

const cfg = JSON.parse(
  readFileSync(join(process.cwd(), "scripts/i18n/catalogs.json"), "utf8"),
);

describe("sprogregistret", () => {
  it("indeholder de 18 sprog", () => {
    expect([...LOCALES]).toEqual([
      "da",
      "en",
      "de",
      "es",
      "sv",
      "nb",
      "fi",
      "nl",
      "fr",
      "it",
      "pt",
      "pt-BR",
      "pl",
      "cs",
      "ja",
      "ko",
      "zh-Hans",
      "tr",
    ]);
  });

  it("er det samme i scripts/i18n/catalogs.json", () => {
    expect(cfg.locales).toEqual([...LOCALES]);
    expect(cfg.complete).toEqual([...COMPLETE_LOCALES]);
    for (const l of LOCALES) {
      expect(cfg.chrome[l], l).toBe(LOCALE_META[l].chrome);
      expect(cfg.intl[l], l).toBe(LOCALE_META[l].intl);
    }
  });

  it("er det samme i browserudvidelsen", () => {
    expect([...EXT_LOCALES]).toEqual([...LOCALES]);
    for (const l of LOCALES) {
      expect(EXT_META[l], l).toMatchObject({
        name: LOCALE_META[l].name,
        intl: LOCALE_META[l].intl,
        chrome: LOCALE_META[l].chrome,
        beta: LOCALE_META[l].beta,
      });
    }
  });

  it("mapper til Chromes _locales-koder uden kollisioner", () => {
    const chrome = LOCALES.map((l) => LOCALE_META[l].chrome);
    expect(new Set(chrome).size).toBe(chrome.length);
    expect(LOCALE_META["pt-BR"].chrome).toBe("pt_BR");
    expect(LOCALE_META.pt.chrome).toBe("pt_PT");
    expect(LOCALE_META["zh-Hans"].chrome).toBe("zh_CN");
    // Chrome-mapperne i kilden skal være kendte koder.
    const dirs = readdirSync(join(process.cwd(), "browser-extension/_locales"));
    for (const d of dirs) expect(chrome).toContain(d);
  });

  it("har endonymer, og beta-mærke på alt andet end da og en", () => {
    expect(LOCALE_NAMES).toMatchObject({
      sv: "Svenska",
      nb: "Norsk bokmål",
      fi: "Suomi",
      nl: "Nederlands",
      fr: "Français",
      it: "Italiano",
      pt: "Português",
      "pt-BR": "Português (Brasil)",
      pl: "Polski",
      cs: "Čeština",
      ja: "日本語",
      ko: "한국어",
      "zh-Hans": "简体中文",
      tr: "Türkçe",
    });
    // Ingen sprog er beta (Mads 10/11-26), så etiketten er bare navnet.
    for (const l of LOCALES) {
      expect(localeOptionLabel(l), l).toBe(LOCALE_NAMES[l]);
    }
  });

  it("giver gyldige Intl-koder, der kan formatere", () => {
    for (const l of LOCALES) {
      const tag = toIntlLocale(l);
      expect(() => new Intl.NumberFormat(tag).format(1234.5), l).not.toThrow();
      expect(Intl.DateTimeFormat.supportedLocalesOf(tag).length, l).toBe(1);
    }
    expect(toIntlLocale("ukendt")).toBe("da-DK");
  });

  it("isLocale afviser alt udenfor registret (også prototype-nøgler)", () => {
    expect(isLocale("pt-BR")).toBe(true);
    expect(isLocale("pt_BR")).toBe(false);
    expect(isLocale("toString")).toBe(false);
    expect(isLocale("__proto__")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("matchLocale og Accept-Language", () => {
  it("skelner portugisisk, kinesisk og norsk", () => {
    expect(matchLocale("pt-PT")).toBe("pt");
    expect(matchLocale("pt")).toBe("pt");
    expect(matchLocale("pt-BR")).toBe("pt-BR");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-Hans");
    expect(matchLocale("zh-TW")).toBeNull();
    expect(matchLocale("no")).toBe("nb");
    expect(matchLocale("nn")).toBe("nb");
  });

  it("vælger efter q-værdi og springer ukendte sprog over", () => {
    expect(
      pickFromAcceptLanguage("ru;q=0.9, sv;q=0.8, en;q=0.7", "timewren"),
    ).toBe("sv");
    expect(pickFromAcceptLanguage("en;q=0.5, ja;q=0.9", "timewren")).toBe("ja");
    expect(pickFromAcceptLanguage("pt-BR,pt;q=0.9", "timewren")).toBe("pt-BR");
    expect(pickFromAcceptLanguage("ru, *;q=0.5", "timewren")).toBeNull();
    expect(pickFromAcceptLanguage(null)).toBeNull();
  });
});

describe("brand: sprog der vises", () => {
  it("TimeTrack Cloud viser som i dag kun da, en, de og es", () => {
    expect(availableLocales("timetrack")).toEqual(["da", "en", "de", "es"]);
    expect(isAvailableLocale("sv", "timetrack")).toBe(false);
    expect(isAvailableLocale("de", "timetrack")).toBe(true);
  });

  it("TimeWren viser alle 18", () => {
    expect(availableLocales("timewren")).toEqual([...LOCALES]);
    expect(isAvailableLocale("zh-Hans", "timewren")).toBe(true);
  });

  it("Accept-Language på TimeTrack Cloud giver aldrig et nyt sprog", () => {
    expect(pickFromAcceptLanguage("sv, de;q=0.5", "timetrack")).toBe("de");
    expect(pickFromAcceptLanguage("sv, ja", "timetrack")).toBeNull();
  });

  it("brandet vælges af NEXT_PUBLIC_BRAND (testmiljøet er timetrack)", () => {
    expect(availableLocales()).toEqual(["da", "en", "de", "es"]);
  });
});
