import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Hvert `invoke`-kald fanges her, så testen kan få backend'en til at svare med
 * det, den skal. `IntegrationSettings` kalder `tauriInvoke`, som går lige til
 * `invoke` — så mocken dømmer den rigtige vej.
 *
 * `get_setting` svarer `null` fordi komponenten spørger efter en gemt nøgle ved
 * start; `test_billy_connection` svarer med et organisationsnavn, der så skal
 * sættes ind i `integrations.connectedTo`.
 */
let svar: Record<string, unknown> = {};
let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd in fejl) throw fejl[cmd];
    return svar[cmd];
  },
}));

import { IntegrationSettings } from "../IntegrationSettings";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];
const ANDRE_LANG = ["en", "sv", "nb", "de"] as Lang[];

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

/** Nøglen → den sætning brugeren skal se, med `{{…}}` sat ind. */
function value(lang: Lang, key: string, params?: Record<string, string>) {
  let rå = TABLES[lang].get(key) ?? "";
  for (const [navn, tal] of Object.entries(params ?? {})) {
    rå = rå.replaceAll(`{{${navn}}}`, tal);
  }
  return rå;
}

/**
 * Testbibliotekets forvalg normaliserer tekst. Her skal det ikke: `Button`
 * sætter ikonet og etiketten i samme knap, så `getAllByText` skal kunne se
 * hele knappens tekst.
 */
const UØRET = { normalizer: (tekst: string) => tekst.trim() } as const;

/** Nøgler der står i den altid synlige del: beskrivelser, badge og etiketter. */
const I_SIDEN = [
  "integrations.billyDescription",
  "integrations.dineroDescription",
  "integrations.economicDescription",
  "integrations.rentemesterDescription",
  "settings.apiKey",
  "settings.testConnection",
] as const;

/** Den samme nøgle bruges tre gange — en for hver "kommer snart"-sektion. */
const KOMMER_SNART = "integrations.comingSoon";

/** Produktnavnene der dømmes i `integrations.inDevelopment`. */
const PRODUKTER = ["Dinero", "e-conomic", "Rentemester"] as const;

/**
 * Slå en værdi op i DOM'en. Adgangskontrolfeltets `label` og `placeholder` er
 * hver deres egen tekstnode, så `getByPlaceholderText` dømmer pladsholderen
 * direkte i stedet for at lede i et søgetræ.
 */
function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, UØRET);
}

/** Find alle forekomster af hver nøgle, og returnér dem der ikke blev fundet. */
function manglende(lang: Lang, nøgler: readonly string[]): string[] {
  return nøgler.filter((key) => findAlle(value(lang, key)).length === 0);
}

beforeEach(() => {
  svar = { get_setting: null, test_billy_connection: "Mads Holm A/S" };
  fejl = {};
});

afterEach(async () => {
  cleanup();
  svar = {};
  fejl = {};
  await i18n.changeLanguage("da");
});

/**
 * Integrationerne holdt 15 danske strenge på egne linjer i 30/9 — to
 * beskrivelser, "Kommer snart" tre gange, tre "…-integration er under
 * udvikling", feltets etiket og pladsholder og knappen. Det er den side en
 * freelancer tager hen til, når han vil have sine fakturaer ud i et
 * bogføringssystem.
 *
 * `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men ingen af dem ser, om
 * den *valgte* nøgle overhovedet havner i DOM'en. Her skifter testen sprog og
 * dømmer de værdier, der afviger fra dansk.
 */
