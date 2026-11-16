import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import type { InvoiceDraft } from "@/lib/types";
import da from "@/locales/da.json";
import de from "@/locales/de.json";
import en from "@/locales/en.json";
import nb from "@/locales/nb.json";
import sv from "@/locales/sv.json";
import { useToastStore } from "@/stores/toastStore";

/**
 * Hvert `invoke`-kald fanges her, så testen kan få backend'en til at svare med
 * det, den skal. `InvoiceEditor` kalder `tauriInvoke`, som går lige til
 * `invoke` — så mocken dømmer den rigtige vej.
 */
let svar: Record<string, unknown> = {};
let kalder: { cmd: string; args: Record<string, unknown> }[] = [];
let fejl: Record<string, unknown> = {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
    kalder.push({ cmd, args });
    if (cmd in fejl) throw fejl[cmd];
    return svar[cmd];
  },
}));

import { InvoiceEditor } from "../InvoiceEditor";

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

/** Nøglen → den sætning brugeren skal se, med `{{rate}}` sat ind. */
function value(lang: Lang, key: string, rate?: number): string {
  const rå = TABLES[lang].get(key) ?? "";
  return rate === undefined ? rå : rå.replaceAll("{{rate}}", String(rate));
}

const RATE = 25;

/** Ét af beløbene på skærmen, formateret i det aktive sprog. */
function beløb(tal: number): string {
  return new Intl.NumberFormat(i18n.language, {
    style: "currency",
    currency: "DKK",
    minimumFractionDigits: 2,
  }).format(tal);
}

/**
 * Slå en værdi op i DOM'en uden at røre ved mellemrum.
 *
 * Testbibliotekets forvalg normaliserer tekst, og dets `\s` matcher også det
 * ulæselige mellemrum (U+00A0), som `Intl` sætter mellem tal og valutasymbol —
 * "1.000,00␣kr.". Uden den her ville søgningen slå fejlen på den *danske*
 * beløbsvisning alene, fordi den forventede streng havde et ægte mellemrum
 * mellem tal og "kr." hvor DOM'en har det ulæselige. Det ville få testen til at
 * fejle på det rigtige talformat i stedet for at dømme det.
 */
const UØRET = { normalizer: (tekst: string) => tekst.trim() } as const;

/** `getAllByText` der sammenligner den rå tekst. */
function findAlle(tekst: string) {
  return screen.queryAllByText(tekst, UØRET);
}

/**
 * Nøgler der står i den redigerede faktura. `invoices.description` er både
 * kolonneoverskrift og linjens felt, og `common.notes` er feltets etiket, så
 * de dømmes på pladsholderens og etikettens *fulde* tekst.
 */
const I_EDITOREN = [
  "invoices.dueDate",
  "invoices.vatRate",
  "invoices.description",
  "invoices.quantity",
  "invoices.unitPrice",
  "invoices.amount",
  "invoices.addLine",
  "invoices.subtotal",
  "invoices.total",
  "common.notes",
  "invoices.exportCsv",
  "invoices.exportPdf",
  "invoices.sendToBilly",
  "invoices.draft",
] as const;

const PLADSHOLDERE = [
  "invoices.titlePlaceholder",
  "invoices.notesPlaceholder",
] as const;

function faktura(): InvoiceDraft {
  return {
    id: "faktura-0001",
    client_id: "kunde-1",
    client_name: "Kunde A/S",
    title: "Konsulentarbejde maj",
    status: "draft",
    subtotal: 1000,
    vat_rate: RATE,
    total: 1250,
    due_date: "2026-06-01",
    notes: "Netto 14 dage",
    invoice_number: null,
    created_at: "2026-05-01T09:00:00Z",
    updated_at: "2026-05-01T09:00:00Z",
    lines: [
      {
        id: 1,
        invoice_id: "faktura-0001",
        description: "Udarbejdelse",
        quantity: 1,
        unit_price: 1000,
        amount: 1000,
        time_entry_id: null,
        sort_order: 0,
      },
    ],
  };
}

function renderEditor(draft: InvoiceDraft = faktura()) {
  return render(
    <InvoiceEditor invoice={draft} onBack={() => {}} onUpdated={() => {}} />,
  );
}

/** Toasts ligger i en zustand-store, ikke i komponentens egen træ. */
function toasts(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}

beforeEach(() => {
  svar = { get_setting: "hemmelig-nøgle" };
  kalder = [];
  fejl = {};
});

