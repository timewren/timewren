import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import type { Client, Project } from "@/lib/types";
import { AddMatcherForm } from "../AddMatcherForm";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

const CLIENTS = [
  { id: "c-acme", name: "Acme" },
  { id: "c-bolig", name: "Bolig" },
] as Client[];

const PROJECTS = [
  { id: "p-acme-web", name: "Acme web", client_id: "c-acme" },
  // A project with no customer of its own — choosing it must CLEAR the customer,
  // or the signal would name two conflicting parties.
  { id: "p-eget", name: "Eget arbejde", client_id: null },
] as Project[];

function matcherKald(): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === "add_project_matcher")
    .map((call) => {
      const args = (call[1] ?? {}) as { matcher?: Record<string, unknown> };
      return args.matcher ?? {};
    });
}

function vælger(label: string): HTMLSelectElement {
  return screen.getByLabelText(label) as HTMLSelectElement;
}

async function renderForm() {
  const view = render(<AddMatcherForm />);
  await waitFor(() =>
    expect(vælger("Kunde").options.length).toBeGreaterThan(2),
  );
  return view;
}

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "list_projects") return PROJECTS;
    if (cmd === "list_clients") return CLIENTS;
    if (cmd === "add_project_matcher")
      return { classifiedActivities: 3, classifiedMinutes: 42 };
    return null;
  });
});

afterEach(cleanup);

describe("kunde uden projekt", () => {
  it("kan binde et signal til en kunde uden projekt", async () => {
    await renderForm();

    fireEvent.change(screen.getByPlaceholderText("fx video-studio"), {
      target: { value: "kunde.dk" },
    });
    fireEvent.change(vælger("Projekt"), { target: { value: "" } });
    fireEvent.change(vælger("Kunde"), { target: { value: "c-bolig" } });
    fireEvent.click(screen.getByRole("button", { name: /Tilknyt|Tilføj/ }));

    await waitFor(() => expect(matcherKald()).toHaveLength(1));
    const matcher = matcherKald()[0];
    expect(matcher.projectId).toBeNull();
    expect(matcher.clientId).toBe("c-bolig");
  });

  it("valg af et projekts kunde sætter kunden — og et projekt uden kunde rydder den", async () => {
    await renderForm();

    // The customer follows the project, in one direction only.
    fireEvent.change(vælger("Kunde"), { target: { value: "c-bolig" } });
    fireEvent.change(vælger("Projekt"), { target: { value: "p-acme-web" } });
    await waitFor(() => expect(vælger("Kunde").value).toBe("c-acme"));

    // "Intet projekt" must NOT clear it — that combination is the whole point.
    fireEvent.change(vælger("Projekt"), { target: { value: "" } });
    expect(vælger("Kunde").value).toBe("c-acme");

    // A project with no customer of its own clears it, so the signal cannot
    // name two parties.
    fireEvent.change(vælger("Projekt"), { target: { value: "p-eget" } });
    await waitFor(() => expect(vælger("Kunde").value).toBe(""));
  });

  it("kundefeltet låses, mens et projekt sætter kunden", async () => {
    await renderForm();

    // Only the customer decides whether a projectless signal is work or not,
    // so a project's own customer must not look like a second choice.
    expect(vælger("Kunde").disabled).toBe(false);
    fireEvent.change(vælger("Projekt"), { target: { value: "p-acme-web" } });
    await waitFor(() => expect(vælger("Kunde").disabled).toBe(true));
    fireEvent.change(vælger("Projekt"), { target: { value: "" } });
    expect(vælger("Kunde").disabled).toBe(false);
  });

  it("projekt OG kunde sender begge — backend afgør, hvilken der vinder", async () => {
    await renderForm();

    fireEvent.change(screen.getByPlaceholderText("fx video-studio"), {
      target: { value: "acme.dk" },
    });
    fireEvent.change(vælger("Projekt"), { target: { value: "p-acme-web" } });
    await waitFor(() => expect(vælger("Kunde").value).toBe("c-acme"));
    fireEvent.click(screen.getByRole("button", { name: /Tilføj/ }));

    await waitFor(() => expect(matcherKald()).toHaveLength(1));
    expect(matcherKald()[0].projectId).toBe("p-acme-web");
    expect(matcherKald()[0].clientId).toBe("c-acme");
  });

  it("intet valg sender null for begge — signalet er privat", async () => {
    await renderForm();

    fireEvent.change(screen.getByPlaceholderText("fx video-studio"), {
      target: { value: "facebook" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Tilføj/ }));

    await waitFor(() => expect(matcherKald()).toHaveLength(1));
    expect(matcherKald()[0].projectId).toBeNull();
    expect(matcherKald()[0].clientId).toBeNull();
  });

  // The tests above judge what is SENT, and the payload was right either way —
  // so a wrong label passed them all. The field locks exactly when a project is
  // picked, and a project without a customer must read as "no customer", not
  // "private, not work": only a signal with neither column set is private.
  it("kalder den tomme kunde 'Ingen klient', også når feltet er låst", async () => {
    await renderForm();

    fireEvent.change(vælger("Projekt"), { target: { value: "p-eget" } });
    await waitFor(() => expect(vælger("Kunde").disabled).toBe(true));

    const tom = vælger("Kunde").options[0];
    expect(tom.value).toBe("");
    expect(tom.textContent).toBe("Ingen klient");
    expect(vælger("Projekt").options[0].textContent).toBe("Intet projekt");
  });
});
