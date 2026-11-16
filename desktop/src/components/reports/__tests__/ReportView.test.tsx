import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";

const invoke = vi.fn();

type Lang = "da" | "en" | "de" | "sv" | "nb";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

// recharts measures a real viewport to size itself, which jsdom has none of.
// The stubs keep the `data` each chart is handed, so the test can assert what
// the chart would actually draw instead of only reading the prose.
vi.mock("recharts", () => {
  const stub = (testId?: string) =>
    function Stub({ children, ...rest }: Record<string, unknown>) {
      const data = rest.data as Array<Record<string, number>> | undefined;
      return (
        <div
          data-testid={testId}
          data-series={data ? JSON.stringify(data) : undefined}
        >
          {children as React.ReactNode}
        </div>
      );
    };
  return {
    Bar: stub("bar"),
    BarChart: stub("bar-chart"),
    CartesianGrid: stub(),
    Cell: stub(),
    ComposedChart: stub("daily-chart"),
    Legend: stub(),
    Line: stub("trend-line"),
    Pie: stub(),
    PieChart: stub("pie-chart"),
    ResponsiveContainer: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Tooltip: stub(),
    XAxis: stub(),
    YAxis: stub(),
  };
});

import { ReportView } from "../ReportView";

function day(date: string, hours: number, billable = hours): unknown {
  return {
    date,
    hours,
    billable_hours: billable,
  };
}

// Billable hours trend *down* here while the day total trends up, so a trend
// fitted on the wrong column shows up as the wrong caption number.
const RISING = [
  day("2026-09-07", 4, 3),
  day("2026-09-08", 5, 5),
  day("2026-09-09", 6, 4),
  day("2026-09-10", 9, 9),
];

const FALLING = [
  day("2026-09-07", 9, 8),
  day("2026-09-08", 6, 6),
  day("2026-09-09", 5, 4),
  day("2026-09-10", 4, 4),
];

const FLAT = [
  day("2026-09-07", 6, 6),
  day("2026-09-08", 6, 6),
  day("2026-09-09", 6, 6),
  day("2026-09-10", 6, 6),
];

function report(byDay: unknown[]): unknown {
  return {
    total_hours: 24,
    billable_hours: 21,
    non_billable_hours: 3,
    by_project: [],
    by_client: [],
    by_day: byDay,
    top_apps: [],
  };
}

const COVERAGE = {
  by_day: [],
  unregistered_blocks: [],
  total_active_hours: 0,
  total_tracked_hours: 0,
  total_unregistered_hours: 0,
  total_unregistered_amount: 0,
};

/**
 * Én momspulje på 25 % med et beløb over tusind, så separatoren er synlig:
 * `12.345,67` på dansk mod `12,345.67` på engelsk. Uden beløbet ville de to
 * talformat se ens ud, og testen ville være grøn uden at dømme noget.
 */
const VAT = {
  by_rate: [
    {
      vat_rate: 25,
      grundlag: 12345.67,
      moms: 3086.4175,
      faktura_antal: 3,
    },
  ],
  total_grundlag: 12345.67,
  total_moms: 3086.4175,
  total_faktura_antal: 3,
};

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "get_report_data") return Promise.resolve(report(RISING));
    if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
    if (cmd === "get_vat_summary") return Promise.resolve(VAT);
    return Promise.resolve(null);
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

/** The series the daily chart was handed, read back from the recharts stub. */
function dailySeries(): Array<Record<string, number>> {
  const attr = screen.getByTestId("daily-chart").getAttribute("data-series");
  return JSON.parse(attr ?? "[]");
}

async function renderReport() {
  render(<ReportView />);
  await waitFor(() => expect(screen.getByTestId("daily-chart")).toBeTruthy());
}

