import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";
import { OnboardingWizard } from "../OnboardingWizard";
import kilde from "../OnboardingWizard.tsx?raw";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

const LANGS = { da, en, sv, nb, de } as const;
type Lang = keyof typeof LANGS;
const ALLE_LANG: Lang[] = ["da", "en", "sv", "nb", "de"];
const ANDRE_LANG = ["en", "sv", "nb", "de"] as Lang[];

function flatten(node: unknown, prefix = ""): Map<string, string> {
  const out = new Map<string, string>();
  if (Array.isArray(node)) {
    out.set(prefix, JSON.stringify(node));
    return out;
  }
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

function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, { normalizer: (t) => t.trim() });
}

function manglende(lang: Lang, nøgler: readonly string[]): string[] {
  return nøgler.filter((key) => findAlle(value(lang, key)).length === 0);
}

beforeEach(() => {
  invoke.mockReset();
  // Tomme lister, så kunde- og projekttrin ikke springes over af sig selv, og
  // prøveperioden kan startes, så licenstrin kan forlades.
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_clients" || cmd === "list_projects") return [];
    if (cmd === "start_trial") {
      return { is_active: true, days_remaining: 30, started_at: null };
    }
    return undefined;
  });
});

afterEach(async () => {
  cleanup();
  invoke.mockReset();
  await i18n.changeLanguage("da");
});

function næste() {
  return screen.getByRole("button", {
    name: value(i18n.language as Lang, "common.next"),
  });
}

/** Viser wizarden og klikker sig frem til det trin, der dømmes. */
async function tilTrin(trin: 0 | 2 | 3 | 5) {
  render(<OnboardingWizard onComplete={() => {}} />);
  if (trin === 0) return;

  // Trin 0 → 1. `AnimatePresence` gennemfører skiften asynkront, så hvert
  // klik må vente på det nye trin står i DOM'en — ellers ville testen dømme det
  // gamle trin.
  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(
      findAlle(value(i18n.language as Lang, "onboarding.licenseTitle")),
    ).toHaveLength(1),
  );

  if (trin >= 2) {
    // Trin 1 er licensen: uden licens eller prøveperiode står der ingen
    // «Næste», kun en besked om at man skal vælge en af dem.
    fireEvent.click(
      screen.getByText(
        value(i18n.language as Lang, "onboarding.licenseStartTrial"),
      ),
    );
    await vi.waitFor(() => expect(næste()).toBeTruthy());
    fireEvent.click(næste());
  }

  if (trin === 2) {
    await vi.waitFor(() =>
      expect(
        findAlle(value(i18n.language as Lang, "onboarding.cloudTitle")),
      ).toHaveLength(1),
    );
    return;
  }

  // Trin 2 → 3: spring cloud-trinnet over.
  fireEvent.click(
    screen.getByText(value(i18n.language as Lang, "onboarding.cloudSkip")),
  );

  await vi.waitFor(() =>
    expect(
      findAlle(value(i18n.language as Lang, "onboarding.step2Title")),
    ).toHaveLength(1),
  );

  if (trin === 3) return;

  // Trin 3 → 4: kunden er tom, så knappen siger «Næste».
  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(
      findAlle(value(i18n.language as Lang, "onboarding.step3Title")),
    ).toHaveLength(1),
  );

  // Trin 4 → 5: projektet er tomt, så knappen igen siger «Næste».
  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(
      screen.getByText(value(i18n.language as Lang, "ai.providerTitle")),
    ).toBeTruthy(),
  );
}

/** Nøgler der står i trin 2, der sælger cloud-abonnementet. */
const I_SKYD_TRIN = [
  "onboarding.cloudUpgrade",
  "onboarding.cloudFeature1",
  "onboarding.cloudFeature2",
  "onboarding.cloudFeature3",
  "onboarding.cloudFeature4",
  "onboarding.cloudFree",
] as const;

/**
 * Onboarding-vejreren er den første skærm en ny bruger ser, og den indeholdt 30/9
 * ni rå danske strenge: fem AI-udbydere med produktnavne, fire
 * nøgleformater, `Ollama (lokal)`, et punktum som HTML-entitet, `99 kr`, `/md`
 * og en «API-nøgle...» der lå i en `??` inde i en JSX-attribut, så hverken
 * `i18n.test.ts` eller porten så den.
 *
 * Den værste var prisen: `99 kr /md` stod hårdkodet lige ved siden af
 * `onboarding.cloudFree`, som sagde samme pris i alle fem sprog. En tysk
 * bruger læste altså «99 kr /md · 30 Tage kostenlos, danach 99 kr/Monat» — samme
 * pris to gange, den danske halvdel først. 1/10 viste det sig at være en
 * *gammel* listepris: webbens prisbog bruger den kun til legacy- og
 * founding-planer, så begge halvdelne er væk, og cloud-trinnet linker nu videre
 * til prissiden i stedet. Dømningen af det står i «lover ingen
 * abonnementspris, den ikke kan holde».
 */
