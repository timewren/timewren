// @vitest-environment node
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOCALE_META, LOCALES } from "@/i18n/config";
import { pdfFonts } from "./fonts";

// fontkit følger med @react-pdf/renderer og bruges her kun til at læse fontens tegntabel.
const fontkit = createRequire(import.meta.url)("fontkit") as {
  create: (b: Buffer) => { hasGlyphForCodePoint: (cp: number) => boolean };
};
const fonts = pdfFonts().map((f) => fontkit.create(Buffer.from(f.data)));
const covers = (text: string) =>
  [...text]
    .filter((ch) => !/\s/.test(ch))
    .filter(
      (ch) =>
        !fonts.every((f) =>
          f.hasGlyphForCodePoint(ch.codePointAt(0) as number),
        ),
    );

// Tegn, hver skriftlig norm bruger ud over a-z (de latinske sprog), til at bevise at fonten kan sætte dem.
const SPECIAL: Record<string, string> = {
  da: "æøåÆØÅ",
  de: "äöüßÄÖÜ",
  es: "áéíóúñ¿¡ÁÉÍÓÚÑ",
  sv: "åäöÅÄÖ",
  nb: "æøåÆØÅ",
  fi: "äöåÄÖÅšž",
  nl: "ëïéèÉ",
  fr: "àâçéèêëîïôœùûüÿÀÉÇŒ«»",
  it: "àèéìòùÀÈÉ",
  pt: "ãõáâàçéêíóôúÃÕÇ",
  "pt-BR": "ãõáâàçéêíóôúÃÕÇ",
  pl: "ąćęłńóśźżĄĆĘŁŃÓŚŹŻ",
  cs: "áčďéěíňóřšťúůýžÁČĎÉĚÍŇÓŘŠŤÚŮÝŽ",
  tr: "çğıİöşüÇĞÖŞÜ",
};

describe("faktura-PDF'ens indlejrede font", () => {
  it("kan sætte alle særlige tegn i de latinske sprog", () => {
    for (const l of LOCALES.filter((x) => LOCALE_META[x].pdf)) {
      expect(covers(SPECIAL[l] ?? ""), l).toEqual([]);
    }
  });

  it("har ingen CJK-tegn, så ja, ko og zh-Hans bevidst er markeret pdf:false", () => {
    const sample: Record<string, string> = {
      ja: "請求書日本語",
      ko: "청구서한국어",
      "zh-Hans": "发票简体中文",
    };
    for (const l of LOCALES.filter((x) => !LOCALE_META[x].pdf)) {
      expect(covers(sample[l]).length, l).toBeGreaterThan(0);
    }
    // Hvis fonten en dag får CJK-tegn, skal flaget rettes: testen fejler så.
    expect(LOCALES.filter((x) => !LOCALE_META[x].pdf)).toEqual([
      "ja",
      "ko",
      "zh-Hans",
    ]);
  });

  it("dækker alle tegn i de PDF-kataloger, der findes", () => {
    for (const l of LOCALES.filter((x) => LOCALE_META[x].pdf)) {
      let text: string;
      try {
        text = readFileSync(
          join(process.cwd(), `src/i18n/messages/${l}/pdf.json`),
          "utf8",
        );
      } catch {
        continue; // beta-sprog uden katalog endnu: falder tilbage til engelsk
      }
      expect(covers(text), l).toEqual([]);
    }
  });
});