describe("ReportView trend line", () => {
  it("gives the chart a trend for every day it draws a bar", async () => {
    await renderReport();
    const series = dailySeries();
    expect(series).toHaveLength(RISING.length);
    for (const row of series) {
      expect(typeof row.trend).toBe("number");
    }
  });

  it("rises with the hours and ends above where it started", async () => {
    await renderReport();
    const trends = dailySeries().map((row) => row.trend);
    expect(trends[trends.length - 1]).toBeGreaterThan(trends[0]);
  });

  it("draws the line through the day totals, not through billable hours", async () => {
    await renderReport();
    // Least squares over [4, 5, 6, 9]: slope 1,6 t/day from 3,6. Fitted on the
    // billable column [3, 5, 4, 9] the line would be 2,7 → 7,8 instead.
    expect(dailySeries().map((row) => row.trend)).toEqual([3.6, 5.2, 6.8, 8.4]);
  });

  it("draws the trend as a line, not as another stacked bar", async () => {
    await renderReport();
    // A `trend` in a `Bar` would inflate the stacked total past the real day.
    expect(screen.getByTestId("trend-line")).toBeTruthy();
  });

  it("falls when the later days are shorter", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_report_data") return Promise.resolve(report(FALLING));
      if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
      return Promise.resolve(null);
    });
    await renderReport();
    const trends = dailySeries().map((row) => row.trend);
    expect(trends[trends.length - 1]).toBeLessThan(trends[0]);
  });

  it("says the period is rising, with the change per day", async () => {
    await renderReport();
    // Least squares over [4, 5, 6, 9] rises 1,6 t/day, i.e. 4,8 t across the
    // four days. The billable column would say 5,1 t — so this also pins which
    // column the line follows.
    await waitFor(() =>
      expect(
        screen.getByText("4,8 t mere pr. arbejdsdag gennem perioden"),
      ).toBeTruthy(),
    );
  });

  it("says the period is falling, with the change per day", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_report_data") return Promise.resolve(report(FALLING));
      if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
      return Promise.resolve(null);
    });
    await renderReport();
    await waitFor(() =>
      expect(
        screen.getByText("4,8 t mindre pr. arbejdsdag gennem perioden"),
      ).toBeTruthy(),
    );
  });

  it("reports a flat period as unchanged, not as a rise", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_report_data") return Promise.resolve(report(FLAT));
      if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
      return Promise.resolve(null);
    });
    await renderReport();
    await waitFor(() =>
      expect(
        screen.getByText("Omkring 6 t pr. arbejdsdag, uden ændring i perioden"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(/mere pr\. arbejdsdag/)).toBeNull();
  });

  it("keeps the bar values the chart already drew", async () => {
    await renderReport();
    const series = dailySeries();
    expect(series.map((row) => row.billable)).toEqual([3, 5, 4, 9]);
    expect(series.map((row) => row.nonBillable)).toEqual([1, 0, 2, 0]);
    expect(series.map((row) => row.total)).toEqual([4, 5, 6, 9]);
  });

  it("shows no trend at all when the period has no registered time", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_report_data") return Promise.resolve(report([]));
      if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
      return Promise.resolve(null);
    });
    render(<ReportView />);
    await waitFor(() => expect(screen.getByText("Rapporter")).toBeTruthy());
    expect(screen.queryByTestId("daily-chart")).toBeNull();
    expect(screen.queryByText(/arbejdsdag/)).toBeNull();
  });
});

/**
 * Rapporten er det dokument en freelancer sender *videre* til sin kunde, så
 * tallene i den skal følge det sprog brugeren har valgt — ikke altid dansk.
 *
 * Før dette skrev de tre formatters i `ReportView` sig selv med
 * `toLocaleString("da-DK")` og `toFixed()`. `toFixed()` sætter altid `.`, så
 * selv dansk læste «24.0 t» med engelsk decimaltegn, og `toLocaleString("da-DK")`
 * gav en tysk læser «12.345,67 kr» oven på tysk tekst. `Intl` løser begge dele,
 * og strengene forventes derfor direkte — de er forskellige nok i hvert sprog,
 * så testen kan skelne på dem.
 */
