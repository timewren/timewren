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

import { invoke as invokeRaw } from "@tauri-apps/api/core";

import { DayView } from "../DayView";

// The cursor starts at the current time, so the clock is pinned — otherwise
// the assertions drift with the wall clock.
const CLOCK = new Date(2026, 8, 29, 9, 0);

const onCreateEntry = vi.fn();
const onEditEntry = vi.fn();
const onNavigateDay = vi.fn();

function renderDay() {
  return render(
    <DayView
      date={new Date(2026, 8, 29, 9, 0)}
      onEditEntry={onEditEntry}
      onCreateEntry={onCreateEntry}
      onNavigateDay={onNavigateDay}
    />,
  );
}

/**
 * Dagens total i overskriften, eller null når den ikke vises.
 *
 * Slår på hele elementets tekst, fordi «Total» og «2t 0m» er to tekstnoder i
 * samme `<span>` — `getByText("Total")` ville aldrig finde den.
 */
function dagTotal(): string | null {
  const node = Array.from(document.querySelectorAll("span")).find(
    (s) => s.textContent?.startsWith("Total") === true,
  );
  return node?.textContent ?? null;
}

/** The cursor's time, as shown on its button (e.g. "09:00"). */
function cursorTime(): string {
  return (
    screen.getByRole("button", { name: /Opret registrering kl\./ })
      .textContent ?? ""
  );
}

describe("DayView keyboard create", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    onCreateEntry.mockClear();
    onEditEntry.mockClear();
    onNavigateDay.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("creates an entry at the cursor with Enter, without a mouse", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: /Opret registrering kl\./,
    });
    // Cursor starts at the current time — 09:00 in this test's clock.
    expect(cursor.textContent).toContain("09:00");

    fireEvent.keyDown(cursor, { key: "Enter" });

    expect(onCreateEntry).toHaveBeenCalledTimes(1);
    expect(onCreateEntry).toHaveBeenCalledWith("2026-09-29", "09:00", "10:00");
  });

  it("moves the block with the arrow keys and stretches it with Shift", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: /Opret registrering kl\./,
    });
    fireEvent.keyDown(cursor, { key: "ArrowDown" });
    fireEvent.keyDown(cursor, { key: "ArrowDown" });
    fireEvent.keyDown(cursor, { key: "ArrowUp" });
    fireEvent.keyDown(cursor, { key: "ArrowDown", shiftKey: true });

    expect(cursorTime()).toContain("09:15");

    fireEvent.keyDown(cursor, { key: "Enter" });
    expect(onCreateEntry).toHaveBeenCalledWith("2026-09-29", "09:15", "10:30");
  });

  it("keeps the block inside the day when the user pushes past midnight's edge", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: /Opret registrering kl\./,
    });
    for (let i = 0; i < 80; i++) {
      fireEvent.keyDown(cursor, { key: "ArrowUp" });
    }
    expect(cursorTime()).toContain("06:00");

    for (let i = 0; i < 100; i++) {
      fireEvent.keyDown(cursor, { key: "ArrowDown" });
    }
    expect(cursorTime()).toContain("22:00");
  });

  it("tells assistive tech what will be created", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: "Opret registrering kl. 09:00–10:00",
    });
    expect(cursor.getAttribute("aria-label")).toBe(
      "Opret registrering kl. 09:00–10:00",
    );
  });

  // Uge-visningen kan flytte markøren mellem kolonner med ←/→; dags-visningen
  // kunne ikke flytte dagen overhovedet, så dens ‹ ›-knapper var det eneste
  // vejsystem — altså nåede de kun med musen.
  it("skifter dag med pil venstre og højre", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: /Opret registrering kl\./,
    });
    fireEvent.keyDown(cursor, { key: "ArrowRight" });
    expect(onNavigateDay).toHaveBeenLastCalledWith(1);

    fireEvent.keyDown(cursor, { key: "ArrowLeft" });
    fireEvent.keyDown(cursor, { key: "ArrowLeft" });
    expect(onNavigateDay).toHaveBeenLastCalledWith(-1);
    expect(onNavigateDay).toHaveBeenCalledTimes(3);
  });

  // Piletasterne flytter tidsrummet med ↑/↓. En ←/→ der også flyttede
  // tidsrummet ville ligne blokken i stedet for at skifte dag.
  it("lader ←/→ stå for dagen og ikke for tidsrummet", async () => {
    renderDay();

    const cursor = await screen.findByRole("button", {
      name: /Opret registrering kl\./,
    });
    fireEvent.keyDown(cursor, { key: "ArrowRight" });
    fireEvent.keyDown(cursor, { key: "ArrowLeft" });

    expect(cursorTime()).toContain("09:00");
  });

  it("fortæller højtlæseren hvilken dag der vises, da pilen skifter den", async () => {
    renderDay();

    await screen.findByRole("button", { name: /Opret registrering kl\./ });

    // Slå på den regions egen krog, ikke på `[aria-live]`: gitteret har også
    // en live-region (markørens klokkeslæt), og den første i dokumentrækkefølgen
    // er ikke altid den her.
    const status = document.querySelector("[data-dag-status]");
    expect(status?.textContent).toContain("29. sep 2026");
    expect(status?.textContent).toContain("2026");
  });
});

