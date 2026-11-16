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

import type { Activity, Project } from "@/lib/types";
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

const PROJECT: Project = {
  id: "p-1",
  remote_id: null,
  client_id: "c-1",
  name: "Kundeprojekt",
  hourly_rate: null,
  color: null,
  estimated_hours: null,
  is_archived: false,
  created_at: "2026-09-01T00:00:00",
  updated_at: "2026-09-01T00:00:00",
  synced_at: null,
  client_name: "Kunden",
};

describe("TimelineView bulk-handlinger", () => {
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
      if (cmd === "list_projects") return Promise.resolve([PROJECT]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  async function flush() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  function callsTo(cmd: string): Record<string, unknown>[] {
    return invoke.mock.calls
      .filter((call) => call[0] === cmd)
      .map((call) => (call[1] ?? {}) as Record<string, unknown>);
  }

  function click(label: string | RegExp) {
    fireEvent.click(screen.getByRole("button", { name: label }));
  }

  async function renderTimeline() {
    render(<TimelineView />);
    await flush();
  }

  /** Turn on bulk mode and select every non-idle activity. */
  async function selectAllActivities() {
    click("Vælg flere");
    await flush();
    click("Vælg alle");
    await flush();
  }

  /**
   * The wiring between the bar and the operation, verified through the real UI:
   * one call per activity, in the order the day lists them. The operations'
   * own double-click protection is covered in `src/lib/__tests__/bulkActions`.
   */
  it("tildeler hver valgt aktivitet én registrering", async () => {
    await renderTimeline();
    await selectAllActivities();

    click("Tildel til projekt");
    await flush();
    click(/Vælg projekt/);
    await flush();
    click(/Kundeprojekt/);
    await flush();

    expect(
      callsTo("create_time_entry").map(
        (args) => (args.input as { start_time: string }).start_time,
      ),
    ).toEqual(activities.map((a) => a.started_at));
    expect(
      callsTo("create_time_entry").map(
        (args) => (args.input as { project_id: string }).project_id,
      ),
    ).toEqual([PROJECT.id, PROJECT.id, PROJECT.id]);
    expect(
      callsTo("confirm_classification").map((args) => args.activityId),
    ).toEqual([1, 2, 3]);
  });

  it("sletter hver valgt aktivitet én gang", async () => {
    await renderTimeline();
    await selectAllActivities();

    click("Slet");
    await flush();
    click("Slet 3 aktiviteter");
    await flush();

    expect(callsTo("delete_activity").map((args) => args.activityId)).toEqual([
      1, 2, 3,
    ]);
  });

  it("markerer hver valgt aktivitet som ikke-fakturerbar", async () => {
    await renderTimeline();
    await selectAllActivities();

    click("Ikke-fakturerbar");
    await flush();

    expect(
      callsTo("confirm_classification").map((args) => args.activityId),
    ).toEqual([1, 2, 3]);
    // Ikke-fakturerbar opretter ingen registrering — den klassificerer kun.
    expect(callsTo("create_time_entry")).toHaveLength(0);
  });

  it("lader valg stå, når en registrering fejler", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(activities);
      if (cmd === "list_projects") return Promise.resolve([PROJECT]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      if (cmd === "create_time_entry") {
        return Promise.reject(new Error("database locked"));
      }
      return Promise.resolve(null);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await renderTimeline();
      await selectAllActivities();

      click("Tildel til projekt");
      await flush();
      click(/Vælg projekt/);
      await flush();
      click(/Kundeprojekt/);
      await flush();

      // En fejl må ikke tømme valget: brugeren kan prøve igen med et forsøg mindre.
      expect(screen.getByText("3 valgt")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: /Tildel til projekt/ }),
      ).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });

  /**
   * En kørsel går én aktivitet ad gangen, så den kan fejle halvvejs. Skærmen
   * skal så vise hvad der faktisk skete — ellers ligner de bekræftede stadig
   * ubekræftede, og et nyt forsøg registrerer den samme tid igen.
   *
   * Her fejler den *tredje* registrering, så de to første er skrevet i den
   * mockede database; genkaldet skal derfor kun skrive nummer tre.
   */
  it("genkører ikke tid, der allerede blev registreret før en fejl", async () => {
    let db = activities;
    let oprettede = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(db);
      if (cmd === "list_projects") return Promise.resolve([PROJECT]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      if (cmd === "confirm_classification") {
        const sidste = invoke.mock.calls[invoke.mock.calls.length - 1];
        const args = (sidste?.[1] ?? {}) as { activityId: number };
        db = db.map((a) =>
          a.id === args.activityId
            ? {
                ...a,
                is_confirmed: true,
                project_id: PROJECT.id,
                category: "development",
              }
            : a,
        );
        return Promise.resolve(null);
      }
      if (cmd === "create_time_entry") {
        oprettede += 1;
        // Den tredje fejler, som en låst database ville gøre det.
        if (oprettede === 3)
          return Promise.reject(new Error("database locked"));
        return Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    try {
      await renderTimeline();
      await selectAllActivities();

      click("Tildel til projekt");
      await flush();
      click(/Vælg projekt/);
      await flush();
      click(/Kundeprojekt/);
      await flush();

      // Første forsøg: to skrevet, det tredje fejlede.
      expect(callsTo("create_time_entry")).toHaveLength(3);

      // Skærmen er genindlæst, og valget er præcis den aktivitet, hvis
      // registrering aldrig blev skrevet — de to andre er skrevet, selv om de i
      // databasen står som bekræftede.
      await flush();
      expect(screen.getByText("1 valgt")).toBeTruthy();

      click("Tildel til projekt");
      await flush();
      click(/Vælg projekt/);
      await flush();
      click(/Kundeprojekt/);
      await flush();

      // Genkaldet skriver kun den tredje igen. Den står to gange, fordi dens
      // første forsøg var det der fejlede — de to første står *én* gang hver.
      // Sådan er der hverken dobbelt tid eller tabt tid.
      expect(oprettede).toBe(4);
      expect(
        callsTo("create_time_entry").map(
          (args) => (args.input as { start_time: string }).start_time,
        ),
      ).toEqual([
        activities[0].started_at,
        activities[1].started_at,
        activities[2].started_at,
        activities[2].started_at,
      ]);
    } finally {
      consoleError.mockRestore();
    }
  });

  /**
   * "Godkend alle" writes every activity on the day, so a double click would
   * bill the whole day twice. The button is disabled while the run goes, but
   * the operation's own lock is what makes the second click harmless.
   */
  it("registrerer hver aktivitet én gang, når Godkend alle trykkes to gange", async () => {
    activities = activities.map((a) => ({
      ...a,
      confidence: 0.95,
      category: "development",
      project_id: PROJECT.id,
    }));

    const resolvers: (() => void)[] = [];
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(activities);
      if (cmd === "list_projects") return Promise.resolve([PROJECT]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      return new Promise((resolve) => resolvers.push(() => resolve(null)));
    });

    await renderTimeline();

    const button = screen.getByRole("button", { name: /Godkend alle/ });
    // Begge klik i samme batch: React har ikke disablet knappen endnu, så det
    // andet klik kommer med — præcis som et dobbeltklik i virkeligheden.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    for (let step = 0; step < 20 && resolvers.length > 0; step++) {
      for (const resolve of resolvers.splice(0)) resolve();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(10);
      });
    }

    expect(callsTo("bulk_confirm_classifications")).toHaveLength(1);
    expect(callsTo("create_time_entry")).toHaveLength(3);
  });
});