describe("Rapportens tal følger det valgte sprog", () => {
  /**
   * `Intl` sætter U+00A0 mellem tal og symbol, så den normaliseres væk
   * begge steder — ellers ville en ny ICU-version gøre testene røde uden at
   * produktet ændrer sig. Hele dokumentets tekst bruges, fordi beløbene står
   * i `<span>` med et `~` foran som et skiltende tekstnoden.
   */
  const ryd = (s: string) => s.replaceAll("\u00a0", " ");
  const tekst = () => ryd(document.body.textContent ?? "");

  /**
   * Hele beløbsstrengen forventes, målt i node med samme `Intl`-kald som
   * `formatCurrency` — ikke blot talet. Det er hele pointen: `toLocaleString`
   * gav decimaltegn og tusindtalsseparator, men symbolets *placering* lå i
   * markup'en som en hårdkodet " kr", så tysk og engelsk læste dansk kroner.
   * Dansk og tysk deler ellers decimalkomma, så de to rækker er ens i
   * separatorerne og kan kun skelnes på symbolet — derfor er hele strengen
   * venstre side af dømmen.
   *
   * Rækkerne er målt, ikke gjættet: `node -e '… new Intl.NumberFormat(l,
   * {style:"currency",currency:"DKK",minimumFractionDigits:2,
   * maximumFractionDigits:2}).format(12345.67)'`.
   */
  const FORVENTET: Array<[Lang, string]> = [
    ["da", "12.345,67 kr."],
    ["de", "12.345,67 DKK"],
    ["sv", "12 345,67 Dkr"],
    ["nb", "12 345,67 DKK"],
    ["en", "DKK 12,345.67"],
  ];

  for (const [lang, forventet] of FORVENTET) {
    it(`skriver momsbeløbet som "${forventet}" på ${lang}`, async () => {
      await i18n.changeLanguage(lang);
      await renderReport();
      await waitFor(() => expect(tekst()).toContain(forventet));
      // De fire øvrige sprog skriver det samme beløb anderledes, så ingen af
      // dem må stå i DOM'en. Det er dømmen, der gør en fejl synlig: kun den
      // hårdkodede " kr" ville være samlet i alle fem.
      for (const [anden, fremmed] of FORVENTET) {
        if (anden !== lang) expect(tekst()).not.toContain(fremmed);
      }
    });
  }

  it("skriver momssatsen med de decimaler, beløbet er beregnet med", async () => {
    // `formatNumber(b.vat_rate, 0)` skrev «8 %» for 7,5. Rust beregner
    // `moms = grundlag * vat_rate / 100.0` med det uaf rundede tal, så
    // rapporten sagde altså én sats og viste beløb efter en anden.
    const medSats = (vat_rate: number, grundlag: number, moms: number) => {
      invoke.mockImplementation((cmd: string) => {
        if (cmd === "get_report_data") return Promise.resolve(report(RISING));
        if (cmd === "get_coverage") return Promise.resolve(COVERAGE);
        if (cmd === "get_vat_summary")
          return Promise.resolve({
            ...VAT,
            by_rate: [{ vat_rate, grundlag, moms, faktura_antal: 1 }],
          });
        return Promise.resolve(null);
      });
    };

    medSats(7.5, 2000, 150);
    await renderReport();
    await waitFor(() => expect(tekst()).toContain("7,5"));
    // Den afrundede sats må ikke stå nogen steder.
    expect(tekst()).not.toContain("8 %");
    expect(tekst()).not.toContain("8%");

    // En hel sats skriver stadig «25», ikke «25,00».
    cleanup();
    medSats(25, 12345.67, 3086.4175);
    await renderReport();
    await waitFor(() => expect(tekst()).toContain("12.345,67"));
    expect(tekst()).not.toContain("25,00");
  });

  it("skriver timetallene i det valgte sprog, ikke altid med et punktum", async () => {
    // `toFixed(1)` sætter `.` i alle sprog, så selv dansk læste «24.0 t».
    await i18n.changeLanguage("en");
    await renderReport();
    expect(screen.getByText("24.0t")).toBeTruthy();
    cleanup();
    await i18n.changeLanguage("da");
    await renderReport();
    expect(screen.getByText("24,0t")).toBeTruthy();
    expect(screen.queryByText("24.0t")).toBeNull();
  });

  it("skriver et helt beløb uden dansk tusindtalsseparator", async () => {
    // `formatKr` skrev `Math.round(x)` og en hårdkodet «kr», så en engelsk
    // læser så «1,235 kr» — dansk separator, dansk symbol, engelsk tekst.
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "get_report_data") return Promise.resolve(report(RISING));
      if (cmd === "get_coverage")
        return Promise.resolve({
          ...COVERAGE,
          unregistered_blocks: [
            {
              date: "2026-09-07",
              app_name: "Figma",
              project_id: null,
              project_name: null,
              client_name: "Acme",
              seconds: 3600,
              rate: 900,
              amount: 1234.6,
            },
          ],
        });
      return Promise.resolve(null);
    });
    await i18n.changeLanguage("en");
    await renderReport();
    const forventet = ryd(
      new Intl.NumberFormat("en", {
        style: "currency",
        currency: "DKK",
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(1234.6),
    );
    await waitFor(() => expect(tekst()).toContain("Figma"));
    // Beløbet står i sit eget `<span>` med et `~` foran som et skiltende
    // tekstnoden, så hele dokumentets tekst må læses — ikke én node.
    await waitFor(() => expect(tekst()).toContain(forventet));
    // Ingen af de danske former må findes nogen steder: hverken «1.235 kr» —
    // den gamle hårdkodede separator og symbol — eller «1,235 kr».
    expect(tekst()).not.toContain("1.235 kr");
    expect(tekst()).not.toContain("1,235 kr");
  });
});
