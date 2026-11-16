import { cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));

import { useTimerStore } from "@/stores/timerStore";
import { useKeyboardShortcuts } from "../useKeyboardShortcuts";

const start = vi.fn(async () => {});
const stop = vi.fn(async () => {});

function setTimerRunning(running: boolean) {
  useTimerStore.setState({ isRunning: running, start, stop });
}

function press(key: string, init: Partial<KeyboardEventInit> = {}) {
  fireEvent.keyDown(document.body, { key, ctrlKey: true, ...init });
}

beforeEach(() => {
  start.mockClear();
  stop.mockClear();
  setTimerRunning(false);
});

afterEach(() => {
  cleanup();
  useTimerStore.setState({ isRunning: false });
});

describe("Ctrl+Shift+T og Ctrl+Shift+S", () => {
  // The command palette advertises both keys, so they have to do what the
  // badge says. start() takes no arguments, so an unguarded Ctrl+Shift+T while
  // a timer runs would bill a second entry with no project.
  it("starter timeren med Ctrl+Shift+T, når den ikke kører", () => {
    renderHook(() => useKeyboardShortcuts());

    press("T", { shiftKey: true });

    expect(start).toHaveBeenCalledTimes(1);
    expect(stop).not.toHaveBeenCalled();
  });

  it("gør intet med Ctrl+Shift+T, når timeren allerede kører", () => {
    setTimerRunning(true);
    renderHook(() => useKeyboardShortcuts());

    press("T", { shiftKey: true });

    expect(start).not.toHaveBeenCalled();
  });

  it("stopper timeren med Ctrl+Shift+S, når den kører", () => {
    setTimerRunning(true);
    renderHook(() => useKeyboardShortcuts());

    press("S", { shiftKey: true });

    expect(stop).toHaveBeenCalledTimes(1);
    expect(start).not.toHaveBeenCalled();
  });

  it("gør intet med Ctrl+Shift+S, når timeren ikke kører", () => {
    renderHook(() => useKeyboardShortcuts());

    press("S", { shiftKey: true });

    expect(stop).not.toHaveBeenCalled();
  });

  it("lader Ctrl+T være Ctrl+N og lignende", () => {
    renderHook(() => useKeyboardShortcuts());

    press("t");

    expect(start).not.toHaveBeenCalled();
  });

  it("lader Ctrl+T alene være ulovet", () => {
    renderHook(() => useKeyboardShortcuts());

    press("t", { shiftKey: false });

    expect(start).not.toHaveBeenCalled();
  });
});