afterEach(async () => {
  cleanup();
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

/**
 * Fakturaeditoren holdt 20 danske strenge på egne linjer i 30/9 — kolonne-
 * overskrifter, etiketter, pladsholdere, alle syv toasts og knappetekster. Det
 * er den skærm en freelancer sender videre til sin kunde, så dens beløb og
 * labels er de, han læser lige før han trykker "send".
 *
 * `i18n.test.ts` dømmer nøgler og rå JSX hver for sig, men ingen af dem ser, om
 * den *valgte* nøgle overhovedet havner i DOM'en. Her skifter testen sprog og
 * dømmer de værdier, der afviger fra dansk.
 */
describe("Fakturaeditoren følger appens sprog", () => {
  it("viser dansk på dansk", () => {
    renderEditor();
    for (const key of I_EDITOREN) {
      expect(screen.getAllByText(value("da", key)).length).toBeGreaterThan(0);
    }
    for (const key of PLADSHOLDERE) {
      expect(screen.getByPlaceholderText(value("da", key))).toBeTruthy();
    }
    expect(screen.getByText(value("da", "invoices.vat", RATE))).toBeTruthy();
  });

  for (const lang of ANDRE_LANG) {
    it(`viser ${lang} på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      renderEditor();

      const afvigende = I_EDITOREN.filter(
        (key) => value(lang, key) !== value("da", key),
      );
      // Uden dette ville testen være grøn, hvis visningen bare var blevet tom.
      // Norsk og svensk deler enkelte ord med dansk, så tallet varierer.
      expect(afvigende.length).toBeGreaterThanOrEqual(8);

      const mangler = afvigende.filter(
        (key) => screen.queryAllByText(value(lang, key)).length === 0,
      );
      expect(mangler).toEqual([]);

      // Og ingen dansk fra markup'en må overleve i et ikke-dansk sprog.
      const danske = afvigende.filter(
        (key) => screen.queryAllByText(value("da", key)).length > 0,
      );
      expect(danske).toEqual([]);

      for (const key of PLADSHOLDERE) {
        expect(screen.getByPlaceholderText(value(lang, key))).toBeTruthy();
      }
    });
  }

  it("sætter den valgte momssats i etiketten i alle 5 sprog", async () => {
    // `invoices.vat` læste "Moms (25%)" i dansk, "VAT (25%)" på engelsk og
    // "MwSt. (19%)" på tysk — fire forskellige hårdkodede satser i én nøgle,
    // ingen af dem læste satsen fra feltet brugeren har valgt. Nøglen var død
    // indtil denne opgave, så ingen så fejlen; nu skal den vise den sats, der
    // står i feltet, i alle fem sprog.
    for (const lang of ALLE_LANG) {
      for (const sats of [25, 7.5, 19]) {
        cleanup();
        await i18n.changeLanguage(lang);
        const draft = faktura();
        draft.vat_rate = sats;
        renderEditor(draft);
        expect(
          screen.getByText(value(lang, "invoices.vat", sats)),
        ).toBeTruthy();
      }
    }
  });

  it("formaterer beløb i det aktive sprog, ikke i dansk", async () => {
    // `toLocaleString("da-DK")` stod fire steder, så en tysk bruger fik dansk
    // tusindtalsseparator og dansk decimaltegn oven på tysk tekst — og en
    // "kr." der lå i markup'en. Dansk skal være uændret, så det er ikke en
    // forbedring at se den ændre sig; de fire sprog skal.
    for (const lang of ALLE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      renderEditor();
      // 1.000 kr. linje, 250 kr. moms, 1.250 kr. i alt.
      for (const tal of [1000, 250, 1250]) {
        expect(findAlle(beløb(tal)).length).toBeGreaterThan(0);
      }
    }

    // Bevis på at hovedfejlen faktisk er rettet: de tal, der før stod med
    // dansk format, må ikke overleve i et ikke-dansk sprog.
    await i18n.changeLanguage("de");
    cleanup();
    renderEditor();
    const danskFormat = new Intl.NumberFormat("da", {
      minimumFractionDigits: 2,
    }).format(1250);
    expect(findAlle(`${danskFormat} kr.`).length).toBe(0);
  });

  it("skriver en ny linje på brugerens sprog", async () => {
    // `description: "Ny linje"` lå i koden. Den skrives i fakturaen og kommer
    // med i den eksporterede PDF, så den skal følge med.
    for (const lang of ALLE_LANG) {
      cleanup();
      // `kalder` nulstilles kun i `beforeEach`, så hver sprog iteration skal
      // rydde den — ellers ville `.find` give den danske kald fra første
      // iteration, og testen ville være grøn mod dansk kode i fire sprog.
      kalder = [];
      await i18n.changeLanguage(lang);
      svar.add_invoice_line = {
        ...faktura().lines[0],
        id: 2,
        description: value(lang, "invoices.newLine"),
      };
      svar.get_invoice = faktura();
      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.addLine")));
      await vi.waitFor(() => expect(kalder.length).toBeGreaterThan(0));
      const kald = kalder.find((k) => k.cmd === "add_invoice_line");
      expect((kald?.args.line as { description: string }).description).toBe(
        value(lang, "invoices.newLine"),
      );
    }
  });

  it("siger at nøglen mangler, før den sender noget", async () => {
    // Uden nøgle gav `handleBillyExport` en toast på dansk og sendte intet.
    for (const lang of ANDRE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      svar.get_setting = null;
      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.sendToBilly")));
      await vi.waitFor(() =>
        expect(toasts()).toContain(value(lang, "invoices.billyNoApiKey")),
      );
      expect(kalder.some((k) => k.cmd === "export_invoice_to_billy")).toBe(
        false,
      );
    }
  });

  it("melder alle syv eksport- og Billy-udfald på brugerens sprog", async () => {
    // De fire toasts og de to knaptekster stod på dansk. Hver især dømmes her,
    // fordi de opstår under forskellige betingelser — en samlet test ville
    // springe dem over, der aldrig viser sig samtidig.
    for (const lang of ANDRE_LANG) {
      // Fejlene lægges i `fejl`, ikke i `svar`: mocken *kaster* på en nøgle i
      // `fejl`. Lagde de i `svar`, ville kommandoen svare med et Error-objekt,
      // eksporten ville fortsætte, og toasten ville aldrig komme.
      const fejltilfælde: [Record<string, unknown>, string, string][] = [
        [
          { export_time_entries_csv: new Error("boom") },
          "invoices.exportCsv",
          "invoices.exportCsvFailed",
        ],
        [
          { export_invoice_to_billy: new Error("boom") },
          "invoices.sendToBilly",
          "invoices.billyExportFailed",
        ],
      ];

      for (const [fejlene, knap, forventet] of fejltilfælde) {
        cleanup();
        useToastStore.setState({ toasts: [] });
        await i18n.changeLanguage(lang);
        svar = { get_setting: "hemmelig-nøgle" };
        fejl = fejlene;
        renderEditor();
        fireEvent.click(screen.getByText(value(lang, knap)));
        await vi.waitFor(() =>
          expect(toasts()).toContain(value(lang, forventet)),
        );
        // Dansk fra koden må ikke stå ved siden af.
        expect(toasts()).not.toContain(value("da", forventet));
      }

      // Kun den anden gren af `finalize_invoice`-fejlen er oversat: Rust kan
      // give en streng, og den vises ordret, fordi backend'en ikke kender
      // brugerens sprog. Her svarer den med et Error-objekt.
      cleanup();
      useToastStore.setState({ toasts: [] });
      await i18n.changeLanguage(lang);
      svar = { get_setting: "hemmelig-nøgle" };
      fejl = { finalize_invoice: new Error("mangler afsender") };
      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.exportPdf")));
      await vi.waitFor(() =>
        expect(toasts()).toContain(value(lang, "invoices.finalizeFailed")),
      );

      // Og succes-grenen.
      cleanup();
      useToastStore.setState({ toasts: [] });
      await i18n.changeLanguage(lang);
      fejl = {};
      svar = {
        get_setting: "hemmelig-nøgle",
        export_invoice_to_billy: "ok",
        get_invoice: faktura(),
      };
      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.sendToBilly")));
      await vi.waitFor(() =>
        expect(toasts()).toContain(value(lang, "invoices.exportedToBilly")),
      );
    }
  });

  it("viser rå status for en tilstand koden ikke kender", async () => {
    // `STATUS_LABELS[status] || status` viste det rå navn. Det er ærte: en ny
    // tilstand må ikke låne en andens etiket, fordi den deler nøgle med den.
    const draft = faktura();
    draft.status = "delvist";
    renderEditor(draft);
    expect(screen.getByText("delvist")).toBeTruthy();
    expect(screen.queryByText(value("da", "invoices.draft"))).toBeNull();
  });

  it("oversætter de knapper, der kun findes under betingelser", async () => {
    // `Genererer…` og `Eksporterer…` er de to grene, der aldrig står i DOM'en
    // samtidig med deres hvileform. De dømmes hver for sig.
    for (const lang of ANDRE_LANG) {
      cleanup();
      await i18n.changeLanguage(lang);
      // `finalize_invoice` skal aldrig nå `generate_invoice_html`: PDF-vejen
      // går gennem færdiggørelse først, og her skal vi bare se knappen.
      svar.finalize_invoice = new Promise(() => {});
      svar.get_setting = "hemmelig-nøgle";
      svar.export_invoice_to_billy = new Promise(() => {});

      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.exportPdf")));
      expect(
        screen.getAllByText(value(lang, "invoices.generating")).length,
      ).toBeGreaterThan(0);
      expect(screen.queryByText(value(lang, "invoices.exportPdf"))).toBeNull();

      cleanup();
      await i18n.changeLanguage(lang);
      svar = { get_setting: "hemmelig-nøgle" };
      svar.export_invoice_to_billy = new Promise(() => {});
      renderEditor();
      fireEvent.click(screen.getByText(value(lang, "invoices.sendToBilly")));
      expect(
        screen.getAllByText(value(lang, "invoices.exporting")).length,
      ).toBeGreaterThan(0);
      expect(
        screen.queryByText(value(lang, "invoices.sendToBilly")),
      ).toBeNull();
    }
  });
});