describe("Onboarding følger appens sprog", () => {
  it("viser prisen én gang, på dansk", async () => {
    await tilTrin(2);

    expect(manglende("da", I_SKYD_TRIN)).toEqual([]);
    expect(findAlle("99 kr")).toHaveLength(0);
    expect(findAlle("/md")).toHaveLength(0);
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} på cloud-trinnet`, async () => {
      await i18n.changeLanguage(lang);
      await tilTrin(2);

      const afvigende = I_SKYD_TRIN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis skærmen bare var blevet tom.
      expect(afvigende.length).toBeGreaterThanOrEqual(4);
      expect(manglende(lang, afvigende)).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => findAlle(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);
    });
  }

  it("dømmer hver nøgle i alle 5 sprog mod json'en", async () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med
    // dansk, og skærmen ser rigtig ud. Derfor dømmes json'en direkte.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await tilTrin(2);
      for (const key of I_SKYD_TRIN) {
        expect(value(lang, key), `${lang}:${key}`).not.toBe("");
        expect(manglende(lang, [key]), `${lang}:${key}`).toEqual([]);
      }
    }
  });

  it("lover ingen abonnementspris, den ikke kan holde", async () => {
    // `/md` lå hårdkodet i markup'en, så det blev dømt for sig selv. Men den
    // oversatte sætning ved siden af havde sin *egen* pris: «99 kr/md» i alle
    // fem sprog. Og 99 er en gammel listepris — webbens prisbog bruger den kun
    // til legacy- og founding-planer, mens de planer, der sælges i dag, er 29
    // og 79 kr/md. Brugeren læste altså op til 70 kr/md for lav, i den første
    // skærm appen viser, og det var den eneste pris-påstand i hele appen.
    //
    // Prisen hører hjemme på prissiden, som appen allerede linker til fra tre
    // steder — så der skal ikke stå et tal her, der skal rettes to steder ved
    // næste prisstige. Porten dømmer derfor hele `onboarding`-afsnittet i alle
    // fem sprog, så ingen ny nøgle kan komme tilbage med et tal i.
    //
    // `licenseBuyLifetime` har også et beløb (999 kr), men det er en
    // engangspris for et andet produkt og slås ikke sammen med en
    // abonnementsprisstigning. Mønstret dømmer derfor et tal *og* en periode,
    // ikke et hvilket som helst tal — ellers ville porten dømme den væk hver
    // gang livstidsprisen ændrer sig.
    //
    // Der er ingen `\b` bag på perioden: i den renderede DOM ligger `/md` ofte
    // lige før næste tekstnode («…99 kr /mdSe priser og planer»), og så ville
    // en ordgrænse få porten til at se bort fra prisen. Mønstret skal kunne
    // se «99 kr/md» uden mellemrum og «79 kr /md» med.
    const PRIS =
      /\d[\d.,]*\s*[$€£]?\s*(kr|dkk|kroner|krona)?\s*\/\s*(md|mo|mån|manad|måned|month|månad|mese|mes)/i;

    for (const lang of ALLE_LANG) {
      const fundne = [...TABLES[lang].entries()]
        .filter(([nøgle]) => nøgle.startsWith("onboarding."))
        .filter(([, værdi]) => PRIS.test(værdi))
        .map(([nøgle, værdi]) => `${nøgle} = "${værdi}"`);
      expect(fundne, lang).toEqual([]);
    }

    // Markup'en dømmes på den *renderede* skærm, ikke på rå kildekode: en
    // `/md` i en kommentar må ikke kunne gøre porten rød, og en `/md` i
    // JSX'en må ikke kunne slippe forbi. Det er den hårdkodede halvdel af det
    // samme problem, som den gamle port dømte med `kilde`.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await tilTrin(2);
      const synlig = document.body.textContent ?? "";
      expect(synlig.match(PRIS), lang).toBeNull();
    }
  }, 30_000);

  it("sender brugeren fra cloud-trinnet videre til den side, der har prisen", async () => {
    // Prisen forsvandt fra teksten, så den skal kunne findes igen: samme
    // handling som `LicenseSettings` tilbyder, med samme URL, i alle fem sprog.
    // Uden denne test kunne teksten bare have mistet prisen og sendt brugeren
    // ingen vegne — altså løst det forkerte problem.
    const åbne = vi.spyOn(window, "open").mockImplementation(() => null);
    try {
      for (const lang of ALLE_LANG) {
        cleanup();
        await i18n.changeLanguage(lang);
        await tilTrin(2);
        const link = screen.getByRole("button", {
          name: value(lang, "license.seePricing"),
        });
        fireEvent.click(link);
        expect(åbne, lang).toHaveBeenCalledWith(
          "https://timetrack.dk/pricing",
          "_blank",
        );
        åbne.mockClear();
      }
    } finally {
      åbne.mockRestore();
    }
  }, 30_000);

  it("viser klientens firmalabel som én oversat sætning", async () => {
    // `t("form.companyLabel") + " (" + t("onboarding.step4Skip").toLowerCase()
    // + ")"` satte «Firma (spring over)» sammen af to nøgler og gjorde den
    // tredje med små bogstaver — så en svensk bruger læste «Företag (hoppa
    // över)», som heller ikke betyder det samme som «spring over».
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await tilTrin(3);
      expect(value(lang, "onboarding.companyLabel"), `${lang}`).not.toBe("");
      expect(findAlle(value(lang, "onboarding.companyLabel"))).toHaveLength(1);
    }
  }, 30_000);

  it("viser «Ollama (lokal)» på brugerens sprog i AI-trinnet", async () => {
    // `label: "Ollama (lokal)"` lå i konstanten, så kun den danske halvdel af
    // navnet var dansk — og den var den eneste. Navnet står derfor i en nøgle,
    // mens de fire andre udbydere bliver stående som produktnavne.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      await tilTrin(5);
      // `<select>` er det eneste felt i AI-trinnet, så den findes på egen hånd.
      // `getByDisplayValue` matcher den valgte *tekst* («OpenAI»), ikke
      // værdien («openai»), så den kan ikke bruges her.
      const valg = document.querySelector("select") as HTMLSelectElement;
      expect(valg, lang).toBeTruthy();
      const etiketter = Array.from(valg.options).map((o) => o.textContent);
      expect(etiketter, lang).toContain(value(lang, "ai.providerOllama"));
      // De fire andre er produktnavne og er de samme på alle sprog.
      for (const navn of [
        "OpenAI",
        "Claude (Anthropic)",
        "Google Gemini",
        "OpenRouter",
      ]) {
        expect(etiketter, `${lang}:${navn}`).toContain(navn);
      }
    }
  }, 30_000);

  it("dømmer også de nøgler der med vilje ligner dansk", async () => {
    // «Ollama (lokal)» er ens i dansk, svensk og norsk, så en afvigelsestest
    // springer den over. Den dømmes derfor direkte mod json'en i alle 5 sprog.
    for (const lang of ALLE_LANG) {
      expect(value(lang, "ai.providerOllama"), `${lang}`).not.toBe("");
    }
    expect(value("en", "ai.providerOllama")).toBe("Ollama (local)");
  });

  it("har en oversat nøgle til API-nøglens pladsholder i alle 5 sprog", () => {
    // `?? "API-nøgle..."` lå i en `??` inde i en JSX-attribut, så hverken
    // porten eller `i18n.test.ts` så den — den var den eneste danske streng i
    // wizarden, porten ikke kendte. Grenen kan ikke nås fra UI'et (udbyderen
    // vælges altid i listen), så det dømmes mod json'en: med
    // `fallbackLng: "da"` ville en manglende nøle se ud som om den virkede.
    for (const lang of ALLE_LANG) {
      expect(value(lang, "ai.apiKeyPlaceholder"), `${lang}`).not.toBe("");
    }
    expect(value("da", "ai.apiKeyPlaceholder")).toBe("API-nøgle...");
    expect(value("de", "ai.apiKeyPlaceholder")).toBe("API-Schlüssel...");
  });

  it("viser punktum i privatlivslisten i stedet for en HTML-entitet", () => {
    // `&#x2022;` blev skrevet som entitet, så porten dømte bogstavet i `x2022`
    // som dansk tekst — en undtagelse, der dækkede et tegn, der ikke er sprog.
    // Selve tegnet er uændret: React tolker begge dele som „•".
    expect(kilde).toContain("•");
    expect(kilde).not.toContain("&#x2022;");
    expect(value("da", "privacy.bullet1")).not.toBe("");
  });
});
