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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import type { Activity, Project } from "@/lib/types";
import { ConfirmDialog } from "../ConfirmDialog";

const ACTIVITY: Activity = {
  id: 7,
  app_name: "vscode",
  window_title: "index.ts",
  url: null,
  git_branch: null,
  git_repo: null,
  context_path: null,
  file_path: null,
  category: "development",
  project_id: "p-1",
  client_id: null,
  confidence: 0.9,
  classification_source: null,
  classification_reason: null,
  is_confirmed: false,
  is_idle: false,
  started_at: "2026-09-29T09:00:00",
  ended_at: "2026-09-29T10:00:00",
  duration: 3600,
};

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

function callsTo(cmd: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === cmd)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

describe("ConfirmDialog", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("registrerer aktiviteten én gang, når Godkend trykkes to gange", async () => {
    const onConfirmed = vi.fn();
    const resolvers: (() => void)[] = [];
    invoke.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvers.push(() => resolve(null));
        }),
    );

    render(
      <ConfirmDialog
        open
        onClose={vi.fn()}
        onConfirmed={onConfirmed}
        activity={ACTIVITY}
        projects={[PROJECT]}
      />,
    );

    const button = screen.getByRole("button", { name: "Godkend" });
    // Begge klik i samme batch: React har ikke disablet knappen endnu, så det
    // andet klik kommer med — præcis som et dobbeltklik i virkeligheden.
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });

    for (let step = 0; step < 20 && resolvers.length > 0; step++) {
      for (const resolve of resolvers.splice(0)) resolve();
      await act(async () => {});
    }

    expect(callsTo("confirm_classification")).toHaveLength(1);
    expect(callsTo("create_time_entry")).toHaveLength(1);
    expect(onConfirmed).toHaveBeenCalledTimes(1);
  });

  it("melder fejlen, når registreringen mislykkes", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "create_time_entry"
        ? Promise.reject(new Error("database locked"))
        : Promise.resolve(null),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const onConfirmed = vi.fn();

    try {
      render(
        <ConfirmDialog
          open
          onClose={vi.fn()}
          onConfirmed={onConfirmed}
          activity={ACTIVITY}
          projects={[PROJECT]}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Godkend" }));
      });

      expect(
        screen.getByText("Kunne ikke bekræfte aktivitet. Prøv igen."),
      ).toBeTruthy();
      expect(onConfirmed).not.toHaveBeenCalled();
    } finally {
      consoleError.mockRestore();
    }
  });

  // "Eget arbejde" — a project with no customer — is a real project shape. The
  // activity was billed to Kunde Acme by a signal bound to her alone, and the
  // user picks her own "Eget arbejde". The dialog has no customer field, so it
  // used to hand the dialog's only customer — the activity's — straight along,
  // and the entry billed Acme for internal work. What matters here is that both
  // writes agree: the entry and the pattern the backend learns.
  describe("kunden følger projektet én vej", () => {
    const OWN_PROJECT: Project = {
      ...PROJECT,
      id: "p-eget",
      name: "Eget arbejde",
      client_id: null,
      client_name: null,
    };

    /** An activity the classifier billed to a customer it found on its own. */
    const CLIENT_ACTIVITY: Activity = {
      ...ACTIVITY,
      project_id: null,
      client_id: "c-acme",
      window_title: "acme.dk — indbakke",
    };

    /** Pick a project in the dropdown, then confirm. `null` means "no project". */
    async function confirmTo(activity: Activity, projectName: string | null) {
      invoke.mockImplementation(() => Promise.resolve(null));
      render(
        <ConfirmDialog
          open
          onClose={vi.fn()}
          onConfirmed={vi.fn()}
          activity={activity}
          projects={[PROJECT, OWN_PROJECT]}
        />,
      );

      fireEvent.click(screen.getByRole("button", { name: "Vælg projekt..." }));
      // The dropdown names a project with its customer in brackets, so match
      // the name itself.
      await act(async () => {
        fireEvent.click(
          screen.getByRole("button", {
            name: projectName ? new RegExp(`^${projectName}`) : "Ingen projekt",
          }),
        );
      });
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Godkend" }));
      });
    }

    it("ryder kunden på begge skrivninger, når projektet ingen har", async () => {
      await confirmTo(CLIENT_ACTIVITY, "Eget arbejde");

      expect(callsTo("confirm_classification")[0]).toMatchObject({
        projectId: "p-eget",
        clientId: null,
      });
      expect(callsTo("create_time_entry")[0].input).toMatchObject({
        project_id: "p-eget",
        client_id: null,
      });
    });

    it("sender projektets egen kunde, når den har en", async () => {
      await confirmTo(CLIENT_ACTIVITY, "Kundeprojekt");

      expect(callsTo("confirm_classification")[0]).toMatchObject({
        projectId: "p-1",
        clientId: "c-1",
      });
      expect(callsTo("create_time_entry")[0].input).toMatchObject({
        project_id: "p-1",
        client_id: "c-1",
      });
    });

    // "Intet projekt" is the whole point of the customer-without-a-project
    // feature, so the dialog must not be the place that loses it.
    it("beholder kunden fra aktiviteten, når intet projekt vælges", async () => {
      await confirmTo(CLIENT_ACTIVITY, null);

      expect(callsTo("confirm_classification")[0]).toMatchObject({
        projectId: null,
        clientId: "c-acme",
      });
      expect(callsTo("create_time_entry")[0].input).toMatchObject({
        project_id: null,
        client_id: "c-acme",
      });
    });
  });
});
