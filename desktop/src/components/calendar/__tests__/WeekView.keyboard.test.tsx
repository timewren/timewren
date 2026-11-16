import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: () => Promise.resolve([]),
}));

import { WeekView } from "../WeekView";

const onCreateEntry = vi.fn();
const onEditEntry = vi.fn();

// A Tuesday, so the week runs Monday 2026-09-28 to Sunday 2026-10-04
const CLOCK = new Date(2026, 8, 29, 9, 0);

const CURSOR = /Opret registrering kl\./;

function renderWeek() {
  return render(
    <WeekView
      date={CLOCK}
      onEditEntry={onEditEntry}
      onCreateEntry={onCreateEntry}
    />,
  );
}

/** Day columns are the only children of the grid after the time gutter. */
function dayColumn(container: HTMLElement, index: number): HTMLElement {
  const grid = container.querySelector(".relative.flex") as HTMLElement;
  const col = grid.children[index + 1] as HTMLElement | undefined;
  if (!col) throw new Error(`day column ${index} not rendered`);
  return col;
}

describe("WeekView keyboard create", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    onCreateEntry.mockClear();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("logs to the day whose column the cursor is drawn in", async () => {
    const { container } = renderWeek();

    // Wednesday, the third column
    fireEvent.mouseEnter(dayColumn(container, 2));
    const cursor = await screen.findByRole("button", { name: CURSOR });
    fireEvent.click(cursor);

    expect(onCreateEntry).toHaveBeenCalledWith("2026-09-30", "09:00", "10:00");
  });

  it("moves to the next day with ArrowRight and keeps the time", async () => {
    const { container } = renderWeek();

    fireEvent.mouseEnter(dayColumn(container, 0));
    const cursor = await screen.findByRole("button", { name: CURSOR });
    fireEvent.focus(cursor);
    fireEvent.keyDown(cursor, { key: "ArrowRight" });

    // The cursor moved to Tuesday's column and took the focus with it
    await vi.waitFor(() => {
      const label = document.activeElement?.getAttribute("aria-label");
      expect(label).toBe("Opret registrering kl. 09:00–10:00");
      expect(dayColumn(container, 1).contains(document.activeElement)).toBe(
        true,
      );
    });

    fireEvent.keyDown(document.activeElement as HTMLElement, {
      key: "ArrowUp",
    });
    fireEvent.keyDown(document.activeElement as HTMLElement, { key: "Enter" });

    expect(onCreateEntry).toHaveBeenCalledWith("2026-09-29", "08:45", "09:45");
  });

  it("does not leave the week when the user pushes ArrowRight at the end", async () => {
    const { container } = renderWeek();

    fireEvent.mouseEnter(dayColumn(container, 6));
    const cursor = await screen.findByRole("button", { name: CURSOR });
    fireEvent.focus(cursor);
    fireEvent.keyDown(cursor, { key: "ArrowRight" });

    // Still Sunday, still logged there
    fireEvent.keyDown(cursor, { key: "Enter" });
    expect(onCreateEntry).toHaveBeenCalledWith("2026-10-04", "09:00", "10:00");
  });
});
