import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { Client, Project } from "@/lib/types";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

import { KlippekortForm } from "../KlippekortForm";

/**
 * Klippekort-formularen havde otte danske strenge i markup'en: fire
 * påkrævede feltetiketter, to select-pladsholdere og to labels. De lå *uden om*
 * `t()`, så en svensk, norsk eller tysk bruger læste «Navn *», «Vælg klient»
 * og «Timepris (kr) *» på den skærm, hvor de opretter et forudbetalt timekort.
 *
 * To ting dømmer portene ikke, og er derfor hele pointen med denne test:
 *
 * 1. **`Input` udleder sit `id` fra etiketten** (`label.toLowerCase()` med
 *    mellemrum erstattet af `-`). Så snart etiketten kommer fra et sprog, kan to
 *    felter få samme id, og en `<label htmlFor>` peger så på det forkerte felt —
 *    en synlig fejl i hver eneste oversættelse, som ingen tekstport ser.
 * 2. **Påkrævet-markeringen.** Asterisken lå i den danske etikettetekst, så den
 *    skulle følge med. Den dømmes derfor som sit eget nøglesprog: et sprog hvor
 *    den mangler, får et påkrævet felt uden mærke.
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

/** Nøglen → den sætning brugeren skal se. */
function value(lang: Lang, key: string) {
  return TABLES[lang].get(key) ?? "";
}

/**
 * Felterne i den rækkefølge de står i formularen. `krav` siger hvor
 * påkrævet-markeringen kommer fra: `separat` er `common.requiredMark` sat
 * bag på etiketten, `medtaget` er en nøgle der selv indeholder stjernen
 * (`form.nameRequired`, som `ClientForm` og `ProjectForm` også bruger), og
 * `nej` er et valgfrit felt.
 */
const FELT = [
  { navn: "navn", noegle: "form.nameRequired", krav: "medtaget" },
  {
    navn: "klient",
    noegle: "form.clientLabel",
    krav: "separat",
    id: "kk-client",
  },
  {
    navn: "projekt",
    noegle: "timeEntry.project",
    krav: "nej",
    id: "kk-project",
  },
  { navn: "timer", noegle: "klippekort.totalHours", krav: "separat" },
  { navn: "pris", noegle: "klippekort.rateLabel", krav: "separat" },
  { navn: "udloeb", noegle: "klippekort.expiresAt", krav: "nej" },
] as const;

/** Den etiket et felt har i et sprog. */
function etiket(lang: Lang, felt: (typeof FELT)[number]) {
  const grund = value(lang, felt.noegle);
  return felt.krav === "separat"
    ? `${grund} ${value(lang, "common.requiredMark")}`
    : grund;
}

/**
 * Id'et feltet har. `Input` danner det af etikettens tekst, de to `<select>`
 * har et fast id — så begge veje dømmes, fordi `<label for>` peger på præcis
 * det felt, hvilket er det øjet og skærmlæseren følger.
 */
function feltId(lang: Lang, felt: (typeof FELT)[number]) {
  return "id" in felt
    ? felt.id
    : etiket(lang, felt).toLowerCase().replace(/\s+/g, "-");
}

const CLIENTS = [
  { id: "c-acme", name: "Acme", company: "ApS" },
  { id: "c-bolig", name: "Bolig" },
] as Client[];

const PROJECTS = [
  { id: "p-acme-web", name: "Acme web", client_id: "c-acme" },
  { id: "p-eget", name: "Eget arbejde", client_id: null },
] as Project[];

async function aabnFormular(lang: Lang) {
  cleanup();
  await i18n.changeLanguage(lang);
  render(
    <KlippekortForm
      open
      onClose={() => {}}
      onSaved={() => {}}
      klippekort={null}
    />,
  );
  // `useEffect` henter kunder og projekter, så etiketterne skal først slås op
  // når de faktisk står i DOM'en.
  await waitFor(() =>
    expect(
      screen.getByRole("dialog", { name: value(lang, "klippekort.new") }),
    ).toBeTruthy(),
  );
  return screen.getByRole("dialog");
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "list_clients") return Promise.resolve(CLIENTS);
    if (cmd === "list_projects") return Promise.resolve(PROJECTS);
    return Promise.resolve(null);
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

