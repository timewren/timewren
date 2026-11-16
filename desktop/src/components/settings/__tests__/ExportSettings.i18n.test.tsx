import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Hvert `invoke`-kald fanges her, så testen kan se hvad der blev gemt og få
 * backend'en til at svare med det, den skal. `ExportSettings` kalder
 * `tauriInvoke`, som går lige til `invoke` — så mocken dømmer den rigtige vej.
 */
let svar: Record<string, unknown> = {};
let kald: { cmd: string; args?: Record<string, unknown> }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    kald.push({ cmd, args });
    return svar[cmd];
  },
}));

/**
 * Mappevælgeren kan fejle, og det er den vej toasten kommer fra. Mocken læser
 * flaget *ved kaldet*, ikke ved opstart, så `vi.mock`s højning ikke gør den
 * udefineret — ellers ville importen af komponenten nå den første gang.
 */
let mappevaelgerFejler = false;

vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: async () => {
    if (mappevaelgerFejler) throw new Error("dialog mangler i denne maskine");
    return null;
  },
}));

import { useToastStore } from "@/stores/toastStore";
import { ExportSettings } from "../ExportSettings";

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

function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

const UØRET = { normalizer: (tekst: string) => tekst.trim() } as const;

/** Nøgler der står i den altid synlige del: tre overskrifter med deres ledetekst. */
const I_SIDEN = [
  "exportSettings.csvSeparator",
  "exportSettings.csvSeparatorDescription",
  "exportSettings.semicolonLabel",
  "exportSettings.commaLabel",
  "exportSettings.csvSeparatorHint",
  "exportSettings.dateFormat",
  "exportSettings.dateFormatDescription",
  "exportSettings.defaultFolder",
  "exportSettings.defaultFolderDescription",
  "common.choose",
] as const;

/**
 * Nøgler hvis sætning er ens i flere sprog — `CSV-separator` hedder det samme
 * på dansk, svensk og norsk. De dømmes ikke af afvigelsestesten, fordi de ikke
 * afviger fra dansk, så de får deres egen gennemgang af json'en: med
 * `fallbackLng: "da"` er en *manglende* nøgle usynlig, så det er her en dansk
 * råtekst kan stå i stedet for den rigtige sætning uden at nogen ser det.
 */
const ENS_I_DANMARK = ["exportSettings.csvSeparator"] as const;

/** De to datoformater og deres eksempler — mønstre, ikke sprog. */
const FORMAT_MONSTRE = [
  { mønster: "DD-MM-YYYY", eksempel: "27-05-2026" },
  { mønster: "YYYY-MM-DD", eksempel: "2026-05-27" },
] as const;

function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, UØRET);
}

function manglende(lang: Lang, nøgler: readonly string[]): string[] {
  return nøgler.filter((key) => findAlle(value(lang, key)).length === 0);
}

function toasts() {
  return useToastStore.getState().toasts;
}

