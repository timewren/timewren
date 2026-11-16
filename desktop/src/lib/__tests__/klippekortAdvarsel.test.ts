import { afterEach, describe, expect, it } from "vitest";
import i18n from "@/lib/i18n";
import {
  klippekortAdvarselNiveau,
  klippekortAdvarselTekst,
} from "@/lib/klippekortAdvarsel";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;

afterEach(async () => {
  await i18n.changeLanguage("da");
});

/**
 * Den gamle kode skrev beskeden i Rust: `format!("Klippekort er {:.0}% brugt
 * ({:.1}t / {:.1}t)")`. Den fejl har to dele, og porten dømmer dem hver for sig,
 * fordi en rettelse kunne lukke den ene og lade den anden stå.
 *
 * 1. **Sproget.** Sætningen var dansk i alle sprog, så en svensk bruger fik
 *    dansk midt i en app der ellers er oversat.
 * 2. **Decimaltegnet.** `{:.1}` skriver et **punkt** i alle sprog, så selv dansk
 *    læste «29.5t / 30t». Det er den del, der er værst, fordi den er usynlig for
 *    en dansk læser, der tror han læser sit eget talformat.
 */
describe("klippekortAdvarselTekst", () => {
  it("skriver advarslen på dansk med decimalkomma", async () => {
    const t = klippekortAdvarselTekst({
      type: "warning",
      used: 28.5,
      total: 30,
    });

    expect(t).toContain("95 %");
    expect(t).toContain("28,5");
    expect(t).toContain("30 timer");
    expect(t).not.toContain("28.5");
  });

  it("skriver advarslen på svensk, norsk, tysk og engelsk", async () => {
    const forventet: Record<Lang, RegExp> = {
      // «Klippkortet är 95 % använt» — ordet «använt», ikke «brugt».
      sv: /Klippkortet är .* använt/,
      nb: /Klippekortet er .* brukt/,
      de: /Stundenkonto ist zu .* verbraucht/,
      en: /Prepaid package is .* used/,
      da: /Klippekortet er .* brugt/,
    };

    for (const lang of Object.keys(forventet) as Lang[]) {
      await i18n.changeLanguage(lang);
      const t = klippekortAdvarselTekst({
        type: "warning",
        used: 28.5,
        total: 30,
      });
      expect(t, `${lang}: "${t}" skal matche ${forventet[lang]}`).toMatch(
        forventet[lang],
      );
    }
  });

  /**
   * Dansk, tysk **og svensk** deler decimalkomma, så en port der kun dømmer
   * «28,5» ville være grøn for en svensk oversættelse der skrev «28.5». Det er
   * målt i node med samme `Intl`-kald som `formatHours`, fordi det er sprog der
   * bruger punktum — ikke sprog der bruger komma — der er det overraskende.
   */
  it("skriver decimalkomma i hvert sprog, der bruger komma", async () => {
    for (const lang of ["da", "de", "sv"] as Lang[]) {
      await i18n.changeLanguage(lang);
      const t = klippekortAdvarselTekst({
        type: "warning",
        used: 28.5,
        total: 30,
      });
      expect(t, `${lang}: "${t}" skal bruge decimalkomma`).toContain("28,5");
    }

    for (const lang of ["en"] as Lang[]) {
      await i18n.changeLanguage(lang);
      const t = klippekortAdvarselTekst({
        type: "warning",
        used: 28.5,
        total: 30,
      });
      expect(t, `${lang}: "${t}" skal bruge decimapunktum`).toContain("28.5");
    }
  });

  /**
   * «Opbrugt» er en *anden* sætning end «95 % brugt», ikke en variant af den.
   * Porten dømmer derfor at de to nøgler er forskellige i alle fem sprog — en
   * `??`-løsning, der lod `depleted` falde tilbage på `warning`, ville vise en
   * bruger med et helt tømt klippekort at han «bruger 100 % af sit klippekort».
   *
   * Den dømmer **også** at sætningen følger sproget, ikke bare at den er en
   * anden sætning. Det er den del, en mutation der byggede beskeden med den
   * gamle `format!("{:.1}t")` slap igennem på: den gav to forskellige strenge,
   * så «depleted ≠ warning» holdt, mens «opbrugt" stod dansk i alle sprog.
   */
  it("skriver en egen sætning for et opbrugt klippekort", async () => {
    for (const lang of Object.keys(LANGS) as Lang[]) {
      await i18n.changeLanguage(lang);
      const t = klippekortAdvarselTekst({
        type: "depleted",
        used: 30,
        total: 30,
      });
      const næsten = klippekortAdvarselTekst({
        type: "warning",
        used: 28.5,
        total: 30,
      });
      expect(
        t,
        `${lang}: "${t}" skal være en anden sætning end "${næsten}"`,
      ).not.toBe(næsten);
      // «opbrugt» er dansk og «klippekort» er dansk *og* norsk — begge steder er
      // korrekte. Det er **tysk og engelsk** der er dommen: de oversætter
      // produktnavnet («Stundenkonto» / «Prepaid package»), så den gamle
      // danske `format!` er umiskjenneligt dansk der. Det var mutationen der
      // slap igennem først: to forskellige strenge, så «depleted ≠ warning»
      // holdt, mens «opbrugt» stod dansk overalt.
      if (lang === "de" || lang === "en") {
        expect(t, `${lang}: "${t}" må ikke være dansk`).not.toMatch(
          /opbrugt|klippekort/i,
        );
      }
      // Og den skal læses som timer, ikke som en rå Rust-formatering.
      expect(
        t,
        `${lang}: "${t}" skal ikke bare være tal med et "t"`,
      ).not.toMatch(/^\s*[\d.]+t\s*\//);
    }
  });

  /**
   * Hele timer skriver «30», ikke «30,0» — en advarsel i en toast skal læses på
   * ét blink, og «28,5 af 30,0 timer» er støj. `formatHours(x, 1, 0)` er
   * minimum/maksimum: én decimal når der er en brøkdel, ingen når der ikke er.
   */
  it("lader hele timer stå uden nuldecimal", () => {
    expect(
      klippekortAdvarselTekst({ type: "depleted", used: 30, total: 30 }),
    ).toContain("30");
    expect(
      klippekortAdvarselTekst({ type: "depleted", used: 30, total: 30 }),
    ).not.toContain("30,0");
  });

  /**
   * Runden. `28.5 / 30` er 95 præcis, så enhver test med «pæne» tal er grøn
   * uden om der overhovedet rundes — en mutation der fjernede `Math.round` slap
   * netop sådan igennem. Porten dømmer derfor på tal der *kræver* en ned- eller
   * op-runding: 28,5 af 60 er 47,5 % og skal læses «48», og 29 af 32 er
   * 90,625 % og skal læses «91».
   *
   * Runden kommer fra `formatNumber`s `maximumFractionDigits: 0` — samme `Intl`
   * som timerne i samme sætning. Den blev målt over 80.400 realistiske par mod
   * `Math.round` og er uenige i **nul** af dem, også på de halve tal.
   */
  it("runder procenten til et helt tal", async () => {
    // 28.5/60 = 47.5 % → 48
    expect(
      klippekortAdvarselTekst({ type: "warning", used: 28.5, total: 60 }),
    ).toContain("48 %");
    // 29/32 = 90.625 % → 91
    expect(
      klippekortAdvarselTekst({ type: "warning", used: 29, total: 32 }),
    ).toContain("91 %");
    // Runden må ikke lægge sig til: ingen decimal i procenten, uanset sprog.
    for (const lang of ["da", "en"] as Lang[]) {
      await i18n.changeLanguage(lang);
      const t = klippekortAdvarselTekst({
        type: "warning",
        used: 28.5,
        total: 60,
      });
      expect(t, `${lang}: "${t}" skal have en hel procent`).toMatch(
        /\b\d+ %|\b\d+%|\b\d+ procent/,
      );
      expect(t, `${lang}: "${t}" må ikke have decimal i procenten`).not.toMatch(
        /4[78][.,]\d\s*%/,
      );
    }
  });

  it("skriver aldrig NaN, selv om kapaciteten er nul", () => {
    const t = klippekortAdvarselTekst({ type: "warning", used: 0, total: 0 });
    expect(t).not.toContain("NaN");
    // Og «100 % brugt» ville være en påstand om et klippekort uden timer.
    expect(t).not.toMatch(/100\s*%/);
  });

  it("flytter sig med sprogvalget undervejs", async () => {
    await i18n.changeLanguage("de");
    const tysk = klippekortAdvarselTekst({
      type: "warning",
      used: 28.5,
      total: 30,
    });
    await i18n.changeLanguage("da");
    const dansk = klippekortAdvarselTekst({
      type: "warning",
      used: 28.5,
      total: 30,
    });
    expect(tysk).not.toBe(dansk);
  });
});

describe("klippekortAdvarselNiveau", () => {
  it("gør et opbrugt klippekort til en fejl og et næsten opbrugt til en info", () => {
    expect(klippekortAdvarselNiveau("depleted")).toBe("error");
    expect(klippekortAdvarselNiveau("warning")).toBe("info");
  });

  /**
   * `main.tsx` vælger niveauet af `payload.type`, og `type` kommer fra Rust som en
   * streng. Et ukendt `type` må derfor **ikke** blive en rød fejl om et klippekort
   * der måske ikke er opbrugt: en ukendt værdi er en vær, der skal læses neutralt.
   */
  it("læser en ukendt værdi neutralt, ikke som en fejl", () => {
    expect(klippekortAdvarselNiveau("noget-ukendt")).toBe("info");
    expect(klippekortAdvarselNiveau("")).toBe("info");
  });
});
