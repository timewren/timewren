import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { IdleReturnPrompt } from "@/components/tracker/IdleReturnPrompt";
import type { Client, Project } from "@/lib/types";

const invoke = vi.fn();
let emit: ((payload: unknown) => void) | null = null;

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: (_name: string, handler: (e: { payload: unknown }) => void) => {
    emit = (payload: unknown) => handler({ payload });
    return Promise.resolve(() => {});
  },
}));

const CLIENTS = [
  { id: "c-acme", name: "Acme", company: "ApS" },
  { id: "c-bolig", name: "Bolig" },
] as Client[];

const PROJECTS = [
  { id: "p-acme-web", name: "Acme web", client_id: "c-acme" },
  { id: "p-eget", name: "Eget arbejde", client_id: null },
] as Project[];

const IDLE = {
  start: "2026-06-02T11:05:00+00:00",
  end: "2026-06-02T11:52:00+00:00",
  durationSecs: 2820,
};

function overlapping(guess: { clientId?: string; projectId?: string }) {
  return [
    {
      event: { id: 1, summary: "Support" },
      guess_project_id: guess.projectId ?? null,
      guess_project_name: null,
      guess_client_id: guess.clientId ?? null,
      guess_client_name: null,
    },
  ];
}

function logCalls(): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === "log_idle_period")
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

function kundeVælger(): HTMLSelectElement {
  return screen.getByLabelText("Klient") as HTMLSelectElement;
}

function vælgProjekt(navn: string) {
  fireEvent.click(screen.getByLabelText("Vælg projekt..."));
  fireEvent.click(screen.getByText(navn));
}

function log() {
  const knap = screen
    .getAllByRole("button")
    .find((k) => k.textContent?.trim() === "Log på projekt");
  if (!knap) throw new Error("promptens log-knap mangler");
  fireEvent.click(knap);
}

async function visPrompt(guess: { clientId?: string } = {}) {
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "list_projects") return Promise.resolve(PROJECTS);
    if (cmd === "list_clients") return Promise.resolve(CLIENTS);
    if (cmd === "list_events_overlapping")
      return Promise.resolve(overlapping(guess));
    if (cmd === "log_idle_period") return Promise.resolve(null);
    return Promise.resolve(null);
  });
  render(<IdleReturnPrompt />);
  // The card only exists once the tracker emits, so the prompt is driven the
  // same way the app does it.
  await waitFor(() => expect(emit).not.toBeNull());
  emit?.(IDLE);
  await waitFor(() => expect(kundeVælger()).toBeTruthy());
  await waitFor(() =>
    expect(
      invoke.mock.calls.some((c) => c[0] === "list_events_overlapping"),
    ).toBe(true),
  );
  if (guess.clientId) {
    await waitFor(() => expect(kundeVælger().value).toBe(guess.clientId));
  }
}

describe("IdleReturnPrompt — kunde uden projekt", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    invoke.mockReset();
    emit = null;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve(PROJECTS);
      if (cmd === "list_clients") return Promise.resolve(CLIENTS);
      if (cmd === "list_events_overlapping")
        return Promise.resolve(overlapping({}));
      if (cmd === "log_idle_period") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  // The calendar names a customer with no project of their own. The prompt must
  // offer that customer — this is the meeting they were away for, and before
  // this the guess was dropped for naming no project, so the entry was logged
  // to nobody.
  it("forudfylder kunden fra et møde uden projekt", async () => {
    await visPrompt({ clientId: "c-bolig" });
    expect(kundeVælger().value).toBe("c-bolig");

    log();
    await waitFor(() => expect(logCalls()).toHaveLength(1));
    expect(logCalls()[0]).toMatchObject({
      clientId: "c-bolig",
      projectId: null,
    });
  });

  // A project still decides its own customer, so a project of another customer
  // can never bill the one the prompt had pre-filled.
  it("sætter kunden til projektets kunde", async () => {
    await visPrompt({ clientId: "c-bolig" });
    vælgProjekt("Acme web");
    expect(kundeVælger().value).toBe("c-acme");

    log();
    await waitFor(() => expect(logCalls()).toHaveLength(1));
    expect(logCalls()[0]).toMatchObject({
      projectId: "p-acme-web",
      clientId: "c-acme",
    });
  });

  // "Intet projekt" keeps the chosen customer — that is the whole point of the
  // customer-only path.
  it("beholder kunden når projektet sættes til intet", async () => {
    await visPrompt();
    vælgProjekt("Acme web");
    vælgProjekt("Ingen projekt");
    expect(kundeVælger().value).toBe("c-acme");

    log();
    await waitFor(() => expect(logCalls()).toHaveLength(1));
    expect(logCalls()[0]).toMatchObject({
      projectId: null,
      clientId: "c-acme",
    });
  });

  // A project with no customer clears the choice rather than leaving a stale
  // customer on a project that belongs to nobody.
  it("rydder kunden ved et projekt uden kunde", async () => {
    await visPrompt();
    vælgProjekt("Eget arbejde");
    expect(kundeVælger().value).toBe("");

    log();
    await waitFor(() => expect(logCalls()).toHaveLength(1));
    expect(logCalls()[0]).toMatchObject({
      projectId: "p-eget",
      clientId: null,
    });
  });
});
