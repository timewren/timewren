import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Seks indstillingssider har hver sit eget gem-feedback-felt, og de var alle
 * bygget som *én* ren streng i en container med **altid** `text-emerald-400`.
 * Fundet fra 30/9 (`ExportSettings` + `CalendarIntegration`) var konsekvensen:
 * `setSaveStatus("Fejl ved gemning")` i catch'en blev vist som en succes i
 * grønt i tre sekunder. `IntegrationSettings` havde allerede fået
 * `{ text, isError }`-formen i 9062ee9 — rettelsen blev lagt i *én* fil, så de
 * fire øvrige sager af samme slags lå uberørte.
 *
 * Derfor dømmes alle seks her i én fil: en søster der får mønsteret tilbage
 * falder, og listen er hele beviset på at klassen er lukket.
 */
let svar: Record<string, unknown> = {};
let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd in fejl) throw fejl[cmd];
    return svar[cmd];
  },
}));

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => null,
}));

import { AiSettings } from "../AiSettings";
import { CalendarIntegration } from "../CalendarIntegration";
import { ExportSettings } from "../ExportSettings";
import { GeneralSettings } from "../GeneralSettings";
import { InvoiceSettings } from "../InvoiceSettings";
import { TrackingSettings } from "../TrackingSettings";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;

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

/**
 * Hver sides første fritekstfelt gemmer ved blur, så det er det, testen
 * trykker på. Checkboxes og radioer springes over — de er også `input`, men
 * kalder ikke `set_setting`.
 */
function førsteGemFelt(container: HTMLElement) {
  return container.querySelector(
    'input:not([type="checkbox"]):not([type="radio"])',
  ) as HTMLInputElement;
}

/**
 * Gem-feltet skal males efter om det lykkedes, og det er den *eneste* forskel
 * mellem de to tilfælde. Derfor dømmes begge — og på at fejlen ikke har
 * succeskuløren, så en fremtidig refaktorering ikke kan male begge.
 *
 * Tysk er valgt, fordi gemt- og fejlsætningen faktisk er forskellige der, så
 * testen kan skelne dem fra den dansk tekst koden viste førhen.
 */
async function dømGemStatus(
  renderKomponent: () => HTMLElement,
  fejlNøgle: string,
  fejlKommando: string,
) {
  await i18n.changeLanguage("de");

  let container = renderKomponent();
  const først = førsteGemFelt(container);
  fireEvent.change(først, { target: { value: "12,50" } });
  fireEvent.blur(først);
  const gemt = await screen.findByText(value("de", "common.saved"));
  expect(gemt.className).toContain("text-emerald-400");
  expect(gemt.className).not.toContain("text-red-400");

  cleanup();
  fejl = { [fejlKommando]: "database låst" };
  container = renderKomponent();
  const forst = førsteGemFelt(container);
  fireEvent.change(forst, { target: { value: "12,50" } });
  fireEvent.blur(forst);
  const gemtFejl = await screen.findByText(value("de", fejlNøgle));
  expect(gemtFejl.className).toContain("text-red-400");
  expect(gemtFejl.className).not.toContain("text-emerald-400");
}

/**
 * De seks siders fejlsætning og den kommando, der skal fejle for at udløse den.
 * De er ikke ens — fire sider siger "Kunne ikke gemme", to bruger en egen nøgle,
 * og `AiSettings` gemmer via `set_ai_config` frem for `set_setting` — så begge
 * dele står her, så en side der bytter kommando eller sætning ikke kan gå uden
 * at tabellen følger med.
 */
const SIDER = [
  {
    navn: "ExportSettings",
    fejlNøgle: "common.errorSaving",
    fejlKommando: "set_setting",
    Komponent: ExportSettings,
  },
  {
    navn: "CalendarIntegration",
    fejlNøgle: "common.errorSaving",
    fejlKommando: "set_setting",
    Komponent: CalendarIntegration,
  },
  {
    navn: "InvoiceSettings",
    fejlNøgle: "common.errorSaving",
    fejlKommando: "set_setting",
    Komponent: InvoiceSettings,
  },
  {
    navn: "GeneralSettings",
    fejlNøgle: "common.errorSaving",
    fejlKommando: "set_setting",
    Komponent: GeneralSettings,
  },
  {
    navn: "TrackingSettings",
    fejlNøgle: "tracking.saveFailed",
    fejlKommando: "set_setting",
    Komponent: TrackingSettings,
  },
  {
    navn: "AiSettings",
    fejlNøgle: "tracking.saveFailed",
    fejlKommando: "set_ai_config",
    Komponent: AiSettings,
  },
] as const;

beforeEach(() => {
  // Alle sider spørger om gemte værdier ved start. `AiSettings` henter desuden
  // sin konfiguration og sine regler, så de skal svare med genkendelige
  // former — ellers ville renderingen kaste, før feltet overhovedet nåede at
  // vise noget.
  svar = {
    get_setting: null,
    get_all_settings: [],
    get_ai_config: {
      provider: "openai",
      api_key: null,
      model: "gpt-4o-mini",
      base_url: null,
    },
    list_rules: [],
    list_projects: [],
  };
  fejl = {};
});

afterEach(async () => {
  cleanup();
  svar = {};
  fejl = {};
  await i18n.changeLanguage("da");
});

describe("Gem-feedback i indstillingerne følger resultatet", () => {
  for (const { navn, fejlNøgle, fejlKommando, Komponent } of SIDER) {
    it(`maler en gem-fejl i rødt i ${navn}`, async () => {
      await dømGemStatus(
        () => render(<Komponent />).container,
        fejlNøgle,
        fejlKommando,
      );
    });
  }

  it("skriver status i brugerens sprog, ikke i dansk", async () => {
    // `ExportSettings` og `CalendarIntegration` havde hver sin hardkodet
    // "Gemt"/"Fejl ved gemning". Svensk og norsk deler stadig "Gemt" med dansk
    // i enkelte nøgler, så de forventede værdier læses fra json'en — testen
    // dømmer det DOM'en viser, ikke en håndskreven liste.
    for (const lang of ["en", "sv", "nb", "de"] as Lang[]) {
      cleanup();
      svar = { get_all_settings: [] };
      await i18n.changeLanguage(lang);
      const { container } = render(<ExportSettings />);
      const felt = førsteGemFelt(container);
      fireEvent.change(felt, { target: { value: "/tmp/eksport" } });
      fireEvent.blur(felt);
      expect(await screen.findByText(value(lang, "common.saved"))).toBeTruthy();
      if (value(lang, "common.saved") !== value("da", "common.saved")) {
        expect(screen.queryByText(value("da", "common.saved"))).toBeNull();
      }
    }
  });
});
