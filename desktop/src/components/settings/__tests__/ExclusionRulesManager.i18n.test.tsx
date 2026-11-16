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
 * de regler den skal — og med de fejl den skal fejle med. `ExclusionRulesManager`
 * kalder `tauriInvoke`, som går lige til `invoke`, så mocken dømmer den rigtige
 * vej.
 */
let regler: unknown[] = [];
let fejl: Record<string, unknown> = {};
let kald = 0;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "list_exclusion_rules") kald += 1;
    if (cmd in fejl) throw fejl[cmd];
    if (cmd === "list_exclusion_rules") return regler;
    return null;
  },
}));

import { useToastStore } from "@/stores/toastStore";
import { ExclusionRulesManager } from "../ExclusionRulesManager";

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

/** Nøglen → den sætning brugeren skal se. */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

/** Nøglerne deres `<option>`-etiketter kommer fra. */
const FELT = ["exclusion.windowTitle", "exclusion.appName"] as const;
const OPS = [
  "exclusion.opContains",
  "exclusion.opEquals",
  "exclusion.opStartsWith",
  "exclusion.opRegex",
] as const;

/** Altid synligt som tekst: etiketterne i de to lister, knappen og feltet. */
const I_TEKST = [
  ...FELT,
  ...OPS,
  "exclusion.add",
  "exclusion.valuePlaceholder",
] as const;

/** Altid synligt som `aria-label` — skærmlæseren læser dem, øjet gør ikke. */
const I_ETIKET = [
  "exclusion.field",
  "exclusion.operator",
  "exclusion.value",
] as const;

/** En regel som den ser ud, når den kommer fra Rust. */
function regel(felt: string, op: string, value: string) {
  return {
    id: 7,
    field: felt,
    op,
    value,
    is_active: true,
    created_at: "2026-09-30 09:00:00",
  };
}

/** `<option>`-teksterne i rækkefølge. */
function options(label: string): string[] {
  return screen
    .getAllByLabelText(label)
    .flatMap((felt) =>
      Array.from(felt.querySelectorAll("option")).map(
        (o) => o.textContent ?? "",
      ),
    );
}

/** Toasts i den rækkefølge de blev skabt. */
function toasts() {
  return useToastStore.getState().toasts;
}