beforeEach(() => {
  svar = { get_all_settings: [] };
  kald = [];
  mappevaelgerFejler = false;
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  cleanup();
  svar = {};
  kald = [];
  mappevaelgerFejler = false;
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

/**
 * Eksportindstillingerne holdt 14 danske strenge i 30/9: tre overskrifter med
 * deres ledetekster, to separator-navne, råd til danske Excel-versioner, to
 * pladsholderformater, knappen og toasten fra mappevælgeren. Det er den side en
 * freelancer sender sine kunder en fil fra, så en svensk kunde ville få dansk
 * instruktioner oven på det.
 *
 * `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men ingen af dem ser, om
 * den *valgte* nøgle overhovedet havner i DOM'en. Her skifter testen sprog og
 * dømmer de værdier, der afviger fra dansk.
 */
describe("Eksportindstillinger følger appens sprog", () => {
  it("viser dansk på dansk", () => {
    render(<ExportSettings />);
    expect(manglende("da", I_SIDEN)).toEqual([]);
    expect(
      screen.getByPlaceholderText(
        value("da", "exportSettings.chooseFolderPlaceholder"),
      ),
    ).toBeTruthy();
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      render(<ExportSettings />);

      const afvigende = I_SIDEN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      // "Semikolon ( ; )" og "CSV-separator" deler ord på flere sprog, så tallet
      // varierer — 4 er det laveste, alle fire faktisk har.
      expect(afvigende.length).toBeGreaterThanOrEqual(4);
      expect(manglende(lang, afvigende)).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);

      // Pladsholderen er sin egen attribut, så den dømmes for sig selv — ellers
      // ville `I_SIDEN` springe den over, fordi den ikke er en tekstnode.
      const pladsholder = value(lang, "exportSettings.chooseFolderPlaceholder");
      expect(screen.queryByPlaceholderText(pladsholder)).not.toBeNull();
      if (
        pladsholder !== value("da", "exportSettings.chooseFolderPlaceholder")
      ) {
        expect(
          screen.queryByPlaceholderText(
            value("da", "exportSettings.chooseFolderPlaceholder"),
          ),
        ).toBeNull();
      }
    });
  }

  it("dømmer hver nøgle i alle 5 sprog mod json'en", async () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med
    // dansk, og skærmen ser rigtig ud. Derfor dømmes json'en direkte i stedet
    // for at sammenligne med dansk — en nøgle der mangler i et sprog har en tom
    // værdi her, og testen stopper med det.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      render(<ExportSettings />);

      for (const key of I_SIDEN) {
        const sætning = value(lang, key);
        expect(sætning, `${lang}:${key}`).not.toBe("");
        expect(manglende(lang, [key]), `${lang}:${key}`).toEqual([]);
      }

      const pladsholder = value(lang, "exportSettings.chooseFolderPlaceholder");
      expect(pladsholder, `${lang}:placeholder`).not.toBe("");
      expect(
        screen.queryByPlaceholderText(pladsholder),
        `${lang}:placeholder`,
      ).not.toBeNull();
    }
  });

  it("dømmer også de nøgler der med vilje ligner dansk", async () => {
    // De nøgler der *ikke* afviger, ville en afvigelsestest springe over — så
    // de får deres egen, ellers er de ubevidste ubevogtede.
    for (const key of ENS_I_DANMARK) {
      for (const lang of ALLE_LANG) {
        cleanup();
        await i18n.changeLanguage(lang);
        render(<ExportSettings />);
        expect(manglende(lang, [key]), `${lang}:${key}`).toEqual([]);
      }
    }
  });

  it("siger i brugerens sprog at mappevælgeren ikke kunne åbnes", async () => {
    // `toast.error("Kunne ikke åbne mappevælgeren …")` lå i koden. Det er den
    // eneste vej brugeren får en besked om at indtaste stien manuelt, så hvis
    // kaldet kaster, skal den stå på hans eget sprog.
    for (const lang of ALLE_LANG) {
      cleanup();
      useToastStore.setState({ toasts: [] });
      await i18n.changeLanguage(lang);
      mappevaelgerFejler = true;
      render(<ExportSettings />);

      fireEvent.click(screen.getByText(value(lang, "common.choose")));
      await vi.waitFor(() => expect(toasts()).toHaveLength(1));
      expect(toasts()[0].message).toBe(
        value(lang, "exportSettings.folderPickerFailed"),
      );
      expect(toasts()[0].type).toBe("error");
    }
  });

  it("viser et datoeksempel der kan læses uden at kende formatet", () => {
    // `23-05-2026` kan være 23. maj eller 5. februar, så det er netop det
    // valget der skal afgøre, der bliver uklart. Eksemplerne bruger derfor et
    // dagstal over 12.
    render(<ExportSettings />);
    for (const { mønster, eksempel } of FORMAT_MONSTRE) {
      expect(findAlle(mønster)).toHaveLength(1);
      expect(findAlle(eksempel)).toHaveLength(1);
      expect(Number.parseInt(eksempel.slice(0, 2), 10)).toBeGreaterThan(12);
    }
  });

  it("gemmer datoformatet som det samme mønster der står på knappen", async () => {
    // Mønsterne ligger i en konstant, fordi de ikke er sprog. Det er derfor
    // værd at dømme at knappens `value` stadig er den streng der gemmes — ellers
    // ville konstanten kunne glide fra hinanden uden at nogen så det.
    await i18n.changeLanguage("de");
    render(<ExportSettings />);

    for (const { mønster } of FORMAT_MONSTRE) {
      kald = [];
      fireEvent.click(screen.getByText(mønster));
      await vi.waitFor(() =>
        expect(
          kald.filter(
            (k) => k.cmd === "set_setting" && k.args?.key === "date_format",
          ),
        ).not.toEqual([]),
      );
      expect(kald.find((k) => k.args?.key === "date_format")?.args?.value).toBe(
        mønster,
      );
    }
  });
});
