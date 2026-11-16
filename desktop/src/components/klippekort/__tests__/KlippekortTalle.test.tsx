import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";
import type { InvoiceDraft, Klippekort, LowKlippekort } from "@/lib/types";

/**
 * K25f, del 2. Rapportens tal blev rettet i `ReportView`; det her er de fem
 * filer, der stod med **samme** fejl: beløb skrevet med
 * `Math.round(x).toLocaleString("da-DK")} kr` og timer skrevet med
 * `toFixed(1).replace(".", ",")`.
 *
 * Det er dansk talformat oven på tysk, svensk, norsk og engelsk tekst — og
 * `toFixed` sætter altid `.`, så selv dansk læste «24.0 t» med engelsk
 * decimaltegn. Det er derfor porten alene ikke dømmer: `kr` og `t` er
 * enkelttegn, de ligner ikke UI-tekst. Her dømmer DOM'en i hvert sprog.
 *
 * Hele beløbsstrengen forventes, målt i node med samme `Intl`-kald som
 * `formatCurrency` — ikke blot talet. Symbolets *placering* lå i markup'en som
 * en hårdkodet " kr", så engelsk læste "DKK 1,234.50" med dansk separator
 * oven på. Dansk og tysk deler ellers decimalkomma, så de to rækker kan kun
 * skelnes på symbolet.
 */

vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string) => {
    if (cmd === "list_klippekort") return klippekort;
    if (cmd === "get_low_klippekort") return lave;
    if (cmd === "list_invoices") return fakturaer;
    if (cmd === "preview_klippekort_invoice")
      return {
        entry_count: 3,
        total_hours: 12.5,
        total_amount: 12345.67,
        lines: [
          {
            description: "Udvikling",
            hours: 12.5,
            rate: 987,
            amount: 12345.67,
            entry_count: 3,
          },
        ],
      };
    return null;
  },
}));

/** `Intl` sætter U+00A0 mellem tal og symbol; normaliseres væk begge steder. */
const ryd = (s: string) => s.replaceAll("\u00a0", " ");
const tekst = () => ryd(document.body.textContent ?? "");

/** Samme `Intl`-kald som `formatCurrency`, målt i stedet for gjættet. */
const kr = (lang: string, beløb: number, dec = 0) =>
  ryd(
    new Intl.NumberFormat(lang, {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: dec,
      maximumFractionDigits: dec,
    }).format(beløb),
  );

const da: Klippekort = {
  id: "k1",
  remote_id: null,
  client_id: "c1",
  project_id: null,
  name: "Design",
  total_hours: 20,
  used_hours: 6,
  hourly_rate: 1234.6,
  status: "active",
  expires_at: "2026-12-31",
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  client_name: "Acme",
  project_name: null,
};

let klippekort: Klippekort[] = [];
let lave: LowKlippekort[] = [
  {
    ...da,
    remaining_hours: 2,
  } as unknown as LowKlippekort,
];

beforeEach(async () => {
  klippekort = [da];
  lave = [{ ...da, remaining_hours: 2 } as unknown as LowKlippekort];
  await i18n.changeLanguage("da");
});

const fakturaer: InvoiceDraft[] = [
  {
    id: "f1",
    client_id: "c1",
    client_name: "Acme",
    title: "September",
    status: "draft",
    subtotal: 10300.56,
    vat_rate: 25,
    total: 12345.67,
    due_date: null,
    notes: null,
    invoice_number: null,
    created_at: "2026-09-01T00:00:00",
    updated_at: "2026-09-01T00:00:00",
    lines: [],
  },
];

const LANGS = ["da", "de", "sv", "nb", "en"] as const;

afterEach(() => {
  cleanup();
});

