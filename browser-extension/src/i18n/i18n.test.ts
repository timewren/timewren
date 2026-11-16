import { readdirSync, readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  catalogs,
  DEFAULT_LOCALE,
  LOCALE_META,
  LOCALES,
  matchLocale,
  setLocale,
  t,
  translate,
} from "./core";

afterEach(() => setLocale(DEFAULT_LOCALE));

describe("t()", () => {
  it("bruger dansk som standard", () => {
    expect(t("errors.noConnection")).toBe("Ingen forbindelse. Prøv igen.");
  });

  it("skifter sprog", () => {
    setLocale("en");
    expect(t("errors.noConnection")).toBe("No connection. Try again.");
    setLocale("de");
    expect(t("errors.noConnection")).toContain("Verbindung");
  });

  it("manglende nøgle giver nøglen selv", () => {
    expect(t("findes.ikke")).toBe("findes.ikke");
  });

  it("indsætter pladsholdere", () => {
    expect(
      t("errors.timer.cancelStoppingElsewhere", { source: "webapp" }),
    ).toBe("Timer stoppes allerede fra webapp");
    expect(t("errors.timer.cancelStoppingElsewhere")).toContain("{source}");
  });

  it("vælger plural efter sprogets regler", () => {
    catalogs.da["test.n"] = "{count, plural, one {# kunde} other {# kunder}}";
    catalogs.en["test.n"] =
      "{count, plural, =0 {none} one {# client} other {# clients}}";
    try {
      expect(translate("da", "test.n", { count: 1 })).toBe("1 kunde");
      expect(translate("da", "test.n", { count: 3 })).toBe("3 kunder");
      expect(translate("en", "test.n", { count: 0 })).toBe("none");
      expect(translate("en", "test.n", { count: 1 })).toBe("1 client");
    } finally {
      delete catalogs.da["test.n"];
      delete catalogs.en["test.n"];
    }
  });
});

describe("matchLocale", () => {
  it("læser sprogkoder med region", () => {
    expect(matchLocale("de-AT")).toBe("de");
    expect(matchLocale("es_MX")).toBe("es");
    expect(matchLocale("en-GB")).toBe("en");
    expect(matchLocale("fr-CA")).toBe("fr");
    expect(matchLocale("ru-RU")).toBeNull();
    expect(matchLocale(undefined)).toBeNull();
  });

  it("skelner portugisisk, kinesisk og norsk", () => {
    expect(matchLocale("pt-PT")).toBe("pt");
    expect(matchLocale("pt")).toBe("pt");
    expect(matchLocale("pt_BR")).toBe("pt-BR");
    expect(matchLocale("zh-CN")).toBe("zh-Hans");
    expect(matchLocale("zh-Hans-SG")).toBe("zh-Hans");
    expect(matchLocale("zh-TW")).toBeNull();
    expect(matchLocale("zh-Hant")).toBeNull();
    expect(matchLocale("no")).toBe("nb");
    expect(matchLocale("nn-NO")).toBe("nb");
  });
});

describe("fald-tilbage for beta-sprog", () => {
  it("læser engelsk, aldrig dansk, når et sprog mangler nøglen", () => {
    const key = "test.kunDaOgEn";
    catalogs.da[key] = "Kun på dansk";
    catalogs.en[key] = "Only in English";
    try {
      for (const l of ["sv", "pt-BR", "zh-Hans", "ja"] as const) {
        expect(translate(l, key), l).toBe("Only in English");
      }
      expect(translate("da", key)).toBe("Kun på dansk");
    } finally {
      delete catalogs.da[key];
      delete catalogs.en[key];
    }
  });

  it("giver nøglen selv, når ingen af dem har den", () => {
    expect(translate("sv", "findes.slet.ikke")).toBe("findes.slet.ikke");
  });

  it("bruger sprogets egen tekst, når den findes", () => {
    const key = "test.sv";
    catalogs.en[key] = "English";
    catalogs.sv[key] = "Svenska";
    try {
      expect(translate("sv", key)).toBe("Svenska");
    } finally {
      delete catalogs.en[key];
      delete catalogs.sv[key];
    }
  });
});

describe("kataloger", () => {
  const names = (s: string) =>
    [...s.matchAll(/\{\s*([A-Za-z_]\w*)\s*[,}]/g)]
      .map((m) => m[1])
      .sort()
      .join(",");

  it("har samme nøgler og pladsholdere i da og en", () => {
    const base = catalogs.da;
    expect(Object.keys(base).length).toBeGreaterThan(0);
    expect(Object.keys(catalogs.en).sort()).toEqual(Object.keys(base).sort());
  });

  it("har aldrig ukendte nøgler eller forkerte pladsholdere i øvrige sprog (delvise kataloger er tilladt)", () => {
    for (const locale of LOCALES) {
      for (const [key, text] of Object.entries(catalogs[locale])) {
        expect(
          catalogs.da,
          `${locale}:${key} findes ikke i dansk`,
        ).toHaveProperty([key]);
        expect(text.trim(), `${locale}:${key}`).not.toBe("");
        expect(names(text), `${locale}:${key}`).toBe(names(catalogs.da[key]));
      }
    }
  });

  it("har chrome-oversættelser til manifestet i alle sprog med mappe, med de samme nøgler som dansk", async () => {
    const root = new URL("../../_locales/", import.meta.url);
    const allowed = new Set(LOCALES.map((l) => LOCALE_META[l].chrome));
    const dirs = readdirSync(root);
    for (const d of dirs) expect(allowed.has(d as never), d).toBe(true);
    for (const required of ["da", "en", "de", "es"]) {
      expect(dirs).toContain(required);
    }
    const keys = (l: string) =>
      Object.keys(
        JSON.parse(readFileSync(new URL(`${l}/messages.json`, root), "utf8")),
      ).sort();
    // Chrome falder selv tilbage til default_locale (da), så hver mappe skal være fuldstændig.
    for (const l of dirs) expect(keys(l), l).toEqual(keys("da"));
  });
});
