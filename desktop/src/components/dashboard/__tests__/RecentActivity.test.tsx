import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import type { Activity, Project } from "@/lib/types";
import { RecentActivity } from "../RecentActivity";

const CLOCK = new Date(2026, 8, 30, 9, 0);

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
    started_at: `2026-09-30T${String(8 + id).padStart(2, "0")}:00:00`,
    ended_at: `2026-09-30T${String(8 + id).padStart(2, "0")}:30:00`,
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
  color: "#ff8800",
  estimated_hours: null,
  is_archived: false,
  created_at: "2026-09-01T00:00:00",
  updated_at: "2026-09-01T00:00:00",
  synced_at: null,
  client_name: "Kunden",
};

function stubInvoke(
  activities: Activity[] | (() => Promise<Activity[]>) = [],
  projects: Project[] = [PROJECT],
) {
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "list_activities") {
      return typeof activities === "function"
        ? activities()
        : Promise.resolve(activities);
    }
    if (cmd === "list_projects") return Promise.resolve(projects);
    return Promise.resolve(null);
  });
}

function activityList(): HTMLElement {
  return screen.getByRole("list", { name: /seneste aktivitet/i });
}

describe("RecentActivity", () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    nextId = 1;
    invoke.mockReset();
    stubInvoke();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("viser dagens aktiviteter nyeste først med tidspunkt, app, titel og projekt", async () => {
    stubInvoke([
      makeActivity({
        id: 1,
        app_name: "Code",
        window_title: "backup.rs",
        started_at: "2026-09-30T08:00:00",
        duration: 1800,
      }),
      makeActivity({
        id: 2,
        app_name: "Safari",
        window_title: "nyheder.dk",
        project_id: "p-1",
        started_at: "2026-09-30T08:45:00",
        duration: 900,
      }),
    ]);

    render(<RecentActivity />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(2),
    );

    const rows = screen.getAllByRole("listitem");
    // Newest first, so the 08:45 row comes before the 08:00 row.
    expect(within(rows[0]).getByText("Safari")).toBeTruthy();
    expect(within(rows[0]).getByText("Kundeprojekt")).toBeTruthy();
    expect(within(rows[0]).getByText("15m")).toBeTruthy();
    expect(within(rows[0]).getByText("08:45")).toBeTruthy();
    expect(within(rows[0]).getByText("nyheder.dk")).toBeTruthy();

    expect(within(rows[1]).getByText("Code")).toBeTruthy();
    expect(within(rows[1]).getByText("backup.rs")).toBeTruthy();
  });

  it("spørgter om dagens dato, så aktiviteter fra andre dage ikke dukker op", async () => {
    stubInvoke([]);
    render(<RecentActivity />);

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("list_activities", {
        date: "2026-09-30",
      }),
    );
  });

  it("viser højst de seks nyeste", async () => {
    stubInvoke(
      Array.from({ length: 9 }, () =>
        makeActivity({ app_name: "app", window_title: null }),
      ),
    );

    render(<RecentActivity />);

    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(6),
    );
  });

  it("viser en indlæsningstilstand og ingen rækker, før data kommer", async () => {
    let resolveActivities: (value: Activity[]) => void = () => {};
    stubInvoke(
      () =>
        new Promise<Activity[]>((resolve) => {
          resolveActivities = resolve;
        }),
    );

    render(<RecentActivity />);

    expect(
      screen.getByRole("heading", { name: "Seneste aktivitet" }),
    ).toBeTruthy();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);

    resolveActivities([makeActivity()]);
    await waitFor(() =>
      expect(screen.getAllByRole("listitem")).toHaveLength(1),
    );
  });

  it("forklarer i tom tilstand, hvad brugeren kan gøre", async () => {
    stubInvoke([]);
    render(<RecentActivity />);

    await waitFor(() =>
      expect(
        screen.getByText(/Ingen aktivitet registreret i dag/),
      ).toBeTruthy(),
    );
    expect(screen.getByText(/Start auto-sporing/)).toBeTruthy();
  });

  it("viser en fejltilstand der kun rammer widgetten, og genindlæser på Prøv igen", async () => {
    let activityCalls = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") {
        activityCalls += 1;
        return activityCalls === 1
          ? Promise.reject(new Error("db låst"))
          : Promise.resolve([makeActivity({ app_name: "Code" })]);
      }
      return Promise.resolve([PROJECT]);
    });

    render(
      <div>
        <RecentActivity />
        <p>Dashboardets øvrige indhold</p>
      </div>,
    );

    await waitFor(() =>
      expect(screen.getByText("Kunne ikke hente aktiviteter.")).toBeTruthy(),
    );
    expect(screen.getByText("Dashboardets øvrige indhold")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Prøv igen/ }));

    await waitFor(() => expect(screen.getByText("Code")).toBeTruthy());
    expect(screen.queryByText("Kunne ikke hente aktiviteter.")).toBeNull();
  });

  it("viser aktiviteterne selv om projekterne ikke kan hentes", async () => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") {
        return Promise.resolve([
          makeActivity({ app_name: "Code", project_id: "p-1" }),
        ]);
      }
      if (cmd === "list_projects")
        return Promise.reject(new Error("læs fejlede"));
      return Promise.resolve(null);
    });

    render(<RecentActivity />);

    await waitFor(() => expect(screen.getByText("Code")).toBeTruthy());
    expect(screen.queryByText("Kunne ikke hente aktiviteter.")).toBeNull();
    expect(activityList()).toBeTruthy();
  });

  it("genindlæser når vinduet får fokus, så feedet følger auto-sporingen", async () => {
    let call = 0;
    stubInvoke(() => {
      call += 1;
      return Promise.resolve([makeActivity({ app_name: `app-${call}` })]);
    });

    render(<RecentActivity />);
    await waitFor(() => expect(screen.getByText("app-1")).toBeTruthy());

    fireEvent(window, new Event("focus"));

    await waitFor(() => expect(screen.getByText("app-2")).toBeTruthy());
  });

  it("beholder fejltilstanden under et refresh i stedet for at vise den tom", async () => {
    let activityCalls = 0;
    stubInvoke(() => {
      activityCalls += 1;
      if (activityCalls === 1) return Promise.reject(new Error("db låst"));
      // Second call never settles within the test, like a fetch in flight.
      return new Promise<Activity[]>(() => {});
    });

    render(<RecentActivity />);
    await waitFor(() =>
      expect(screen.getByText("Kunne ikke hente aktiviteter.")).toBeTruthy(),
    );

    fireEvent(window, new Event("focus"));

    expect(screen.getByText("Kunne ikke hente aktiviteter.")).toBeTruthy();
    expect(screen.queryByText(/Ingen aktivitet registreret/)).toBeNull();
  });
});
