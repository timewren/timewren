import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

/**
 * Hvert `invoke`-kald fanges her, så testen kan få backend'en til at svare med
 * de poster den skal — og med den fejl den skal fejle med. `EntrySelector`
 * kalder `tauriInvoke`, som går lige til `invoke`, så mocken dømmer den rigtige
 * vej.
 */
let poster: unknown[] = [];
let kunder: unknown[] = [];
let fejl: Record<string, unknown> = {};
let kaldsLog: { cmd: string; args?: Record<string, unknown> }[] = [];
/** Sættes når et kald skal stå åbent, så testen kan se knappen imens. */
let holtSvar: { svar: (v: unknown) => void } | null = null;

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args?: Record<string, unknown>) => {
    kaldsLog.push({ cmd, args });
    if (cmd in fejl) throw fejl[cmd];
    if (cmd === "list_time_entries") return poster;
    if (cmd === "list_clients") return kunder;
    if (cmd === "create_invoice_from_entries") {
      if (holtSvar) {
        return new Promise((resolve) => {
          holtSvar = { svar: resolve };
        });
      }
      return { id: "f1", clientId: "c1" };
    }
    return null;
  },
}));

import { useToastStore } from "@/stores/toastStore";
import { EntrySelector } from "../EntrySelector";

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

/** Samme nøgle med et bestemt antal — pluralformerne dømmes sådan. */
function medAntal(lang: Lang, key: string, count: number) {
  const rå =
    TABLES[lang].get(count === 1 ? `${key}_one` : `${key}_other`) ?? "";
  return rå.replace("{{count}}", String(count));
}

