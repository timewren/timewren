import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TimeEntryForm } from "@/components/tracker/TimeEntryForm";
import type { Client, Project } from "@/lib/types";

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

function createCalls(): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === "create_time_entry")
    .map(
      (call) =>
        ((call[1] as { input?: Record<string, unknown> })?.input ??
          {}) as Record<string, unknown>,
    );
}

function kundeVælger(): HTMLSelectElement {
  return screen.getByLabelText("Klient") as HTMLSelectElement;
}

async function renderForm() {
  const view = render(
    <TimeEntryForm
      open
      onClose={() => {}}
      onSaved={() => {}}
      entry={null}
      defaultDate="2026-09-30"
      defaultStartTime="09:00"
      defaultEndTime="10:00"
    />,
  );
  await waitFor(() => expect(kundeVælger()).toBeTruthy());
  return view;
}

function vælgProjekt(navn: string) {
  fireEvent.click(screen.getByLabelText("Vælg projekt..."));
  fireEvent.click(screen.getByText(navn));
}

function gem() {
  const knap = screen
    .getAllByRole("button", { name: "Opret" })
    .find((k) => k.textContent?.trim() === "Opret");
  if (!knap) throw new Error("dialogens gem-knap mangler");
  fireEvent.click(knap);
}

describe("TimeEntryForm — kunde uden projekt", () => {
  // Vitest har ikke `globals: true`, så RTL's auto-cleanup ikke kører, og det
  // gamle DOM' ligger stadig i dokumentet og matcher på sit label.
  afterEach(() => cleanup());

  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve(PROJECTS);
      if (cmd === "list_clients") return Promise.resolve(CLIENTS);
      if (cmd === "suggest_project_for_context") return Promise.resolve(null);
      if (cmd === "create_time_entry") return Promise.resolve(null);
      return Promise.resolve(null);
    });
  });

  it("gemmer en kunde uden projekt", async () => {
    await renderForm();
    fireEvent.change(kundeVælger(), { target: { value: "c-acme" } });
    gem();

    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]).toMatchObject({
      client_id: "c-acme",
      project_id: null,
    });
  });

  it("sætter kunden til projektets kunde", async () => {
    await renderForm();
    fireEvent.change(kundeVælger(), { target: { value: "c-bolig" } });
    vælgProjekt("Acme web");
    expect(kundeVælger().value).toBe("c-acme");

    gem();
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]).toMatchObject({
      project_id: "p-acme-web",
      client_id: "c-acme",
    });
  });

  it("rydder kunden ved et projekt uden kunde", async () => {
    await renderForm();
    fireEvent.change(kundeVælger(), { target: { value: "c-acme" } });
    vælgProjekt("Eget arbejde");
    // Et projekt uden kunde må ikke fortsætte med at fakturere den kunde, der
    // var valgt før — det er præcis den fejlmærkning, der sender penge forkert.
    expect(kundeVælger().value).toBe("");

    gem();
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]).toMatchObject({
      project_id: "p-eget",
      client_id: null,
    });
  });

  it("beholder kunden når projektet sættes til intet", async () => {
    await renderForm();
    vælgProjekt("Acme web");
    vælgProjekt("Ingen projekt");
    expect(kundeVælger().value).toBe("c-acme");

    gem();
    await waitFor(() => expect(createCalls()).toHaveLength(1));
    expect(createCalls()[0]).toMatchObject({
      project_id: null,
      client_id: "c-acme",
    });
  });
});