describe("DayView skifter dag uden at smide dagens data med", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    onCreateEntry.mockClear();
    onEditEntry.mockClear();
    onNavigateDay.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  // Registreringerne filtreres i renderingen på dato, så de forsvinder selv.
  // Det gør **dagens total** i hovedet ikke: den summerer hele listen, og den
  // lå under dagens navn. Uden nulstillingen skrev overskriften på en helt tom
  // dag «Total: 2t 0m» fra i går, og knappen «Log alle møder» talte gårsdagens
  // møder. Begge er løjner appen ikke må fortælle, og ingen af dem er dækket af
  // en anden test. Kaldet for den nye dag hænger, for det er præcis det vindue
  // hvorfra kun nulstillingen redder.
  it("rydder gårsdagens total og møder, mens den nye dag ikke er svaret", async () => {
    const invoke = vi.mocked(invokeRaw);
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_time_entries") {
        return Promise.resolve([
          {
            id: "e1",
            client_id: "c1",
            description: "Gårsdags arbejde",
            start_time: "2026-09-29T09:00:00",
            end_time: "2026-09-29T11:00:00",
            duration: 7200,
          },
        ]) as never;
      }
      if (cmd === "list_uncovered_calendar_events") {
        return Promise.resolve([
          {
            event: {
              id: "ev1",
              title: "Gårsdags møde",
              start_time: "2026-09-29T13:00:00",
              end_time: "2026-09-29T14:00:00",
            },
            guess_project_id: null,
          },
        ]) as never;
      }
      return Promise.resolve([]) as never;
    });

    const { rerender } = render(
      <DayView
        date={new Date(2026, 8, 29, 9, 0)}
        onEditEntry={onEditEntry}
        onCreateEntry={onCreateEntry}
        onNavigateDay={onNavigateDay}
      />,
    );

    // Overskriften skriver «Total» og «2t 0m» som to tekstnoder i samme
    // element, så hele strengen er det der skal dømmes.
    await waitFor(() => {
      expect(dagTotal()).toBe("Total: 2t 0m");
    });
    expect(screen.getByText(/Log alle møder/)).toBeTruthy();

    // Dagens kald bliver hængende — en bruger på et langsomt net.
    invoke.mockImplementation(() => new Promise(() => {}) as never);
    rerender(
      <DayView
        date={new Date(2026, 8, 30, 9, 0)}
        onEditEntry={onEditEntry}
        onCreateEntry={onCreateEntry}
        onNavigateDay={onNavigateDay}
      />,
    );

    await waitFor(() => {
      expect(dagTotal()).toBeNull();
    });
    expect(screen.queryByText(/Log alle møder/)).toBeNull();
  });
});
