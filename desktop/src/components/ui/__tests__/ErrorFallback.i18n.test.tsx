import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Kras-skærmen er det sidste en bruger ser, når appen er gået ned — og
 * forklaringen var `i18n.language === "en" ? engelsk : dansk`. **Svensk, norsk og
 * tysk læste dansk**, mens overskriften og knapperne lige over var oversatte.
 *
 * Den er en *class component*, så `useTranslation` ikke kan bruges, og
 * strengene lå i en terning inde i JSX — hverken synlig tekst, attribut eller
 * `set*`, så hverken `i18n.test.ts` eller `uiTextScanner` har set den. Derfor
 * dømmer testen den rigtige skærm i alle fem sprog, ikke strengene i koden.
 */

vi.mock("@sentry/react", () => ({
  captureException: () => {},
}));

import { ErrorBoundary } from "../ErrorFallback";

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

/**
 * `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med dansk, og
 * skærmen ser rigtig ud. Derfor læses json'en direkte — en nøgle der mangler i
 * et sprog har her en tom værdi, og testen stopper med det.
 */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const UVENTET = "errors.unexpected";
const OVERSKRIFT = "errors.generic";

/** Et barn der kaster, så boundaryen viser kras-skærmen. */
function Eksploderer(): never {
  throw new Error("database er låst");
}

/** Hele kras-skærmens tekst, som den en skærmlæser og en bruger læser. */
function krasSkaermen() {
  render(
    <ErrorBoundary>
      <Eksploderer />
    </ErrorBoundary>,
  );
  return (
    screen.getByText(value(i18n.language as Lang, OVERSKRIFT)).parentElement
      ?.textContent ?? ""
  );
}

beforeEach(() => {
  // React logger selv den kastede fejl; det er ikke det testen dømmer.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  await i18n.changeLanguage("da");
});

describe("kras-skærmen følger appens sprog", () => {
  it("forklarer fejlen i alle 5 sprog", async () => {
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      const tekst = krasSkaermen();

      expect(value(lang, UVENTET), `${lang}:${UVENTET}`).not.toBe("");
      expect(tekst, lang).toContain(value(lang, UVENTET));
    }
  });

  it("afsiger den danske forklaring i et ikke-dansk sprog", async () => {
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      cleanup();
      await i18n.changeLanguage(lang);
      const tekst = krasSkaermen();

      // Ellers ville testen ovenfor være grøn, fordi `fallbackLng: "da"`
      // serverede dansk i stedet for den manglende nøgle.
      expect(tekst, `${lang}: dansk overlevde`).not.toContain(
        value("da", UVENTET),
      );
    }
  });

  it("skelner sprogene, så de ikke alle er den samme sætning", () => {
    // Fem sprog der alle svarer "nogen tekst" ville være fem oversættelser,
    // der intet betyder; det her dømmer at de faktisk er forskellige.
    const sætninger = ALLE_LANG.map((lang) => value(lang, UVENTET));
    expect(new Set(sætninger).size).toBe(ALLE_LANG.length);
  });

  it("viser overskriften og knapperne i samme sprog", async () => {
    // Skærmen var *halvt* oversat: kun denne ene sætning var dansk. Dømmer de
    // tre øvrige, så en ny dansk sætning ikke bare kan smugle sig ind.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      krasSkaermen();

      expect(screen.getByRole("heading").textContent, lang).toBe(
        value(lang, OVERSKRIFT),
      );
      for (const nøgle of ["errors.tryAgain", "errors.reloadApp"]) {
        expect(value(lang, nøgle), `${lang}:${nøgle}`).not.toBe("");
        expect(
          screen.getByText(value(lang, nøgle)),
          `${lang}:${nøgle}`,
        ).toBeTruthy();
      }
    }
  });

  it("viser fejlens egen besked, så den kan rapporteres", async () => {
    // Skærmens hele formål ud over beroligelse: brugeren skal kunne læse hvad
    // der gik galt. Uden `error.message` er der intet at rapportere med.
    krasSkaermen();
    expect(screen.getByText("database er låst")).toBeTruthy();
  });
});
