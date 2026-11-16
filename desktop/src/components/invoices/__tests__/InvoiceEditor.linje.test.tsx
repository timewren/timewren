import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
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
 * Hvert `invoke`-kald fanges, så testen kan få backend'en til at svare med det,
 * den skal — og se *hvilke* kommandoer der rent faktisk blev kaldt.
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

function sætning(lang: Lang, key: string): string {
  const tabel = LANGS[lang] as Record<string, unknown> as {
    invoices: Record<string, string>;
  };
  return tabel.invoices[key];
}

function faktura(): InvoiceDraft {
  return {
    id: "faktura-0001",
    client_id: "kunde-1",
    client_name: "Kunde A/S",
    title: "Konsulentarbejde maj",
    status: "draft",
    subtotal: 1000,
    vat_rate: 25,
    total: 1250,
    due_date: "2026-06-01",
    notes: "Netto 14 dage",
    invoice_number: null,
    created_at: "2026-05-01T09:00:00Z",
    updated_at: "2026-05-01T09:00:00Z",
    lines: [
      {
        id: 7,
        invoice_id: "faktura-0001",
        description: "Udarbejdelse",
        quantity: 1,
        unit_price: 1000,
        amount: 1000,
        time_entry_id: "e1",
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

/** Antallet af kalder til en kommando. */
function antal(cmd: string): number {
  return kalder.filter((k) => k.cmd === cmd).length;
}

function toasts(): string[] {
  return useToastStore.getState().toasts.map((t) => t.message);
}

/**
 * Antallet af poster i linjetabellen.
 *
 * Ikke `getAllByRole("textbox")`: titelfeltet i hovedet er også et textbox, så
 * den tælling ville have dømt redigeringen af *fakturaens* titel og ikke
 * *linjens* — to forskellige kommandoer.
 */
function antalLinjer(): number {
  return within(screen.getByRole("table")).getAllByRole("row").length - 1;
}

/** Beskrivelsesfeltet i første linje. */
function beskrivelse(): HTMLElement {
  return within(screen.getByRole("table")).getAllByRole("textbox")[0];
}

/** Slet-knappen i første linje. */
function sletKnap(): HTMLElement {
  return within(
    within(screen.getByRole("table")).getAllByRole("row")[1],
  ).getByRole("button");
}

beforeEach(() => {
  svar = { get_setting: "hemmelig-nøgle", get_invoice: faktura() };
  kalder = [];
  fejl = {};
});

afterEach(async () => {
  cleanup();
  useToastStore.setState({ toasts: [] });
  await i18n.changeLanguage("da");
});

describe("Fakturalinjer overlever en redigering", () => {
  it("skriver den redigerede linje med én kommando, ikke to", async () => {
    // Den gamle kode slettede linjen og oprettede den igen, fordi der ikke var
    // en opdateringskommando. To skrivninger, to chance for at den ene fejler.
    svar.update_invoice_line = {
      ...faktura().lines[0],
      description: "Udarbejdelse, rettet",
    };
    renderEditor();

    fireEvent.change(beskrivelse(), {
      target: { value: "Udarbejdelse, rettet" },
    });
    fireEvent.blur(beskrivelse());

    await waitFor(() => expect(antal("update_invoice_line")).toBe(1));
    expect(antal("remove_invoice_line")).toBe(0);
    expect(antal("add_invoice_line")).toBe(0);
  });

  it("sender den rettede værdi med, og bevarer tidsbindingen i svaret", async () => {
    // `time_entry_id` står ikke i input — den læses fra rækken. Sendte
    // frontend den, kunne en redigering flytte bindingen til en anden
    // registrering; lod den den ikke, og svaret så det.
    svar.update_invoice_line = {
      ...faktura().lines[0],
      unit_price: 1200,
      amount: 1200,
    };
    renderEditor();

    const pris = within(screen.getByRole("table")).getAllByDisplayValue(
      "1000",
    )[0];
    fireEvent.change(pris, { target: { value: "1200" } });
    fireEvent.blur(pris);

    await waitFor(() => expect(antal("update_invoice_line")).toBe(1));
    const kald = kalder.find((k) => k.cmd === "update_invoice_line");
    expect(kald?.args.lineId).toBe(7);
    const sendt = kald?.args.line as Record<string, unknown>;
    expect(sendt.unit_price).toBe(1200);
    expect(sendt.amount).toBe(1200);
    expect(sendt).not.toHaveProperty("time_entry_id");
  });

  it("beholder linjen i tabellen efter en vellykket redigering", async () => {
    svar.update_invoice_line = { ...faktura().lines[0], description: "Rettet" };
    renderEditor();
    const før = antalLinjer();

    fireEvent.change(beskrivelse(), { target: { value: "Rettet" } });
    fireEvent.blur(beskrivelse());

    await waitFor(() => expect(antal("update_invoice_line")).toBe(1));
    expect(antalLinjer()).toBe(før);
    expect(antal("remove_invoice_line")).toBe(0);
  });
});

describe("En fejlet skrivning siger det", () => {
  it("melder en fejlet linjeredigering i alle fem sprog", async () => {
    // Skærmen viste den rettede pris, selv om den aldrig nåede databasen.
    // Uden en besked stod brugeren med et beløb, der ikke findes nogen steder.
    for (const lang of ALLE_LANG) {
      cleanup();
      useToastStore.setState({ toasts: [] });
      kalder = [];
      await i18n.changeLanguage(lang);
      fejl = { update_invoice_line: new Error("låst database") };
      renderEditor();

      fireEvent.blur(beskrivelse());
      await waitFor(() =>
        expect(toasts()).toContain(sætning(lang, "couldNotSaveLine")),
      );
    }
  });

  it("melder en fejlet gemning, tilføjelse og sletning", async () => {
    // De tre `catch { console.error }` var det planen kaldte «brugeren trykker
    // Gem, og intet sker». Hver især: de opstår under forskellige betingelser,
    // så én samlet test ville springe dem over, der aldrig viser sig samtidig.
    const tilfælde: [Record<string, unknown>, () => void, string][] = [
      [
        { update_invoice: new Error("boom") },
        () => {
          // Titlen gemmes på blur, som de øvrige felter.
          const titel = screen.getByPlaceholderText(
            sætning("da", "titlePlaceholder"),
          );
          fireEvent.change(titel, { target: { value: "Nyt navn" } });
          fireEvent.blur(titel);
        },
        "couldNotSave",
      ],
      [
        { add_invoice_line: new Error("boom") },
        () => {
          fireEvent.click(screen.getByText(sætning("da", "addLine")));
        },
        "couldNotAddLine",
      ],
      [
        { remove_invoice_line: new Error("boom") },
        () => {
          fireEvent.click(sletKnap());
        },
        "couldNotRemoveLine",
      ],
    ];

    for (const [fejle, handling, forventet] of tilfælde) {
      cleanup();
      useToastStore.setState({ toasts: [] });
      await i18n.changeLanguage("da");
      fejl = fejle;
      renderEditor();
      handling();
      await waitFor(() => expect(toasts()).toContain(sætning("da", forventet)));
    }
  });
});

describe("En gemt linje siger ikke, at den gik tabt", () => {
  it("må ikke melde tabt linje, når kun totalerne ikke kan vises", async () => {
    // Skrivningen og genindlæsningen lå i én `try`. En låst database efter en
    // *vellykket* skrivning sagde derfor «kunne ikke gemme linjen» — og
    // brugeren ville prøve igen, fordi hans ændring så ud til at være væk.
    svar.update_invoice_line = { ...faktura().lines[0], amount: 1200 };
    fejl = { get_invoice: new Error("låst") };
    renderEditor();

    fireEvent.blur(beskrivelse());

    await waitFor(() =>
      expect(toasts()).toContain(sætning("da", "couldNotShowTotals")),
    );
    expect(toasts()).not.toContain(sætning("da", "couldNotSaveLine"));
    // Skrivningen lykkedes stadig — linjen ligger i databasen.
    expect(antal("update_invoice_line")).toBe(1);
  });
});

describe("Ingen eksport sender en faktura med gamle felter", () => {
  it("færdiggør ikke PDF'en, når gemningen fejler", async () => {
    // `handleExportPdf` kaldte `saveInvoice()` og slugte fejlen. Den færdiggjorde
    // så fakturaen, nummererede den og åbnede printvinduet med den gamle titel,
    // den gamle betalingsdato og den gamle momssats — sendt til kunden som om
    // det var den brugeren lige havde skrevet.
    fejl = { update_invoice: new Error("låst database") };
    renderEditor();

    fireEvent.click(screen.getByText(sætning("da", "exportPdf")));

    await waitFor(() =>
      expect(toasts()).toContain(sætning("da", "couldNotSave")),
    );
    expect(antal("finalize_invoice")).toBe(0);
    expect(antal("generate_invoice_html")).toBe(0);
  });

  it("sender ikke til Billy, når gemningen fejler", async () => {
    fejl = { update_invoice: new Error("låst database") };
    svar.export_invoice_to_billy = "ok";
    renderEditor();

    fireEvent.click(screen.getByText(sætning("da", "sendToBilly")));

    await waitFor(() =>
      expect(toasts()).toContain(sætning("da", "couldNotSave")),
    );
    expect(antal("export_invoice_to_billy")).toBe(0);
  });

  it("sender stadig, når gemningen lykkes", async () => {
    // Bevogter på den anden side: porten må ikke grønne en rettelse, der
    // glemmer at gemme overhovedet.
    svar.export_invoice_to_billy = "ok";
    svar.get_invoice = faktura();
    renderEditor();

    fireEvent.click(screen.getByText(sætning("da", "sendToBilly")));

    await waitFor(() => expect(antal("export_invoice_to_billy")).toBe(1));
    expect(toasts()).toContain(sætning("da", "exportedToBilly"));
  });
});
