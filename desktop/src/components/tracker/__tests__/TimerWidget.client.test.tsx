import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TimerWidget } from "@/components/tracker/TimerWidget";
import type { Client, Project } from "@/lib/types";
import { useTimerStore } from "@/stores/timerStore";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

const CLIENTS = [
  { id: "c-acme", name: "Acme", company: "ApS" },
  { id: "c-bolig", name: "Bolig" },
] as Client[];

const PROJECTS = [
  { id: "p-acme-web", name: "Acme web", client_id: "c-acme" },
  { id: "p-eget", name: "Eget arbejde", client_id: null },
] as Project[];

/** As the `start_timer` response — the store reads every field of it. */
const STARTED = {
  id: "t-1",
  start_time: new Date().toISOString(),
  project_id: null,
  client_id: "c-acme",
  description: null,
  project_name: null,
  client_name: null,
  project_color: null,
};

function startTimerCalls(): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === "start_timer")
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function kundeVælger(): HTMLSelectElement {
  return screen.getByLabelText("Klient") as HTMLSelectElement;
}

async function renderWidget() {
  const view = render(<TimerWidget />);
  await waitFor(() => expect(kundeVælger()).toBeTruthy());
  return view;
}

function vælgProjekt(navn: string) {
  fireEvent.click(screen.getByLabelText("Vælg projekt..."));
  fireEvent.click(screen.getByText(navn));
}

function start() {
  fireEvent.click(screen.getByRole("button", { name: "Start" }));
}

describe("TimerWidget — kunde uden projekt", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve(PROJECTS);
      if (cmd === "list_clients") return Promise.resolve(CLIENTS);
      if (cmd === "get_recent_entries") return Promise.resolve([]);
      if (cmd === "suggest_project_for_context") return Promise.resolve(null);
      if (cmd === "start_timer") return Promise.resolve(STARTED);
      return Promise.resolve(null);
    });
    useTimerStore.setState({ isRunning: false, elapsed: 0 });
  });

  afterEach(async () => {
    // `stop` rydder det interval, `start` startede, så ingen test arver ticking.
    await useTimerStore.getState().stop();
    // Vitest har ikke `globals: true`, så RTL's auto-cleanup ikke kører, og
    // det gamle DOM' ligger stadig i dokumentet og matcher på sit label.
    cleanup();
  });

  it("starter timeren på en kunde alene", async () => {
    await renderWidget();
    fireEvent.change(kundeVælger(), { target: { value: "c-acme" } });
    start();

    await waitFor(() => expect(startTimerCalls()).toHaveLength(1));
    expect(startTimerCalls()[0]).toMatchObject({
      projectId: null,
      clientId: "c-acme",
    });
  });

  it("sætter kunden til projektets kunde", async () => {
    await renderWidget();
    fireEvent.change(kundeVælger(), { target: { value: "c-bolig" } });
    vælgProjekt("Acme web");
    expect(kundeVælger().value).toBe("c-acme");

    start();
    await waitFor(() => expect(startTimerCalls()).toHaveLength(1));
    expect(startTimerCalls()[0]).toMatchObject({
      projectId: "p-acme-web",
      clientId: "c-acme",
    });
  });

  it("rydder kunden ved et projekt uden kunde", async () => {
    await renderWidget();
    fireEvent.change(kundeVælger(), { target: { value: "c-acme" } });
    vælgProjekt("Eget arbejde");
    // Et projekt uden kunde må ikke fortsætte med at fakturere den kunde, der
    // var valgt før — det er præcis den fejlmærkning, der sender penge forkert.
    expect(kundeVælger().value).toBe("");

    start();
    await waitFor(() => expect(startTimerCalls()).toHaveLength(1));
    expect(startTimerCalls()[0]).toMatchObject({
      projectId: "p-eget",
      clientId: null,
    });
  });

  it("beholder kunden når projektet sættes til intet", async () => {
    await renderWidget();
    vælgProjekt("Acme web");
    fireEvent.click(screen.getByLabelText("Vælg projekt..."));
    fireEvent.click(screen.getByText("Ingen projekt"));
    expect(kundeVælger().value).toBe("c-acme");
  });
});
