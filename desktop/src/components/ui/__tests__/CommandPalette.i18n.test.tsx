import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";
import { useSettingsStore } from "@/stores/settingsStore";
import { useTimerStore } from "@/stores/timerStore";

// Én klient og ét projekt, så palettens egne grupper får noget at vise. Uden
// dem er "Klienter" og gruppeoverskriften "Projekter" ikke i DOM'en, og en test
// der springer dem over ville være grøn uden at dømme dem.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "list_clients") {
      return [{ id: "c1", name: "Acme A/S", company: "Acme", email: "" }];
    }
    if (cmd === "list_projects") {
      return [
        { id: "p1", name: "Ny hjemmeside", color: "", client_name: "Acme A/S" },
      ];
    }
    return [];
  },
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { CommandPalette } from "../CommandPalette";

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const OTHER_LANGS = ["en", "sv", "nb", "de"] as Lang[];
const ALL_LANGS: Lang[] = ["da", ...OTHER_LANGS];

/**
 * De nøgler paletten læser. Listen er her, så testen dømmer det brugeren ser
 * og ikke tilfældige ord i markup: en nøgle, der forsvinder fra koden, skal
 * give en rød test, fordi dens værdi så mangler i DOM'en.
 */
const PALETTE_KEYS = [
  "commandPalette.label",
  "commandPalette.groupNavigation",
  "commandPalette.groupTimer",
  "commandPalette.groupQuick",
  "commandPalette.startTimer",
  "commandPalette.hintNavigate",
  "commandPalette.hintSelect",
  "timeEntry.newEntry",
  "nav.dashboard",
  "nav.calendar",
  "nav.timeline",
  "nav.projects",
  "nav.klippekort",
  "nav.invoices",
  "nav.settings",
] as const;

// `projects.clients` og `nav.projects`-gruppen kræver de hentede klienter og
// projekter, så de dømmes i en egen test med ventetid i stedet for i listen
// ovenfor — ellers afhænger de af, hvornår effekten har kørt.

/**
 * Værdien af en nøgle i et sprog. Læses via en to-trins cast, fordi json'en
 * indeholder undertræer på tre niveauer (`suggestion.reason.git_repo`), som
 * `Record<string, Record<string, string>>` ikke dækker — men de nøgler,
 * paletten bruger, er alle to niveauer dybe.
 */
function value(lang: Lang, key: string): string {
  const [section, leaf] = key.split(".") as [string, string];
  const node = (
    LANGS[lang] as unknown as Record<string, Record<string, string>>
  )[section];
  return node?.[leaf] ?? "";
}

async function openPalette(query = "") {
  render(<CommandPalette />);
  fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });
  if (!query) {
    // Klienter og projekter hentes i en effekt, så deres grupper lander et tik
    // senere end navigationsrækkerne. Vente på et navn fra mocken er derfor
    // det, der sikrer at "Klienter" og "Projekter" er dømt, ikke kun fundet.
    await waitFor(() => expect(screen.getByText("Acme A/S")).toBeTruthy());
  }
  if (query) {
    // Søgefeltet findes på cmdk's egen attribut, ikke på pladsholderen — den
    // følger sproget, og testen har netop skiftet det.
    const input = document.querySelector<HTMLInputElement>("[cmdk-input]");
    if (!input) throw new Error("palettens søgefelt blev ikke fundet");
    fireEvent.change(input, { target: { value: query } });
  }
}

afterEach(async () => {
  cleanup();
  useSettingsStore.setState({ trackingPaused: false, theme: "light" });
  useTimerStore.setState({ isRunning: false });
  await i18n.changeLanguage("da");
});

/**
 * Paletten var den eneste vej ind i appen med Ctrl+K — en genvej både
 * genvejsoversigten og denne dialog lover. a7beea6's opgave var at få dansk ud af
 * UI'et, men paletten holdt 18 strenge på egne linjer, fordi porten i
 * `i18n.test.ts` kun læser `t("…")` og ikke JSX. En svensk bruger trykkede
 * Ctrl+K og mødte dansk. Testen skifter derfor sprog og dømmer det, der faktisk
 * havner i DOM'en.
 *
 * Den er datadrevet af den omfang: for hvert sprog dømmes de værdier, der
 * *afviger* fra dansk. Det er beviset — "Dashboard" hedder "Dashboard" på
 * svensk, så en håndskreven liste af danske strenge ville have forklaret sig
 * som bestået, mens paletten viste dansk.
 */
