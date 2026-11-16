import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";
import { Dialog } from "../Dialog";

/**
 * `Dialog` er den eneste dialog bygget på hele `role="dialog"`-fladen, og den
 * bruges af ~30 komponenter. Det gør dens ene `aria-label` til den streng med
 * størst rækkevidde i appen: den er det eneste en skærmlæser-læser hører, når
 * de tabulerer ud af en vilkårlig dialog, og den lå i markup'en som dansk.
 *
 * En `aria-label` er *ikke* synlig tekst, så `getByText` kan ikke finde den og
 * ingen af portene dømmer den — derfor dømmes det tilgængelige navn, som er det
 * brugeren faktisk hører.
 */
const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (typeof node !== "object" || node === null) return out;
  for (const [key, value] of Object.entries(node)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "object" && value !== null) {
      for (const [k, v] of flatten(value, full)) out.set(k, v);
    } else {
      out.set(full, String(value));
    }
  }
  return out;
}

const TABLES = Object.fromEntries(
  Object.entries(LANGS).map(([lang, json]) => [lang, flatten(json)]),
) as Record<Lang, Map<string, string>>;

function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const LUK = "common.closeDialog";

function aabn(title = "Rediger registrering") {
  render(
    <Dialog open onClose={() => {}} title={title}>
      <p>Indhold</p>
    </Dialog>,
  );
  return screen.getByRole("dialog");
}

function lukKnappen(lang: Lang) {
  return screen.getByRole("button", { name: value(lang, LUK) });
}

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("Dialogens luk-knap følger appens sprog", () => {
  it("har et tilgængeligt navn i alle 5 sprog", async () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med dansk,
    // og skærmen ser rigtig ud. Derfor dømmes json'en direkte — en nøgle der
    // mangler i et sprog har her en tom værdi, og testen stopper med det.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      aabn();

      expect(value(lang, LUK), `${lang}:${LUK}`).not.toBe("");
      // Navnet skal være *kun* luk-knappens, ellers hører skærmlæseren det
      // samme ord to gange i samme dialog.
      expect(lukKnappen(lang), lang).toBeTruthy();
    }
  });

  it("afsiger det danske navn i et ikke-dansk sprog", async () => {
    // Ellers ville testen ovenfor være grøn, fordi `fallbackLng: "da"` serverede
    // dansk i stedet for den manglende nøgle — præcis den fejl portene ikke ser.
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      cleanup();
      await i18n.changeLanguage(lang);
      aabn();

      expect(
        screen.queryByRole("button", { name: value("da", LUK) }),
        `${lang}: dansk overlevde`,
      ).toBeNull();
      expect(value(lang, LUK), lang).not.toBe(value("da", LUK));
    }
  });

  it("knappen hedder «Luk» i dansk", () => {
    aabn();
    expect(lukKnappen("da")).toBeTruthy();
  });

  it("knappen er den eneste med det navn i dialogen", () => {
    aabn();
    // Et navn der optræder to gange er ikke en knap, en bruger kan finde — så
    // tællingen fanger en dubletmarkeringsfejl i markup'en.
    expect(
      screen.getAllByRole("button", { name: value("da", LUK) }),
    ).toHaveLength(1);
  });

  it("dialogen har et navn, fordi titlen hænger på den", () => {
    // `aria-labelledby` er det eneste navn en dialog har. Uden titlen — eller
    // med en tom streng som titel — er dialogen anonym, og en skærmlæser
    // læser kun "dialog" uden at vide hvad der skal lukkes.
    for (const lang of ALLE_LANG) {
      const titel = "Rediger registrering";
      cleanup();
      aabn(titel);
      const dialog = screen.getByRole("dialog", { name: titel });
      expect(dialog.getAttribute("aria-labelledby"), lang).toBeTruthy();
    }
  });

  it("kalder onClose når knappen trykkes, i alle 5 sprog", async () => {
    // Et navn der ikke sidder på den rigtige knap er en synlig fejl, men et navn
    // der sidder på en knap uden handling er værre: brugeren hører «Luk
    // dialog», trykker, og intet sker. Derfor dømmes selve kaldet.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      let kaldet = 0;
      render(
        <Dialog open onClose={() => kaldet++} title="Rediger registrering">
          <p>Indhold</p>
        </Dialog>,
      );

      fireEvent.click(lukKnappen(lang));
      expect(kaldet, lang).toBe(1);
    }
  });
});
