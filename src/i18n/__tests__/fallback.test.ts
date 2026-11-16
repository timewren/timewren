import { describe, expect, it } from "vitest";
import { pdfText } from "@/components/pdf/pdf-text";
import { mailT } from "@/lib/email/locale";
import { LOCALES } from "../config";
import { deepMerge, fallbackFor, withFallback } from "../fallback";
import { loadMessages } from "../messages/load";
import { sharedT } from "../shared-text";
import { staticMessages } from "../static-catalog";
import { syncT } from "../sync-text";

// Beta-sprogene har delvise kataloger: alt, hvad der mangler, læses på engelsk.
const NEW = [
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
] as const;

describe("withFallback", () => {
  it("lægger sproget oven på engelsk, nøgle for nøgle", () => {
    const en = { a: { x: "X", y: "Y" }, b: { z: "Z" } };
    const sv = { a: { x: "Ex" } };
    expect(withFallback("sv", sv, en)).toEqual({
      a: { x: "Ex", y: "Y" },
      b: { z: "Z" },
    });
  });

  it("giver engelsk, når sproget slet ikke har et katalog", () => {
    expect(withFallback("ja", undefined, { a: { x: "X" } })).toEqual({
      a: { x: "X" },
    });
  });

  it("rører ikke dansk: dansk er kilden og har ingen reserve", () => {
    expect(fallbackFor("da")).toBeNull();
    expect(withFallback("da", { a: "da" }, { a: "en", b: "en" })).toEqual({
      a: "da",
    });
    expect(fallbackFor("sv")).toBe("en");
    expect(fallbackFor("de")).toBe("en");
  });

  it("deepMerge ændrer ingen af argumenterne", () => {
    const under = { a: { x: "1" } };
    const over = { a: { y: "2" } };
    deepMerge(under, over);
    expect(under).toEqual({ a: { x: "1" } });
    expect(over).toEqual({ a: { y: "2" } });
  });
});

// Flade nøgler ("ns.a.b") med deres tekst.
function flat(obj: unknown, prefix = "", out = new Map<string, unknown>()) {
  if (obj && typeof obj === "object" && !Array.isArray(obj)) {
    for (const [k, v] of Object.entries(obj)) flat(v, `${prefix}${k}.`, out);
  } else {
    out.set(prefix.slice(0, -1), obj);
  }
  return out;
}

// Nøgler, som (endnu) kun findes på dansk og engelsk: beta-sprogene skal læse dem på engelsk.
const ONLY_DA_EN = {
  namespace: "serverErrors",
  key: "tasks.invalidOrder",
  sync: "tasks.laneDuplicateName",
};

describe("fald-tilbage til engelsk for nøgler, et beta-sprog mangler", () => {
  it("loadMessages har alle engelske nøgler, ingen tomme og engelsk for de manglende", async () => {
    const en = flat(await loadMessages("en"));
    const da = await loadMessages("da");
    expect(en.size).toBeGreaterThan(1000);
    for (const l of NEW) {
      const loaded = await loadMessages(l);
      const m = flat(loaded);
      expect([...m.keys()].sort(), l).toEqual([...en.keys()].sort());
      for (const [k, v] of m) expect(v, `${l}: ${k}`).not.toBe("");
      const ns = loaded[ONLY_DA_EN.namespace] as Record<string, unknown>;
      expect(flat(ns).get(ONLY_DA_EN.key), l).toBe(
        en.get(`${ONLY_DA_EN.namespace}.${ONLY_DA_EN.key}`),
      );
      expect(loaded, l).not.toEqual(da);
    }
  }, 180_000);

  it("static-katalog (mails, PDF, delte hjælpere) har alle engelske nøgler", () => {
    for (const ns of ["pdf", "serverSync"] as const) {
      const en = flat(staticMessages(ns, "en"));
      for (const l of NEW) {
        const m = flat(staticMessages(ns, l));
        expect([...m.keys()].sort(), `${l}/${ns}`).toEqual(
          [...en.keys()].sort(),
        );
      }
    }
  });

  it("mails giver engelsk tekst og aldrig en rå nøgle", () => {
    const en = mailT("emailsAuth", "en");
    for (const l of NEW) {
      const t = mailT("emailsAuth", l);
      // Første nøgle i katalogen, hentet fra det engelske katalog.
      const first = Object.keys(staticMessages("emailsAuth", "en"))[0];
      const sub = Object.keys(
        staticMessages("emailsAuth", "en")[first] as Record<string, unknown>,
      )[0];
      const key = `${first}.${sub}`;
      expect(t(key, {}), l).not.toBe(key);
      expect(t(key, {}), l).not.toBe("");
    }
    expect(en("signupPassword.step1", {})).not.toBe("signupPassword.step1");
  });

  it("syncT og sharedT giver engelsk for en manglende nøgle, aldrig dansk", () => {
    const key = ONLY_DA_EN.sync;
    for (const l of NEW) {
      expect(syncT(key, undefined, l), l).toBe(syncT(key, undefined, "en"));
      expect(syncT(key, undefined, l), l).not.toBe(syncT(key, undefined, "da"));
    }
    const fmtKey = Object.keys(staticMessages("sharedFormat", "en"))[0];
    expect(sharedT("sharedFormat", fmtKey, undefined, "sv")).not.toBe(fmtKey);
  });

  it("et sprog, der kun har en del af kataloget, læser resten på engelsk", () => {
    // Samme sammensætning som static-catalog/loadMessages bruger, med et syntetisk delvist katalog.
    const en = staticMessages("pdf", "en");
    const [firstKey, secondKey] = Object.keys(en);
    const partial = { [firstKey]: "OVERSAT" };
    const merged = withFallback("pl", partial, en);
    expect(merged[firstKey]).toBe("OVERSAT");
    expect(merged[secondKey]).toBe(en[secondKey]);
  });

  it("de og es er uændrede (de har fuldt katalog)", () => {
    expect(mailT("emailsAuth", "de")).toBeTypeOf("function");
    expect(syncT("friendly.server", undefined, "de")).not.toBe(
      syncT("friendly.server", undefined, "en"),
    );
  });
});

describe("faktura-PDF", () => {
  it("bruger sprogets egne tegn for latinske sprog", () => {
    const { intlLocale } = pdfText("pl");
    expect(intlLocale).toBe("pl-PL");
    expect(pdfText("tr").intlLocale).toBe("tr-TR");
  });

  it("falder tilbage til engelsk for ja, ko og zh-Hans (fonten har ingen CJK-tegn)", () => {
    for (const l of ["ja", "ko", "zh-Hans"]) {
      const { t, intlLocale } = pdfText(l);
      expect(intlLocale, l).toBe("en-GB");
      expect(t("invoice"), l).toBe("Invoice");
    }
  });

  it("er uændret for da og ukendt sprog (dansk)", () => {
    expect(pdfText().t("invoice")).toBe("Faktura");
    expect(pdfText("xx").t("invoice")).toBe("Faktura");
  });

  it("alle registrerede sprog giver en oversætter", () => {
    for (const l of LOCALES) expect(pdfText(l).t("invoice")).toBeTruthy();
  });
});