describe("Klippekort-kortets tal følger det valgte sprog", () => {
  it("skriver timesatsen med symbolet i hvert sit sprog", async () => {
    const { KlippekortCard } = await import(
      "@/components/klippekort/KlippekortCard"
    );
    // **To decimaler, ikke nul.** `formatCurrency(rate, 0)` skrev «1.235 kr.»
    // for 1234,6, altså en pris kortet aldrig viste; fakturaen bruger det uaf
    // rundede tal. Porten genskaber derfor den *af rundede* streng, hvilket
    // gjorde den grøn for netop fejlen.
    for (const lang of LANGS) {
      await i18n.changeLanguage(lang);
      render(<KlippekortCard klippekort={da} onClick={() => {}} />);
      await waitFor(() => expect(tekst()).toContain(kr(lang, 1234.6, 2)));
      // Ingen af de fire øvrige sprog må stå i DOM'en. Det er dømmen, der gør
      // fejlen synlig: kun den hårdkodede " kr/t" ville være ens i alle fem.
      for (const anden of LANGS) {
        if (anden !== lang) expect(tekst()).not.toContain(kr(anden, 1234.6, 2));
      }
      cleanup();
    }
  });

  it("skriver den timesats, kunden faktureres — også 87,50", async () => {
    // En sats med en halv krone er et helt normalt freelancertarif. Den skal
    // stå som den er: «88 kr./t» på kortet og 87,50 på fakturaen er to
    // forskellige priser for det samme arbejde.
    //
    // Sprogene deduplikeres, fordi tysk og norsk begge skriver «87,50 DKK» —
    // ellers ville porten kræve en streng, sprogvalget med vilje ikke kan give.
    const { KlippekortCard } = await import(
      "@/components/klippekort/KlippekortCard"
    );
    const former = [...new Set(LANGS.map((l) => kr(l, 87.5, 2)))];
    for (const lang of LANGS) {
      await i18n.changeLanguage(lang);
      render(
        <KlippekortCard
          klippekort={{ ...da, hourly_rate: 87.5 }}
          onClick={() => {}}
        />,
      );
      await waitFor(() => expect(tekst()).toContain(kr(lang, 87.5, 2)));
      for (const fremmed of former) {
        if (fremmed !== kr(lang, 87.5, 2)) {
          expect(tekst()).not.toContain(fremmed);
        }
      }
      cleanup();
    }
    // Den afrundede streng må ikke stå nogen steder — den lå i koden før.
    await i18n.changeLanguage("da");
    render(
      <KlippekortCard
        klippekort={{ ...da, hourly_rate: 87.5 }}
        onClick={() => {}}
      />,
    );
    expect(tekst()).not.toContain("88 kr");
    cleanup();
  });

  it("skriver de forbrugte timer med det valgte sprog's decimaltegn", async () => {
    const { KlippekortCard } = await import(
      "@/components/klippekort/KlippekortCard"
    );
    const med_komma: Klippekort = { ...da, used_hours: 6.5, total_hours: 20.5 };

    await i18n.changeLanguage("en");
    render(<KlippekortCard klippekort={med_komma} onClick={() => {}} />);
    expect(tekst()).toContain("6.5");
    expect(tekst()).not.toContain("6,5");
    cleanup();

    await i18n.changeLanguage("da");
    render(<KlippekortCard klippekort={med_komma} onClick={() => {}} />);
    expect(tekst()).toContain("6,5");
    expect(tekst()).not.toContain("6.5");
  });

  it("skriver udløbsdatoen i det valgte sprog, ikke altid dansk", async () => {
    const { KlippekortCard } = await import(
      "@/components/klippekort/KlippekortCard"
    );
    await i18n.changeLanguage("en");
    render(<KlippekortCard klippekort={da} onClick={() => {}} />);
    // `toLocaleDateString("da-DK")` skrev "31.12.2026" på engelsk; `formatDate`
    // skriver månedens navn, som `calendar.shortMonthNames` holder.
    expect(tekst()).toMatch(/Dec 31, 2026/);
    expect(tekst()).not.toContain("31.12.2026");
  });
});