describe("Integrationer følger appens sprog", () => {
  it("viser dansk på dansk", () => {
    render(<IntegrationSettings />);
    expect(manglende("da", I_SIDEN)).toEqual([]);
    // Badgen står tre gange — én for hver kommende integration.
    expect(findAlle(value("da", KOMMER_SNART))).toHaveLength(3);
    expect(
      screen.getByPlaceholderText(
        value("da", "integrations.billyApiKeyPlaceholder"),
      ),
    ).toBeTruthy();
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      render(<IntegrationSettings />);

      const afvigende = I_SIDEN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      // `settings.apiKey` og `settings.testConnection` deler et par ord med
      // dansk, så tallet varierer — 4 er det laveste, alle fire faktisk har.
      expect(afvigende.length).toBeGreaterThanOrEqual(4);
      expect(manglende(lang, afvigende)).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);

      // Pladsholderen er sin egen attribut, så den dømmes for sig selv — ellers
      // ville `I_SIDEN` springe den over, fordi den ikke er en tekstnode.
      const pladsholder = value(lang, "integrations.billyApiKeyPlaceholder");
      expect(
        value("da", "integrations.billyApiKeyPlaceholder") === pladsholder ||
          screen.queryByPlaceholderText(pladsholder) !== null,
      ).toBe(true);
      if (pladsholder !== value("da", "integrations.billyApiKeyPlaceholder")) {
        expect(
          screen.queryByPlaceholderText(
            value("da", "integrations.billyApiKeyPlaceholder"),
          ),
        ).toBeNull();
      }
    });
  }

  it("sætter produktnavnet i 'under udvikling' i alle 5 sprog", async () => {
    // `Dinero-integration er under udvikling` lå tre gange i markup'en, kun
    // forskelligt ved produktnavnet. Med `{{product}}`-interpolation er der én
    // sætning — og hvis et sprog får bytteordet forkert eller glemmer
    // pladsholderen, er den *ene* nøgle nok til at dømme alle tre sektioner.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      for (const produkt of PRODUKTER) {
        cleanup();
        render(<IntegrationSettings />);
        expect(
          findAlle(
            value(lang, "integrations.inDevelopment", { product: produkt }),
          ),
        ).toHaveLength(1);
      }
    }
  });

  it("sætter organisationens navn i forbindelsesmeldingen i alle 5 sprog", async () => {
    // `Forbundet til ${org}` lå i koden. Rust svarer med navnet, så strengen er
    // den eneste, der afslører om bytteordet står rigtigt — "Ansluten til" og
    // "Tilkoblet til" er forskellige, så ét sprog ville være et svagt bevis.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      render(<IntegrationSettings />);

      fireEvent.change(
        screen.getByPlaceholderText(
          value(lang, "integrations.billyApiKeyPlaceholder"),
        ),
        { target: { value: "hemmelig-nøgle" } },
      );
      fireEvent.click(screen.getByText(value(lang, "settings.testConnection")));

      expect(
        await screen.findByText(
          value(lang, "integrations.connectedTo", {
            org: "Mads Holm A/S",
          }),
        ),
      ).toBeTruthy();
    }
  });

  it("siger i brugerens sprog at nøglen mangler", async () => {
    // `throw new Error("Indtast en API-nøgle først")` blev vist råt gennem
    // `String(err)`, så `Error:`-præfikset hang foran den danske sætning.
    // Rust kan give en streng, så kun den anden gren er oversat — men den er
    // den, der er synlig for brugeren her.
    await i18n.changeLanguage("de");
    render(<IntegrationSettings />);

    fireEvent.click(screen.getByText(value("de", "settings.testConnection")));
    const besked = await screen.findByText(
      value("de", "integrations.apiKeyRequired"),
    );
    expect(besked.textContent).toBe(value("de", "integrations.apiKeyRequired"));
  });

  it("skriver gemt- og fejlstatus i brugerens sprog", async () => {
    // `setSaveStatus("Gemt")` / `setSaveStatus("Fejl ved gemning")` lå i
    // koden og vises i et toast-lignende felt. Først var feltet *altid* grønt,
    // så en fejl blev vist som en succes — derfor dømmer testen farven også.
    await i18n.changeLanguage("de");
    render(<IntegrationSettings />);

    const felt = screen.getByPlaceholderText(
      value("de", "integrations.billyApiKeyPlaceholder"),
    );
    fireEvent.change(felt, { target: { value: "hemmelig-nøgle" } });

    fireEvent.blur(felt);
    const gemt = await screen.findByText(value("de", "common.saved"));
    expect(gemt.className).toContain("text-emerald-400");
    expect(gemt.className).not.toContain("text-red-400");

    cleanup();
    fejl = { set_setting: "database låst" };
    render(<IntegrationSettings />);
    const felt2 = screen.getByPlaceholderText(
      value("de", "integrations.billyApiKeyPlaceholder"),
    );
    fireEvent.change(felt2, { target: { value: "hemmelig-nøgle" } });
    fireEvent.blur(felt2);
    const gemtFejl = await screen.findByText(value("de", "common.errorSaving"));
    expect(gemtFejl.className).toContain("text-red-400");
    expect(gemtFejl.className).not.toContain("text-emerald-400");
  });
});