/** Timer formateret i *brugerens* sprog, som `formatHours` gør. */
function timer(lang: Lang, timer: number) {
  const sætning = medAntal(lang, "invoices.selectedHours", timer);
  return sætning.replace(
    "{{hours}}",
    new Intl.NumberFormat(lang, {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(timer),
  );
}

/**
 * Synlige uden et valg. `selectClientToSeeEntries` er den tomme listes sætning,
 * så den kræver at * ingen * poster kan vises — ellers står postene.
 */
const I_TEKST = [
  "invoices.createFromEntries",
  "invoices.selectClientPlaceholder",
  "invoices.searchEntriesPlaceholder",
  "invoices.selectClientToSeeEntries",
] as const;

/** Samme flade, når brugeren har valgt en kunde og mindst en post. */
const I_TEKST_VALGT = [
  "invoices.creating",
  "invoices.createWithCount",
  "invoices.selectAllEntries",
  "invoices.entriesSelected",
  "invoices.selectedHours",
] as const;

/**
 * Nøgler med et antal i sig. `creating` er ikke en af dem — den læses mens
 * kaldet er i gang, og antallet står i knappen ved siden af den. Ellers ville
 * porten kræve `creating_one`, som ingen skriver.
 */
const MED_ANTAL = I_TEKST_VALGT.filter((k) => k !== "invoices.creating");

const TOASTS = [
  "invoices.invoiceCreated",
  "invoices.createFromEntriesFailed",
  "invoices.entriesLoadFailed",
] as const;

function post(nr: number) {
  return {
    id: `e${nr}`,
    description: `Arbejde ${nr}`,
    project_name: "Webshop",
    client_id: "c1",
    client_name: "Kunde A",
    is_running: false,
    is_billable: true,
    duration: 3600 * nr,
    start_time: `2026-09-2${nr}T09:00:00`,
  };
}

function toasts() {
  return useToastStore.getState().toasts;
}

/** Vælg klienten og dens første post, så knappen og summeringen findes. */
async function vaelgKundeOgPoster() {
  const kunde = await screen.findByRole("option", { name: "Kunde A" });
  fireEvent.change(kunde.closest("select") as HTMLSelectElement, {
    target: { value: "c1" },
  });
  const forste = await screen.findByText("Arbejde 1");
  fireEvent.click(forste.closest("button") as HTMLButtonElement);
}

function renderDialog(onCreated = () => {}) {
  return render(
    <EntrySelector open onClose={() => {}} onCreated={onCreated} />,
  );
}

beforeEach(() => {
  poster = [post(1), post(2)];
  kunder = [{ id: "c1", name: "Kunde A" }];
  fejl = {};
  kaldsLog = [];
  useToastStore.setState({ toasts: [] });
});

afterEach(async () => {
  cleanup();
  poster = [];
  kunder = [];
  fejl = {};
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

/**
 * `EntrySelector` er vejen til en faktura: brugeren vælger en kunde, hakker de
 * tidsregistreringer der skal faktureres, og trykker på knappen. **En post der
 * mangler i denne dialog er en post brugeren ikke fakturerer**, så dialogens
 * tekst er ikke kosmetik — den er det sidste led før pengene.
 *
 * Filen holdt 30/9 tolv danske strenge. Syv af dem lå i portens synsfelt, så
 * `i18n.test.ts` dømmer dem rå; de fem øvrige lå i **JSX-terninger** og -udtryk,
 * som ingen port ser (K36 målte den blinde plet). Her skifter testen sprog og
 * dømmer de værdier, der faktisk ender i DOM'en.
 */
describe("Valg af tidsregistreringer følger appens sprog", () => {
  it("har en oversættelse for hver nøgle i alle 5 sprog", () => {
    // `i18n` har `fallbackLng: "da"`, så en nøgle der mangler i `de.json`
    // vises på dansk *uden* at nogen port siger det. Derfor dømmer denne test
    // json'en direkte — også pluralformerne, som kun findes med `_one`/`_other`.
    const nøgler: string[] = [
      ...I_TEKST,
      ...TOASTS,
      "invoices.creating",
      "invoices.noBillableEntries",
      "invoices.noDescription",
      // Nøgler med et antal findes *kun* som `_one`/`_other`, så porten
      // spørger efter formerne og ikke efter nøglen uden.
      ...MED_ANTAL.flatMap((k) => [`${k}_one`, `${k}_other`]),
    ];
    const manglende = ALLE_LANG.flatMap((lang) =>
      nøgler
        .filter((key) => TABLES[lang].get(key) === undefined)
        .map((key) => `${lang}: ${key}`),
    );
    expect(manglende).toEqual([]);
  });

  it("viser dansk på dansk", async () => {
    poster = [];
    renderDialog();
    expect(
      await screen.findByText(value("da", "invoices.createFromEntries")),
    ).toBeTruthy();
    expect(
      screen.getByText(value("da", "invoices.selectClientPlaceholder")),
    ).toBeTruthy();
    expect(
      screen.getByPlaceholderText(
        value("da", "invoices.searchEntriesPlaceholder"),
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(value("da", "invoices.selectClientToSeeEntries")),
    ).toBeTruthy();
  });

  for (const lang of ["en", "sv", "nb", "de"] as Lang[]) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      poster = [];
      renderDialog();
      await screen.findByText(value(lang, "invoices.createFromEntries"));

      // Hver sætning skal kunne findes, uanset om den tilfældigvis er ens med
      // den danske: «Vælg alle (3)» hedder det samme på alle fem sprog.
      for (const key of I_TEKST) {
        const sætning = value(lang, key);
        const fundet =
          screen.queryAllByText(sætning).length +
          screen.queryAllByPlaceholderText(sætning).length;
        expect({ key, fundet: fundet > 0 }).toEqual({ key, fundet: true });
      }

      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      const dømte = I_TEKST.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      expect(dømte.length).toBeGreaterThanOrEqual(3);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      for (const key of dømte) {
        const dansk = value("da", key);
        const lækage =
          screen.queryAllByText(dansk).length +
          screen.queryAllByPlaceholderText(dansk).length;
        expect({ key, lækage }).toEqual({ key, lækage: 0 });
      }
    });
  }

  it("viser de sætninger der kræver en valgt kunde, i alle sprog", async () => {
    // Knappen, «vælg alle» og summeringen ligger bag en klient og et postvalg,
    // så de holdt dansk usynlige for de to tests ovenfor. Der vælges ÉN post,
    // så pluralformen er `_one` — mangler den, falder de tilbage på dansk uden
    // at nogen port siger det.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      renderDialog();
      await vaelgKundeOgPoster();

      for (const key of I_TEKST_VALGT) {
        // «Vælg alle» tæller alle fundne poster, resten de valgte — så samme
        // test dømmer to forskellige antal, som de to nøgler kræver.
        const sætning =
          key === "invoices.selectedHours"
            ? timer(lang, 1)
            : medAntal(lang, key, key === "invoices.selectAllEntries" ? 2 : 1);
        const fundet =
          screen.queryAllByText(sætning).length +
          screen.queryAllByText(sætning, { exact: false }).length;
        expect({ lang, key, fundet: fundet > 0 }).toEqual({
          lang,
          key,
          fundet: true,
        });
      }
      cleanup();
    }
  });

  it("siger at fakturaen er ved at blive lavet", async () => {
    // «Opretter...» lå i en JSX-terning, så ingen port så den. Den står kun
    // mens kallet er i gang, så testen holder svaret tilbage og dømmer
    // imens — ellers ville den være grøn uden at sætningen nogensinde vises.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      renderDialog();
      await vaelgKundeOgPoster();

      fireEvent.click(
        screen.getByText(medAntal(lang, "invoices.createWithCount", 1)),
      );

      expect(screen.getByText(value(lang, "invoices.creating"))).toBeTruthy();
      // Knappen må ikke sige begge dele ad gangen.
      expect(
        screen.queryByText(medAntal(lang, "invoices.createWithCount", 1)),
      ).toBeNull();

      holtSvar?.svar({ id: "f1", clientId: "c1" });
      await waitFor(() => {
        expect(holtSvar).toBeNull();
      });
      cleanup();
    }
  });

  it("tæller poster og timer i det sprog brugeren har valgt", async () => {
    // Knappen siger «Opret faktura (2 poster)» og summeringen «2 poster valgt» +
    // «3,0 timer». Pluralsformen og decimaltegnet er begge dele af, om brugeren
    // kan læse hvad han er ved at fakturere: tysk «Einträge», dansk «poster», og
    // kun énbetydigt, hvis formen følger antallet.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      renderDialog();
      await vaelgKundeOgPoster();
      fireEvent.click(await screen.findByText("Arbejde 2"));

      for (const key of [
        "invoices.createWithCount",
        "invoices.selectAllEntries",
        "invoices.entriesSelected",
      ]) {
        expect(screen.getByText(medAntal(lang, key, 2))).toBeTruthy();
      }
      // 1 time + 2 timer = 3 timer, formateret i *brugerens* sprog.
      expect(screen.getByText(timer(lang, 3))).toBeTruthy();
      cleanup();
    }
  });

  it("siger fra når der ikke er fakturerbare poster for kunden", async () => {
    // Den anden tomme sætning: kunden er valgt, men intet er fakturerbart.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      poster = [];
      renderDialog();
      const kunde = await screen.findByRole("option", { name: "Kunde A" });
      fireEvent.change(kunde.closest("select") as HTMLSelectElement, {
        target: { value: "c1" },
      });
      expect(
        await screen.findByText(value(lang, "invoices.noBillableEntries")),
      ).toBeTruthy();
      cleanup();
    }
  });

  it("siger fra når en post ingen beskrivelse har", async () => {
    // En auto-tracked post kan stå uden beskrivelse og uden projekt. Den skal
    // stadig kunne genkendes — «Uden beskrivelse» lå i et JSX-udtryk, så ingen
    // port så den.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      poster = [{ ...post(1), description: null, project_name: null }];
      renderDialog();
      expect(
        await screen.findByText(value(lang, "invoices.noDescription")),
      ).toBeTruthy();
      cleanup();
    }
  });

  it("siger at posterne ikke kunne hentes", async () => {
    // 30/9 var `catch`en en ren `console.error`. Brugeren så en tom liste, og
    // den tomme liste siger «Ingen fakturerbare poster fundet for denne klient»:
    // han troede han havde tjekket sin tid og fundet ingenting. En post der
    // ikke kan hentes, skal sige det — ellers fakturerer han for lidt uden at
    // vide det.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      fejl = { list_time_entries: "database is locked" };
      renderDialog();

      // 1/10: fejlen var en toast, og en toast forsvinder. Den skal stå i
      // DOM'en, ellers er den kun en besked brugeren kan nå at overse — og så
      // står «Ingen fakturerbare poster fundet» under den, som den modsiger.
      await waitFor(() => {
        expect(
          screen.getByText(value(lang, "invoices.entriesLoadFailed")),
        ).toBeTruthy();
      });
      // Og den skal have en prøv-igen, ellers må brugeren lukke og åbne igen.
      expect(
        screen.getByRole("button", {
          name: new RegExp(value(lang, "errors.tryAgain")),
        }),
      ).toBeTruthy();
      // Den må ikke stå oven i den tomme tilstand, den erstatter.
      expect(
        screen.queryByText(value(lang, "invoices.noBillableEntries")),
      ).toBe(null);
      cleanup();
      fejl = {};
    }
  });

  it("skifter mellem de to toasts, altid i brugerens sprog", async () => {
    // Samme fejlvej som ovenfor, men for oprettelsen: en faktura der ikke blev
    // lavet. Først en der lykkes, så en der kaster — i samme sprog.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      cleanup();
      useToastStore.setState({ toasts: [] });
      const onCreated = vi.fn();
      renderDialog(onCreated);
      await vaelgKundeOgPoster();
      fireEvent.click(
        screen.getByText(medAntal(lang, "invoices.createWithCount", 1)),
      );
      await waitFor(() => {
        expect(toasts().map((t) => t.message)).toContain(
          value(lang, "invoices.invoiceCreated"),
        );
      });
      expect(onCreated).toHaveBeenCalledTimes(1);
      cleanup();

      fejl = { create_invoice_from_entries: "period locked" };
      renderDialog(onCreated);
      await vaelgKundeOgPoster();
      fireEvent.click(
        screen.getByText(medAntal(lang, "invoices.createWithCount", 1)),
      );
      await waitFor(() => {
        expect(toasts().map((t) => t.message)).toContain(
          value(lang, "invoices.createFromEntriesFailed"),
        );
      });
      // Den lykkede faktura må ikke tælles med i den fejlede.
      expect(onCreated).toHaveBeenCalledTimes(1);
      cleanup();
      fejl = {};
    }
  });

  it("genindlæser listen én gang ved et sprogskift, ikke i en løkke", async () => {
    // `load` har `t` i sine afhængigheder, så et sprogskift genindlæser listen
    // med den nye sætning. Er `t` ikke stabil, kører hvert render listen igen,
    // og brugeren får en henteløkke mod databasen — i en dialog der indlæser
    // hele tidsregistreringerne. Tælleren dømmer den.
    renderDialog();
    await screen.findByText("Arbejde 1");
    const før = kaldsLog.filter((k) => k.cmd === "list_time_entries").length;

    await i18n.changeLanguage("de");
    await screen.findByText("Arbejde 1");
    // Ét sprogskift må genindlæse listen — to ville være en løkke.
    const efter = kaldsLog.filter((k) => k.cmd === "list_time_entries").length;
    expect(efter - før).toBeLessThanOrEqual(1);
  });

  it("beder om de 30 dages grænser som hele dage", async () => {
    // Dato-felterne sender `…T00:00:00Z` og `…T23:59:59Z`. Rusts `dagsgrev`
    // (K41) stripper netop `Z` og udvider kun en *ren* dato, så grænserne er
    // korrekte i dag — men det er en kontrakt mellem to sider, og det er en
    // test der dømmer den. `…Z` i en streng `dagsgrev` ikke genkender, ville
    // stille spørgsmål ved hver time i døgnet.
    renderDialog();
    await screen.findByText("Arbejde 1");

    // Første indlæsning kører med tomme felter (grænserne sættes i en effekt
    // efter mount), så det er den *sidste* kald der bærer de 30 dage.
    const kalde = kaldsLog.filter((k) => k.cmd === "list_time_entries");
    const kald = kalde[kalde.length - 1];
    expect(kald?.args?.from).toMatch(/^\d{4}-\d{2}-\d{2}T00:00:00Z$/);
    expect(kald?.args?.to).toMatch(/^\d{4}-\d{2}-\d{2}T23:59:59Z$/);
  });

  it("giver de fire felter et navn, en skærmlæser kan læse højt", async () => {
    // Klientfilteret og de to datoer stod som «redigerbar» uden et navn, og
    // søgefeltet havde kun en pladsholder — den forsvinder, så snart der er
    // skrevet i feltet. Porten `FormularfelterMedNavn` dømmer at koden har
    // navnet; denne dømmer at det *renderede* felt har det, i alle fem sprog,
    // fordi `i18n` har `fallbackLng: "da"` — en nøgle der mangler i `de.json`
    // ville vise dansk uden at nogen port sige det.
    for (const lang of ALLE_LANG) {
      await i18n.changeLanguage(lang);
      const { unmount } = renderDialog();
      await screen.findByText("Arbejde 1");

      for (const key of [
        "invoices.clientFilter",
        "invoices.dateFrom",
        "invoices.dateTo",
        "invoices.searchEntries",
      ]) {
        expect(
          screen.getByLabelText(value(lang, key)),
          `${lang}: ${key} mangler i den renderede dialog`,
        ).toBeTruthy();
      }
      unmount();
    }
  });

  it("viser ikke løbende eller ikke-fakturerbare poster", async () => {
    // Fakturaen må kun indeholde det der faktisk kan faktureres: en løbende
    // timer, en ikke-fakturerbar post og en post uden varighed er ikke noget
    // brugeren kan sende til kunden.
    poster = [
      post(1),
      { ...post(2), is_running: true },
      { ...post(3), is_billable: false },
      { ...post(4), duration: 0 },
    ];
    renderDialog();
    await screen.findByText("Arbejde 1");

    expect(
      screen.getByText(medAntal("da", "invoices.selectAllEntries", 1)),
    ).toBeTruthy();
    expect(screen.queryByText("Arbejde 2")).toBeNull();
    expect(screen.queryByText("Arbejde 3")).toBeNull();
    expect(screen.queryByText("Arbejde 4")).toBeNull();
  });
});
