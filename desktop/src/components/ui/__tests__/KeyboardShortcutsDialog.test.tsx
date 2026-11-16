import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

import { KeyboardShortcutsDialog } from "../KeyboardShortcutsDialog";

afterEach(cleanup);

/** Rækken med de(n) nøgle(r) — dens beskrivelse står i <dt> i samme række. */
function rowLabel(keys: string): string {
  const row = screen.getByText(keys).closest("div");
  return row?.querySelector("dt")?.textContent ?? "";
}

describe("KeyboardShortcutsDialog", () => {
  it("viser de tre grupper af genveje", () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    expect(screen.getByText("Overalt")).toBeTruthy();
    expect(screen.getByText("Lister og tidslinje")).toBeTruthy();
    // Navnet siger hvilke visninger gruppen gælder: måneden har ingen markør,
    // så ↑↓ og Enter ville være løfter uden dækning dér.
    expect(screen.getByText("Kalender (uge og dag)")).toBeTruthy();
  });

  it("deler piletasterne, så den ikke lover ←→ i dagsværelsen", () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    // DayView sender ikke onHorizontal til useSlotCursor, så ←→ er dødt der,
    // og dagsværelsen er en af de tre valgte visninger. Én række med alle fire
    // pile ville love den døde pil i den visning, hvor den er død.
    expect(rowLabel("↑↓")).toBe("Flyt markøren mellem tidsrum");
    expect(rowLabel("←→")).toBe("Skift dag i ugevisningen");
  });

  it("lukker med Escape", () => {
    const onClose = vi.fn();
    render(<KeyboardShortcutsDialog open onClose={onClose} />);

    fireEvent.keyDown(document.body, { key: "Escape" });

    expect(onClose).toHaveBeenCalled();
  });

  it("viser Ctrl-genvejene på den taster, der holder ⌘ på mac", () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    // Ctrl+N is documented, so a reader can find the shortcut that opens a new
    // time entry without hunting through the palette.
    expect(screen.getByText("Ny registrering")).toBeTruthy();
    expect(screen.getByText("Start timeren")).toBeTruthy();
    expect(screen.getByText("Stop timeren")).toBeTruthy();
  });

  it("siger at e ikke virker i tidslinjen", () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    // The hook swallows "e" in the timeline, so promising an edit there would
    // be a claim the app cannot keep.
    expect(screen.getByText(/ikke i tidslinjen/)).toBeTruthy();
  });

  it("gør p til en egen gruppe, fordi timeren kun findes på dashboardet", () => {
    render(<KeyboardShortcutsDialog open onClose={vi.fn()} />);

    // `p` er monteret i `PomodoroTimer`, som kun sidder på dashboardet. Lægtes
    // rækken under «Overalt» ville den love genvejen på de andre sider, hvor
    // der ikke er en pomodoro at starte.
    expect(screen.getByText("Pomodoro")).toBeTruthy();
    expect(rowLabel("p")).toBe("Start eller sæt pomodoroen på pause");
  });

  it("viser intet når den er lukket", () => {
    render(<KeyboardShortcutsDialog open={false} onClose={vi.fn()} />);

    expect(screen.queryByText("Overalt")).toBeNull();
  });
});