beforeEach(() => {
  regler = [];
  fejl = {};
  kald = 0;
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  cleanup();
  regler = [];
  fejl = {};
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

/**
 * Eksklusionsreglerne holdt 15 danske strenge på egne linjer i 30/9 — to
 * `<option>`-etiketter, fire operatorer, tre `aria-label`, pladsholderen,
 * knappen, bekræftelsens to knapper, en skærmlæser-etiket og to toasts. Det er
 * den side en freelancer tager hen til, når han vil have sin bankkonto og sine
 * private vinduer holdt ude af tidsregistreringen — altså lige præcis den
 * privatlivsgaranti, der er appens salgsargument.
 *
 * `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men ingen af dem ser, om
 * den *valgte* nøgle overhovedet havner i DOM'en. Her skifter testen sprog og
 * dømmer de værdier, der afviger fra dansk.
 */
describe("Eksklusionsregler følger appens sprog", () => {
  it("har en oversættelse for hver nøgle i alle 5 sprog", () => {
    // `i18n` har `fallbackLng: "da"`, så en nøgle der mangler i `de.json`
    // vises på dansk *uden* at nogen port siger det. Derfor dømmer denne test
    // json'en direkte: den kan se de nøgler, hvis sætning med vilje er den
    // samme på flere sprog ("Operator", "regex", "Felt" på norsk).
    const nøgler: string[] = [
      ...I_TEKST,
      ...I_ETIKET,
      "exclusion.deleteRule",
      "exclusion.ruleAdded",
      "exclusion.loadFailed",
      "exclusion.deleteFailed",
      "common.delete",
      "common.cancel",
    ];
    const manglende = ALLE_LANG.flatMap((lang) =>
      nøgler
        .filter((key) => TABLES[lang].get(key) === undefined)
        .map((key) => `${lang}: ${key}`),
    );
    expect(manglende).toEqual([]);
  });

  it("viser dansk på dansk", () => {
    render(<ExclusionRulesManager />);
    expect(options(value("da", "exclusion.field"))).toEqual(
      FELT.map((k) => value("da", k)),
    );
    expect(options(value("da", "exclusion.operator"))).toEqual(
      OPS.map((k) => value("da", k)),
    );
    expect(screen.getByText(value("da", "exclusion.add"))).toBeTruthy();
    expect(
      screen.getByPlaceholderText(value("da", "exclusion.valuePlaceholder")),
    ).toBeTruthy();
  });

  for (const lang of ["en", "sv", "nb", "de"] as Lang[]) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      render(<ExclusionRulesManager />);

      // Hver sætning skal kunne findes, uanset om den tilfældigvis er ens
      // med den danske: `Felt` hedder "Felt" på norsk, `Operator` på fire
      // sprog, og `regex` er regex overalt.
      for (const key of I_TEKST) {
        const sætning = value(lang, key);
        const fundet =
          screen.queryAllByText(sætning).length +
          screen.queryAllByPlaceholderText(sætning).length;
        expect({ key, fundet: fundet > 0 }).toEqual({ key, fundet: true });
      }
      for (const key of I_ETIKET) {
        expect({
          key,
          fundet: screen.queryAllByLabelText(value(lang, key)).length > 0,
        }).toEqual({ key, fundet: true });
      }

      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      const dømte = [...I_TEKST, ...I_ETIKET].filter(
        (key) => value(lang, key) !== value("da", key),
      );
      expect(dømte.length).toBeGreaterThanOrEqual(5);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      for (const key of dømte) {
        const dansk = value("da", key);
        const lækage =
          screen.queryAllByText(dansk).length +
          screen.queryAllByPlaceholderText(dansk).length +
          screen.queryAllByLabelText(dansk).length;
        expect({ key, lækage }).toEqual({ key, lækage: 0 });
      }
    });
  }

  it("skriver reglen med etiketterne i brugerens sprog", async () => {
    // Rækken læses `Vinduestitel indeholder "KeePass"`. Rust sender værdierne,
    // så etiketterne kommer fra kortene — og hvis en af dem ikke fandtes, faldt
    // den tilbage til nøglens navn, som ingen bruger kan læse.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      regler = [regel("window_title", "contains", "KeePass")];
      render(<ExclusionRulesManager />);

      const række = await screen.findByText(/"KeePass"/);
      expect(række.parentElement?.textContent).toBe(
        `${value(lang, "exclusion.windowTitle")} ${value(lang, "exclusion.opContains")} "KeePass"`,
      );
      cleanup();
    }
  });

  it("viser et felt brugeren ikke kender, som det er", async () => {
    // En regel fra en nyere appversion kan have et felt eller en operator der
    // ikke findes i kortene. Så må vi ikke vise den rå nøgle fra json'en —
    // brugeren skal kunne genkende reglen og slette den.
    await i18n.changeLanguage("de");
    regler = [regel("url", "matches", "minbank.dk")];
    render(<ExclusionRulesManager />);

    const række = await screen.findByText(/"minbank.dk"/);
    expect(række.parentElement?.textContent).toBe('url matches "minbank.dk"');
  });

  it("bekræfter og sletter i brugerens sprog", async () => {
    // "Slet" og "Annullér" lå på egne linjer; de genbruges nu fra `common`, så
    // de følger resten af appens knapper.
    await i18n.changeLanguage("de");
    regler = [regel("app_name", "equals", "KeePass")];
    render(<ExclusionRulesManager />);

    fireEvent.click(
      await screen.findByLabelText(value("de", "exclusion.deleteRule")),
    );
    expect(screen.getByText(value("de", "common.delete"))).toBeTruthy();
    expect(screen.getByText(value("de", "common.cancel"))).toBeTruthy();
  });

  it("bekrefter en tilføjet regel i brugerens sprog", async () => {
    await i18n.changeLanguage("sv");
    render(<ExclusionRulesManager />);

    fireEvent.change(
      screen.getByPlaceholderText(value("sv", "exclusion.valuePlaceholder")),
      {
        target: { value: "KeePass" },
      },
    );
    fireEvent.click(screen.getByText(value("sv", "exclusion.add")));

    await vi.waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].message).toBe(value("sv", "exclusion.ruleAdded"));
    expect(toasts()[0].type).toBe("success");
  });

  it("henter reglerne én gang, også efter et sprogskift", async () => {
    // `load` fik `t` i sine afhængigheder, fordi den skal kunne sige hvad der
    // gik galt. Hvis `t` ikke er stabil, skifter `load` identitet hver render,
    // og `useEffect([load])` henter reglerne igen — og igen. Det ville være en
    // uafsluttet løkke mod databasen, så tælleren dømmer den.
    render(<ExclusionRulesManager />);
    await vi.waitFor(() => expect(kald).toBe(1));

    await i18n.changeLanguage("de");
    await vi.waitFor(() =>
      expect(screen.getByText(value("de", "exclusion.add"))).toBeTruthy(),
    );
    // Ét sprogskift må genindlæse listen — to ville være en løkke.
    expect(kald).toBeLessThanOrEqual(2);
  });

  it("siger i brugerens sprog når en regel ikke kan gemmes", async () => {
    // Fejlen ved tilføjelse viste database-teksten råt, mens sletning viste en
    // sætning. Én fil skal svare det samme på begge veje — og brugeren skal
    // vide at reglen *ikke* er med.
    await i18n.changeLanguage("de");
    fejl = { add_exclusion_rule: "database is locked" };
    render(<ExclusionRulesManager />);

    fireEvent.change(
      screen.getByPlaceholderText(value("de", "exclusion.valuePlaceholder")),
      {
        target: { value: "KeePass" },
      },
    );
    fireEvent.click(screen.getByText(value("de", "exclusion.add")));

    await vi.waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].message).toBe(value("de", "exclusion.addFailed"));
    expect(toasts()[0].type).toBe("error");
  });

  it("siger i brugerens sprog når reglerne ikke kan hentes", async () => {
    // Listen blev sluppet med en tom `catch` og kommentaren "Non-critical".
    // Brugeren så en tom liste og troede han ikke havde nogen regler — en regel
    // han ikke kan se, er en regel han ikke kan slette. Og efter en tilføjelse
    // står den nye regel ikke i listen, selv om toasten siger at den er der.
    await i18n.changeLanguage("nb");
    fejl = { list_exclusion_rules: "database låst" };
    render(<ExclusionRulesManager />);

    await vi.waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].message).toBe(value("nb", "exclusion.loadFailed"));
    expect(toasts()[0].type).toBe("error");
  });

  it("siger i brugerens sprog når en regel ikke kan slettes", async () => {
    // Sletningen viste database-fejlen råt. Det vigtige for brugeren er ikke at
    // `SQLITE_BUSY` hed, men at reglen stadig er med — han troede han havde
    // fjernet en regel, der holder hans private vinduer ude.
    await i18n.changeLanguage("en");
    regler = [regel("window_title", "contains", "KeePass")];
    fejl = { delete_exclusion_rule: "database is locked" };
    render(<ExclusionRulesManager />);

    fireEvent.click(
      await screen.findByLabelText(value("en", "exclusion.deleteRule")),
    );
    fireEvent.click(await screen.findByText(value("en", "common.delete")));

    await vi.waitFor(() => expect(toasts()).toHaveLength(1));
    expect(toasts()[0].message).toBe(value("en", "exclusion.deleteFailed"));
    expect(toasts()[0].type).toBe("error");
    expect(toasts()[0].message).not.toContain("locked");
  });
});
