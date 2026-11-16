import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import "@/lib/i18n";
import { TimeEntryForm } from "@/components/tracker/TimeEntryForm";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

function input(id: string): HTMLInputElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`feltet ${id} mangler i dialogen`);
  return el as HTMLInputElement;
}

function callsTo(cmd: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === cmd)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

/** Dialogens knap i footeren. Ikke `getByRole`: dropdowns har også "Opret". */
function gemKnap(): HTMLElement {
  const knap = screen
    .getAllByRole("button", { name: "Opret" })
    .find((k) => k.textContent?.trim() === "Opret");
  if (!knap) throw new Error("dialogens gem-knap mangler");
  return knap;
}

function renderForm() {
  return render(
    <TimeEntryForm
      open
      onClose={() => {}}
      onSaved={() => {}}
      entry={null}
      defaultDate="2026-09-30"
      defaultStartTime="22:00"
    />,
  );
}

describe("TimeEntryForm — nattevagter", () => {
  beforeEach(() => {
    invoke.mockReset();
    // Projekter, klienter og forslag er ikke emne for denne test.
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects" || cmd === "list_clients") {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    });
  });

  it("siger at registreringen slutter næste dag", async () => {
    renderForm();
    fireEvent.change(input("entry-end-time"), { target: { value: "02:00" } });

    // Uden denne besked ligner gemt tid 20 timer lang, selv om den er 4.
    expect(screen.getByText(/Slutter næste dag/)).toBeTruthy();
  });

  it("siger intet, når vagten ikke krydser midnat", async () => {
    renderForm();
    fireEvent.change(input("entry-end-time"), { target: { value: "23:00" } });

    expect(screen.queryByText(/Slutter næste dag/)).toBeNull();
  });

  it("gemmer fire timer frem for minus tyve", async () => {
    renderForm();
    fireEvent.change(input("entry-end-time"), { target: { value: "02:00" } });

    fireEvent.click(gemKnap());

    await waitFor(() => {
      expect(callsTo("create_time_entry")).toHaveLength(1);
    });
    const payload = callsTo("create_time_entry")[0].input as {
      start_time: string;
      end_time: string;
      duration: number;
    };
    expect(payload.start_time).toBe("2026-09-30T22:00:00");
    expect(payload.end_time).toBe("2026-10-01T02:00:00");
    expect(payload.duration).toBe(14400);
  });

  it("gemmer ikke en registrering uden varighed", async () => {
    renderForm();
    fireEvent.change(input("entry-end-time"), { target: { value: "22:00" } });

    fireEvent.click(gemKnap());

    expect(
      await screen.findByText("Sluttid skal være efter starttid"),
    ).toBeTruthy();
    expect(callsTo("create_time_entry")).toHaveLength(0);
  });
});
