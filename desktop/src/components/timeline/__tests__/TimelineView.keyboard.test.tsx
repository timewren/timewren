import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

const invoke = vi.fn();
const listen = vi.fn(async () => () => {});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...(args as [])),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import type { Activity } from "@/lib/types";
import { TimelineView } from "../TimelineView";

// The view is "today" at mount, so the clock is pinned and the assertions do
// not drift with the wall clock.
const CLOCK = new Date(2026, 8, 29, 9, 0);

let nextId = 1;

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  const id = overrides.id ?? nextId++;
  return {
    id,
    app_name: `app-${id}`,
    window_title: `title-${id}`,
    url: null,
    git_branch: null,
    git_repo: null,
    context_path: null,
    file_path: null,
    category: null,
    project_id: null,
    client_id: null,
    confidence: null,
    classification_source: null,
    classification_reason: null,
    is_confirmed: false,
    is_idle: false,
    // An hour apart, so no two rows merge into one block.
    started_at: `2026-09-29T${String(8 + id).padStart(2, "0")}:00:00`,
    ended_at: `2026-09-29T${String(8 + id).padStart(2, "0")}:30:00`,
    duration: 1800,
    ...overrides,
  };
}

/** The live region the screen reader hears, kept to its visible text. */
function announcement(): string {
  const node = document.querySelector("[aria-live='polite']");
  return node?.textContent?.trim() ?? "";
}

function press(key: string) {
  act(() => {
    fireEvent.keyDown(document.body, { key });
  });
}

describe("TimelineView tastaturnavigation", () => {
  let activities: Activity[] = [];

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    nextId = 1;
    activities = [makeActivity(), makeActivity(), makeActivity()];
    invoke.mockReset();
    listen.mockClear();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(activities);
      if (cmd === "list_projects") return Promise.resolve([]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function renderTimeline() {
    render(<TimelineView />);
    // Wait for the first load to land, otherwise j/k fires against an empty
    // list and the test proves nothing.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  it("skifter dag med venstre/højre pil, ligesom dagsknapperne", async () => {
    await renderTimeline();

    expect(screen.getByText("I dag")).toBeTruthy();

    press("ArrowRight");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("30. sep 2026")).toBeTruthy();

    press("ArrowLeft");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
    expect(screen.getByText("I dag")).toBeTruthy();
  });

  it("skifter dag på en dag uden registreringer", async () => {
    activities = [];
    await renderTimeline();
    expect(
      screen.getByText("Ingen aktiviteter registreret i dag"),
    ).toBeTruthy();

    press("ArrowRight");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    expect(screen.getByText("30. sep 2026")).toBeTruthy();
    expect(
      screen.getByText("Ingen aktiviteter registreret denne dag"),
    ).toBeTruthy();
  });

  it("læser højt hvor markøren er, når j bevæger den", async () => {
    await renderTimeline();
    expect(announcement()).toBe("");

    press("j");
    expect(announcement()).toContain("app-1");
    expect(announcement()).toContain("1");
    expect(announcement()).toContain("3");

    press("j");
    expect(announcement()).toContain("app-2");

    // k holder på den første række — Esc tager hele markøren væk.
    press("k");
    press("k");
    expect(announcement()).toContain("app-1");

    press("Escape");
    expect(announcement()).toBe("");
  });

  it("glemmer ikke markøren på den nye dag", async () => {
    await renderTimeline();
    press("j");
    expect(announcement()).toContain("app-1");

    press("ArrowRight");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });

    // Dagen har andre rækker, så en gammel markør ville pege på noget andet.
    expect(announcement()).toBe("");
  });

  it("ruller den markerede række ind i visning", async () => {
    const scrollIntoView = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      await renderTimeline();
      press("j");
      press("j");
      expect(scrollIntoView).toHaveBeenCalledTimes(2);
      expect(scrollIntoView.mock.calls[1][0]).toEqual({ block: "nearest" });
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it("åbner bekræftelsen på den markerede registrering med Enter", async () => {
    await renderTimeline();
    press("j");
    press("Enter");

    // ConfirmDialog åbnes for præcis den række, markøren står på.
    expect(invoke).not.toHaveBeenCalledWith(
      "bulk_confirm_classifications",
      expect.anything(),
    );
    expect(screen.getAllByRole("dialog").length).toBeGreaterThan(0);
  });
});