describe("Klippekort-listens summer følger det valgte sprog", () => {
  it("skriver restværdien som et beløb i hvert sit sprog", async () => {
    const { KlippekortList } = await import(
      "@/components/klippekort/KlippekortList"
    );
    // Restværdien er 14 timer á 1234,60 = 17284,4, rundet til 17284.
    for (const lang of LANGS) {
      await i18n.changeLanguage(lang);
      render(<KlippekortList />);
      await waitFor(() => expect(tekst()).toContain(kr(lang, 17284)));
      for (const anden of LANGS) {
        if (anden !== lang) expect(tekst()).not.toContain(kr(anden, 17284));
      }
      cleanup();
    }
  });

  it("skriver de resterende timer med det valgte sprog's decimaltegn", async () => {
    const { KlippekortList } = await import(
      "@/components/klippekort/KlippekortList"
    );
    await i18n.changeLanguage("en");
    render(<KlippekortList />);
    await waitFor(() => expect(tekst()).toContain("14.0"));
    expect(tekst()).not.toContain("14,0");
  });
});

describe("Fakturalisten følger det valgte sprog", () => {
  it("skriver både de runde summeringer og det præcise beløb", async () => {
    const { InvoiceList } = await import("@/components/invoices/InvoiceList");
    for (const lang of LANGS) {
      await i18n.changeLanguage(lang);
      render(<InvoiceList />);
      // Præcist beløb med to decimaler — den tredje af de tre steder.
      await waitFor(() => expect(tekst()).toContain(kr(lang, 12345.67, 2)));
      for (const anden of LANGS) {
        if (anden !== lang)
          expect(tekst()).not.toContain(kr(anden, 12345.67, 2));
      }
      cleanup();
    }
  });
});

describe("Automatisk faktura følger det valgte sprog", () => {
  it("skriver subtotal og linjebeløb med symbolet i hvert sit sprog", async () => {
    const { AutoInvoiceDialog } = await import(
      "@/components/klippekort/AutoInvoiceDialog"
    );
    for (const lang of LANGS) {
      await i18n.changeLanguage(lang);
      render(
        <AutoInvoiceDialog
          open
          onClose={() => {}}
          klippekort={da}
          onInvoiceCreated={() => {}}
        />,
      );
      await waitFor(() => expect(tekst()).toContain(kr(lang, 12345.67, 2)));
      // Decimaltegnet i timekolonnen følger samme sprog.
      const komma = lang === "en" ? "12.5" : "12,5";
      await waitFor(() => expect(tekst()).toContain(komma));
      for (const anden of LANGS) {
        if (anden !== lang)
          expect(tekst()).not.toContain(kr(anden, 12345.67, 2));
      }
      cleanup();
    }
  });
});

describe("Knap alarm om lav saldo følger det valgte sprog", () => {
  it("skriver decimaltegnet i det valgte sprog, ikke altid dansk komma", async () => {
    // Den lokale `formatHours` skrev decimaltegnet selv med
    // `.replace(".", ",")`, så 2,5 timer læstes "2,5" også på engelsk. Derfor
    // skal værdien have en decimal — 2 hele timer er ens i alle sprog, så
    // testen ville være grøn mod den gamle kode.
    const { LowKlippekortAlert } = await import(
      "@/components/dashboard/LowKlippekortAlert"
    );
    const halv: LowKlippekort[] = [{ ...lave[0], remaining_hours: 2.5 }];
    lave = halv;

    await i18n.changeLanguage("en");
    render(<LowKlippekortAlert />);
    await waitFor(() => expect(tekst()).toContain("2.5"));
    expect(tekst()).not.toContain("2,5");
  });

  it("skriver hele timer uden et nul efter kommaet", async () => {
    // Bevogter på et valg, den gamle kode ikke skulle træffe: tallet læses som
    // en del af en sætning ("2 timer tilbage"), så `formatHours(x, 1, 0)` med
    // bunden ved 0. Uden `minimumDecimals` skrev den delte `formatHours`
    // "2,0 timer" — samme fejl som `toFixed` gav, bare den anden vej.
    const { LowKlippekortAlert } = await import(
      "@/components/dashboard/LowKlippekortAlert"
    );
    await i18n.changeLanguage("en");
    render(<LowKlippekortAlert />);
    await waitFor(() => expect(tekst()).toContain("2 "));
    expect(tekst()).not.toContain("2.0");
    expect(tekst()).not.toContain("2,0");
  });
});