describe("Klippekort-formularen følger appens sprog", () => {
  it("har en oversat etiket på hvert felt i alle 5 sprog", async () => {
    // `fallbackLng: "da"` gør en manglende nøgle usynlig: `t()` svarer med
    // dansk, og skærmen ser rigtig ud. Derfor dømmes json'en direkte — en nøgle
    // der mangler i et sprog har her en tom værdi, og testen stopper med det.
    for (const lang of ALLE_LANG) {
      expect(value(lang, "common.requiredMark"), `${lang}:krav`).not.toBe("");
      for (const felt of FELT) {
        expect(value(lang, felt.noegle), `${lang}:${felt.noegle}`).not.toBe("");
        expect(value(lang, felt.noegle), `${lang}:${felt.noegle}`).not.toBe(
          felt.noegle,
        );
      }
    }
  });

  it("viser hver etiket i det valgte sprog, markeret som de kræver", async () => {
    for (const lang of ALLE_LANG) {
      const dialog = await aabnFormular(lang);
      for (const felt of FELT) {
        const label = screen.getByText(etiket(lang, felt), {
          selector: "label",
        });
        expect(label, `${lang}:${felt.navn}`).toBeTruthy();
        expect(dialog.contains(label), `${lang}:${felt.navn}`).toBe(true);
      }
    }
  });

  it("afsiger intet dansk, der ikke også er det rigtige ord i sproget", async () => {
    // Ellers ville testen ovenfor være grøn, fordi `fallbackLng: "da"` serverede
    // dansk i stedet for den manglende nøgle — præcis den fejl portene ikke ser.
    // Ord der *er* det rigtige ord i målsproget («Navn» på norsk, «Projekt» på
    // svensk og tysk) dømmes ikke her: der er dansk og oversættelse ens.
    for (const lang of ALLE_LANG) {
      if (lang === "da") continue;
      const dialog = await aabnFormular(lang);
      const tekst = dialog.textContent ?? "";
      for (const felt of FELT) {
        const dansk = etiket("da", felt);
        if (etiket(lang, felt) === dansk) continue;
        expect(
          tekst.includes(dansk),
          `${lang}: «${dansk}» overlevde på ${felt.navn}`,
        ).toBe(false);
      }
      for (const [dansk, noegle] of [
        ["Vælg klient", "klippekort.selectClient"],
        ["Intet specifikt projekt", "klippekort.noSpecificProject"],
      ] as const) {
        if (value(lang, noegle) === dansk) continue;
        expect(tekst.includes(dansk), `${lang}: «${dansk}» overlevde`).toBe(
          false,
        );
      }
    }
  });

  it("mærker hvert påkrævet felt med stjernen i alle 5 sprog", async () => {
    // Asterisken lå i den danske etikettetekst, så den skulle følge med
    // oversættelsen. Uden denne dømning kan den forsvunde i alle sprog på
    // én gang, og formularen så ud til at have valgfrie felter.
    for (const lang of ALLE_LANG) {
      const dialog = await aabnFormular(lang);
      const stjerner = [...dialog.querySelectorAll("label")].filter((l) =>
        (l.textContent ?? "")
          .trim()
          .endsWith(value(lang, "common.requiredMark")),
      );
      // Navn, klient, timer og pris — de fire påkrævede.
      expect(stjerner.length, lang).toBe(4);
    }
  });

  it("giver hvert felt sit eget id, så etiketten rammer sit eget felt", async () => {
    // `Input` danner id'et af etikettens tekst. To etiketter der på et sprog
    // bliver ens — eller to der kolliderer efter `toLowerCase()` — giver det
    // samme id, og en `<label htmlFor>` peger da på det forkerte felt. Det er
    // en synlig fejl i hver eneste oversættelse, og ingen tekstport ser den.
    for (const lang of ALLE_LANG) {
      const dialog = await aabnFormular(lang);
      const ids = [...dialog.querySelectorAll("[id]")].map((e) => e.id);
      expect(new Set(ids).size, `${lang}: dublet-id`).toBe(ids.length);
      for (const felt of FELT) {
        const forventet = feltId(lang, felt);
        const element = document.getElementById(forventet);
        expect(element, `${lang}:${felt.navn} har intet id`).toBeTruthy();
        expect(
          dialog.contains(element),
          `${lang}:${felt.navn} ligger i formularen`,
        ).toBe(true);
        // Og etiketten skal pege på præcis det felt.
        const etiketten = [...dialog.querySelectorAll("label")].find(
          (l) => l.getAttribute("for") === forventet,
        );
        expect(etiketten?.textContent?.trim(), `${lang}:${felt.navn}`).toBe(
          etiket(lang, felt),
        );
      }
    }
  });

  it("viser pladsholderne i klient- og projektregisteringen i alle 5 sprog", async () => {
    for (const lang of ALLE_LANG) {
      await aabnFormular(lang);
      for (const noegle of [
        "klippekort.selectClient",
        "klippekort.noSpecificProject",
      ]) {
        const option = screen
          .getAllByRole("option")
          .find((o) => (o.textContent ?? "").trim() === value(lang, noegle));
        expect(option, `${lang}:${noegle}`).toBeTruthy();
        // Pladsholderen er den tomme værdi — elvis valgte den et klippekorts
        // kunde uden at brugeren gjorde noget.
        expect(option?.getAttribute("value"), `${lang}:${noegle}`).toBe("");
      }
    }
  });

  it("viser prisens enhed i det valgte sprog, ikke altid kroner", async () => {
    // `klippekort.rateLabel` er «Timepris (kr)» på dansk og «Stundensatz (€)»
    // på tysk. Med den danske etikett i markup'en fik en tysk bruger en pris i
    // kroner skrevet oven på et euro-felt — det er pengene, ikke en bleg smiley.
    for (const lang of ALLE_LANG) {
      await aabnFormular(lang);
      const pris = screen.getByText(etiket(lang, FELT[4]), {
        selector: "label",
      });
      const enhed = (pris.textContent ?? "").match(/\((.*)\)/)?.[1] ?? "";
      expect(enhed, lang).toBe(
        value(lang, "klippekort.rateLabel").match(/\((.*)\)/)?.[1] ?? "",
      );
    }
    expect(value("da", "klippekort.rateLabel")).toContain("kr");
    expect(value("de", "klippekort.rateLabel")).toContain("€");
  });

  it("beholder kunder og projekter, når sprog og felt er rigtige", async () => {
    // Sidste kontrol: formularen henter sine valg gennem `tauriInvoke`, så en
    // forkert nøgle ville se ud som en tom dropdown — grøn for teksten, hængt
    // for brugeren. Dansk skal derfor vise begge lister.
    const dialog = await aabnFormular("da");
    const tekst = dialog.textContent ?? "";
    expect(tekst).toContain("Acme");
    expect(tekst).toContain("Eget arbejde");
  });
});