describe("Kommandopaletten følger appens sprog", () => {
  it("viser dansk på dansk", async () => {
    // Uden søgeord: cmdk skjuler rækkerne, der ikke matcher, så et søgeord ville
    // tømme paletten for de navne, testen skal finde.
    await openPalette();

    for (const text of [
      "Dashboard",
      "Kalender",
      "Klippekort",
      "Indstillinger",
      "Hurtige handlinger",
      "Kommandopalette",
    ]) {
      expect(screen.getAllByText(text).length).toBeGreaterThan(0);
    }
  });

  for (const lang of OTHER_LANGS) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      openPalette();

      const afvigende = PALETTE_KEYS.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis paletten bare var blevet tom.
      // Norsk deler flere ord med dansk ("Projekter", "Klippkort"), så tallet
      // varierer per sprog — 5 er det laveste, alle fire faktisk har.
      expect(afvigende.length).toBeGreaterThanOrEqual(5);

      const mangler = afvigende.filter(
        (key) => screen.queryAllByText(value(lang, key)).length === 0,
      );
      expect(mangler).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = PALETTE_KEYS.filter(
        (key) =>
          value("da", key) !== value(lang, key) &&
          screen.queryAllByText(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);
    });
  }

  it("oversætter grupperne for de hentede klienter og projekter", async () => {
    // Disse to grupper findes kun, når `list_clients`/`list_projects` er
    // svaret, så de venter på sig selv. Uden ventetiden ville de være dømt,
    // før de findes, og testen ville springe dem over i stedet for at fange
    // at de står på dansk.
    for (const lang of ALL_LANGS) {
      await i18n.changeLanguage(lang);
      cleanup();
      render(<CommandPalette />);
      fireEvent.keyDown(document.body, { key: "k", ctrlKey: true });

      await waitFor(() =>
        expect(
          screen.getAllByText(value(lang, "projects.clients")).length,
        ).toBeGreaterThan(0),
      );
      expect(
        screen.getAllByText(value(lang, "nav.projects")).length,
      ).toBeGreaterThan(0);

      if (lang !== "da") {
        expect(screen.queryAllByText(value("da", "projects.clients"))).toEqual(
          [],
        );
      }
    }
  });

  it("oversætter begge grene af tracking-terningen", async () => {
    // `{trackingPaused ? "Genoptag tracking" : "Pause tracking"}` lå med begge
    // danske strenge i markup. Kun den ene gren er synlig ad gangen, så de
    // dømmes hver for sig.
    for (const lang of OTHER_LANGS) {
      for (const paused of [false, true]) {
        await i18n.changeLanguage(lang);
        useSettingsStore.getState().setTrackingPaused(paused);
        cleanup();
        await openPalette();

        const key = paused
          ? "commandPalette.resumeTracking"
          : "commandPalette.pauseTracking";
        expect(screen.getAllByText(value(lang, key)).length).toBeGreaterThan(0);
        // Den anden gren må ikke stå der i dansk.
        const dansk = paused
          ? value("da", "commandPalette.pauseTracking")
          : value("da", "commandPalette.resumeTracking");
        if (dansk !== value(lang, key)) {
          expect(screen.queryAllByText(dansk)).toEqual([]);
        }
      }
    }
  });

  it("oversætter 'Ny registrering' — den lå som rå JSX-barn", async () => {
    // Fundet fra 30/9: fundet fra 06:0x blev markeret rettet, men den tredje af
    // de tretten navngivne strenge stod stadig i markup'en og var lagt i
    // `UI_TEKST_UNDTAGELSER` med begrundelsen "endnu ikke oversat". Undtagelsen
    // sagde så til sig selv, at porten dækkede filen.
    //
    // Beviset skal derfor være stærkere end "12 af 13 er væk": nøglen dømmes i
    // *alle* fem sprog, og de sprog der faktisk afviger fra dansk (`en`, `de`)
    // bevises ved at den danske tekst er væk fra DOM'en. Ét sprog med en
    // hardkodet streng ville nok engang være nok til at fange det — men hvis
    // `timeEntry.newEntry` en dag får samme ord i alle sprog, holder beviset
    // ikke længere, og det er derfor `afviger` tælles eksplicit.
    let afviger = 0;
    for (const lang of ALL_LANGS) {
      await i18n.changeLanguage(lang);
      cleanup();
      await openPalette();

      const dansk = value("da", "timeEntry.newEntry");
      const oversat = value(lang, "timeEntry.newEntry");
      expect(oversat).not.toBe("");
      if (lang !== "da" && oversat !== dansk) afviger++;
      expect(screen.getAllByText(oversat).length).toBeGreaterThan(0);
      if (oversat !== dansk) {
        expect(screen.queryAllByText(dansk)).toEqual([]);
      }
    }
    // Uden dette ville testen være grøn, hvis nøglen bare var værdier-identisk
    // på tværs af sprog — altså hvis sætningen slet ikke var oversat.
    expect(afviger).toBeGreaterThanOrEqual(2);
  });

  it("oversætter tomtilstanden", async () => {
    // `Command.Empty` viser sig kun, når søgningen ikke matcher noget — derfor
    // et søgeord, der ikke findes. cmdk unmounter de øvrige rækker, når der
    // filtreres, så tomtilstanden dømmes for sig selv.
    for (const lang of ALL_LANGS) {
      await i18n.changeLanguage(lang);
      cleanup();
      await openPalette("der er intet med dette navn");

      expect(
        screen.getAllByText(value(lang, "commandPalette.noResults")).length,
      ).toBeGreaterThan(0);
      if (lang !== "da") {
        expect(
          screen.queryAllByText(value("da", "commandPalette.noResults")),
        ).toEqual([]);
      }
    }
  });

  it("oversætter stop-knappen, som kun findes mens timeren kører", async () => {
    // `{!isRunning && …} / {isRunning && …}` — de to knapper er aldrig begge
    // i DOM'en, så kun den kørende gren dømmes her; den anden ligger i listen.
    for (const lang of ALL_LANGS) {
      await i18n.changeLanguage(lang);
      useTimerStore.setState({ isRunning: true });
      cleanup();
      openPalette();

      expect(
        screen.getAllByText(value(lang, "commandPalette.stopTimer")).length,
      ).toBeGreaterThan(0);
    }
    useTimerStore.setState({ isRunning: false });
  });

  it("sætter temaskiftet sammen med et adjektiv i hvert sprog", async () => {
    // "Skift til mørkt tema" lå med en terning på danske adjektiver i markup.
    // "Lys"/"Mørk" fra `settings.themeLight`/`themeDark` er ikke det samme ord,
    // så nøglen bærer sit eget adjektiv — både fordi bøjningen er sprogafhængig
    // og fordi "til det lyse tema" er en anden sætning.
    await i18n.changeLanguage("de");
    try {
      // Standardtemaet er lyst, så "mørkt"-grenen ses ikke uden dette. Begge
      // grene dømmes, fordi de er hvert sit adjektiv.
      useSettingsStore.getState().setTheme("dark");
      await openPalette();
      expect(screen.getByText("Zum dunklen Design wechseln")).toBeTruthy();

      cleanup();
      useSettingsStore.getState().setTheme("light");
      await openPalette();
      expect(screen.getByText("Zum hellen Design wechseln")).toBeTruthy();
    } finally {
      useSettingsStore.getState().setTheme("light");
      await i18n.changeLanguage("da");
    }
  });

  it("læser `commandPalette.searchPlaceholder`, som lå ubrugt i alle 5 locales", async () => {
    // Nøglen har eksisteret siden en tidligere opgave, men ingen kald læste den:
    // paletten viste "Søg kommandoer, sider, projekter..." i markup. Pladsholderen
    // i DOM'en er nu nøglens danske værdi, så den døde nøgle er væk.
    await openPalette();
    expect(
      screen.getByPlaceholderText(
        value("da", "commandPalette.searchPlaceholder"),
      ),
    ).toBeTruthy();
  });
});
