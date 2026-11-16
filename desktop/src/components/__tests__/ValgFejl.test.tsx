import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { AddMatcherForm } from "@/components/identity/AddMatcherForm";
import { TimerWidget } from "@/components/tracker/TimerWidget";

/**
 * En vælger, hvis lister ikke kunne hentes, må ikke sige at brugeren ingen har.
 *
 * Seks komponenter hentede projekter og kunder til en vælger, og ingen af dem
 * havde en fælles fejltilstand at låne fra. Sådan så det ud i koden:
 * `GhostBlock` lod løftet stå ubeskyttet, fire skrev
 * `.catch(() => setProjects([]))`, og to slog det hele i `console.error`.
 * Alle otte hentninger endte i det samme billede — en rulleliste uden valg —
 * altså beskeden *«du har ingen projekter»*, når det var databasen der ikke
 * svarede. `TimerWidget` gjorde det på begge felter: «Ingen kunder» i
 * kundefeltet og «Ingen projekter» i dropdownen.
 *
 * Testerne her dømmer DOM'en, fordi det er den fejl, brugeren ser — ikke at
 * et `catch` er sat. De fejler mod den gamle kode, fordi den gamle kode skrev
 * præcis de to påstande.
 */

const PROJEKT = {
  id: "p1",
  name: "Kundesite",
  color: "#123456",
  client_id: "c1",
  client_name: "Kunde A",
};
const KUNDE = { id: "c1", name: "Kunde A", company: "A/S" };

function svar(fejler: string[], data: Record<string, unknown[]>) {
  invoke.mockImplementation((cmd: string) => {
    if (fejler.includes(cmd)) return Promise.reject("database unavailable");
    if (cmd in data) return Promise.resolve(data[cmd]);
    return Promise.resolve([]);
  });
}

describe("vælgere siger ikke «du har ingen», når listerne fejlede", () => {
  beforeEach(async () => {
    invoke.mockReset();
    await i18n.changeLanguage("da");
  });
  afterEach(() => {
    // Vitest kører ikke med `globals`, så testing-library's automatiske
    // unmount er ikke slået til. Uden denne bliver det forrige render liggende
    // i DOM'en, og testen måler sin egen fejl fra en tidligere test.
    cleanup();
    vi.clearAllMocks();
  });

  it("TimerWidget: en fejl i begge lister vises, og påstandene om brugerens data forsvinder", async () => {
    svar(["list_projects", "list_clients"], {});

    render(<TimerWidget />);

    // «Ingen kunder» er den påstand, der ligner mest en *besked om brugeren*:
    // den fortæller ham at han ingen kunder har, hvilket var forkert.
    await waitFor(() =>
      expect(
        screen.getByText(/kunne ikke indlæse projekter og kunder/i),
      ).toBeDefined(),
    );
    expect(screen.queryByText(/^ingen kunder$/i)).toBeNull();
    expect(screen.queryByText(/kunne ikke hente/i)).toBeNull();
  });

  it("TimerWidget: kun den liste der fejlede navngives", async () => {
    svar(["list_clients"], { list_projects: [PROJEKT] });

    render(<TimerWidget />);

    await waitFor(() =>
      expect(screen.getByText(/kunne ikke indlæse kunder/i)).toBeDefined(),
    );
    // Ikke «og kunder» — projekterne kom fint.
    expect(
      screen.queryByText(/kunne ikke indlæse projekter og kunder/i),
    ).toBeNull();
    // Og kunderne *er* væk, så «Ingen kunder» ville være sand her. Det er
    // ikke det, vi tester: vi tester at beskeden *kom* ud.
    expect(invoke).toHaveBeenCalledWith("list_projects", {
      includeArchived: false,
    });
  });

  it("TimerWidget: prøv igen henter listerne igen, og fejlen forsvinder når de svarer", async () => {
    svar(["list_projects"], { list_clients: [KUNDE] });

    render(<TimerWidget />);

    await waitFor(() =>
      expect(screen.getByText(/kunne ikke indlæse projekter$/i)).toBeDefined(),
    );

    svar([], { list_projects: [PROJEKT], list_clients: [KUNDE] });
    fireEvent.click(screen.getByRole("button", { name: /prøv igen/i }));

    await waitFor(() =>
      expect(screen.queryByText(/kunne ikke indlæse/i)).toBeNull(),
    );
    // Beviset på at det var en *ny* hentning, ikke en lokalt slettet fejl:
    // kunden er stadig i feltet, og et kald mere er gået ud.
    expect(screen.getByRole("option", { name: /kunde a/i })).toBeDefined();
  });

  it("AddMatcherForm: et signal kan ikke bindes til en kunde, hvis listen ikke kom", async () => {
    svar(["list_projects", "list_clients"], {});

    render(<AddMatcherForm />);

    await waitFor(() =>
      expect(
        screen.getByText(/kunne ikke indlæse projekter og kunder/i),
      ).toBeDefined(),
    );
    // Den gamle kode skrev «Intet projekt» og «Ingen kunde» i de to felter —
    // altså at brugeren hverken har projekter eller kunder.
    expect(screen.queryByText(/kunne ikke finde nogen projekter/i)).toBeNull();
  });

  it("en kunde uden projekt er stadig et valg, når kun kunderne kom", async () => {
    // Bevogter på den anden halvdel af rettelsen: fejltilstanden må ikke blive
    // en ny måde at skjule kunder på. Med data skal intet fejles.
    svar([], { list_projects: [], list_clients: [KUNDE] });

    render(<AddMatcherForm />);

    await waitFor(() =>
      expect(screen.getByRole("option", { name: /kunde a/i })).toBeDefined(),
    );
    expect(screen.queryByText(/kunne ikke indlæse/i)).toBeNull();
  });
});
