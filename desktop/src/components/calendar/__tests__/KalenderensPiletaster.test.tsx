import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(() => Promise.resolve([])),
}));

import { CalendarView } from "../CalendarView";

// Uret er låst, fordi markøren starter ved «nu» — ellers driver påstandene med
// værkets klokke.
const CLOCK = new Date(2026, 8, 29, 9, 0);

/** Dags-visningens markør — den knap tastaturbrugeren står på. */
function cursor(): HTMLElement {
  return screen.getByRole("button", { name: /Opret registrering kl\./ });
}

/**
 * Dagens dato i værktøjslinjen, som står over gitteret.
 *
 * I dags-visningen skriver den `formatShortDate` plus året («29. sep 2026»), så
 * det er den vi dømmer — ikke overskriften *inde i* DayView, som viser
 * ugekortet og dagen hver for sig. `<h2>` skelner den fra DayViews egen
 * `aria-live`-region, der med vilje gengiver den samme dato.
 */
function overskrift(): string {
  return screen.getByRole("heading", { level: 2 }).textContent ?? "";
}

describe("kalenderens piletaster skifter dag uden at miste fokus", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function visDagsvisning() {
    render(<CalendarView />);
    // Start i ugevisningen og skift til dag, så testen dømmer den vej brugeren
    // faktisk tager — `CalendarView` åbner i uger.
    fireEvent.click(screen.getByRole("button", { name: "Dag" }));
    await waitFor(() => expect(cursor()).toBeTruthy());
  }

  // Dette er hele pointen med opgaven. Viewet var monteret med
  // `key={day-<dato>-…}`, så en datoændring.remote monterede det — og en
  // fjernet knap taber fokus til `<body>`. Brugeren trykkede så ←/→ igen og
  // igen, og hverken markøren eller tastaturet virkede.
  it("beholder fokus på markøren, når pilen skifter dag", async () => {
    await visDagsvisning();

    const knap = cursor();
    knap.focus();
    expect(document.activeElement).toBe(knap);

    fireEvent.keyDown(knap, { key: "ArrowRight" });

    await waitFor(() => {
      expect(document.activeElement).toBe(cursor());
    });
  });

  // Et remont ville genskabe markøren ved «nu», altså 09.00 i denne klokke —
  // så porten skal flytte den *før* den skifter dag, ellers er 09.00 for både
  // «start» og «efter et remont» og intet kan skelne dem.
  it("beholder markørens klokkeslæt, når brugeren går frem og tilbage", async () => {
    await visDagsvisning();

    // Flyt blokken ned et kvarter, så den ikke ligner en nyoprettet markør
    // (et remont ville sætte den tilbage til 09.00).
    fireEvent.keyDown(cursor(), { key: "ArrowDown" });
    await waitFor(() => expect(cursor().textContent).toContain("09:15"));

    fireEvent.keyDown(cursor(), { key: "ArrowRight" });
    await waitFor(() => expect(overskrift()).toBe("30. sep 2026"));
    expect(cursor().textContent).toContain("09:15");

    fireEvent.keyDown(cursor(), { key: "ArrowLeft" });
    await waitFor(() => expect(overskrift()).toBe("29. sep 2026"));
    expect(cursor().textContent).toContain("09:15");
  });

  it("flytter overskriften med en dag", async () => {
    await visDagsvisning();

    const før = overskrift();
    fireEvent.keyDown(cursor(), { key: "ArrowRight" });

    await waitFor(() => {
      expect(overskrift()).not.toBe(før);
    });
  });

  // Piletasterne må ikke ændre ugen, kun dagen — ellers rykker én tast seks
  // dage ad gangen, fordi `navigate` læser `mode`. Rækken er derfor hele
  // dømmen: 29. + 1 = 30. og 29. + 2 = 1. okt, fordi en månedsskift er det
  // sted, hvor `addDays` typisk tager fejl af længden.
  it("går præcis én dag ad gangen, også over et månedsskift", async () => {
    await visDagsvisning();

    expect(overskrift()).toBe("29. sep 2026");

    fireEvent.keyDown(cursor(), { key: "ArrowRight" });
    await waitFor(() => expect(overskrift()).toBe("30. sep 2026"));

    fireEvent.keyDown(cursor(), { key: "ArrowRight" });
    await waitFor(() => expect(overskrift()).toBe("1. okt 2026"));

    fireEvent.keyDown(cursor(), { key: "ArrowLeft" });
    await waitFor(() => expect(overskrift()).toBe("30. sep 2026"));
  });
});
