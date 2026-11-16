import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { DEFAULT_POMODORO_CONFIG } from "@/lib/pomodoro";
import { usePomodoroStore } from "@/stores/pomodoroStore";
import { PomodoroTimer } from "../PomodoroTimer";

/** Uret i millisekunder, som testen kan flytte. */
let nu = new Date(2026, 9, 1, 9, 0).getTime();

function konfiguration(overrides: Record<string, unknown> = {}) {
  return {
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 15,
    sessions_before_long: 4,
    ...overrides,
  };
}

let gemt: Record<string, unknown> = konfiguration();
let stats: Record<string, unknown> = {
  i_dag: { day: "2026-10-01", sessions: 1, minutes: 25 },
  dage: [],
  minutter_i_dag: 25,
};
let clients: { id: string; name: string; company: string | null }[] = [
  { id: "c1", name: "Kunde A", company: null },
];

/** `create_time_entry` kalder, som komponenten sendte dem. */
function oprettelser() {
  return invoke.mock.calls.filter(([cmd]) => cmd === "create_time_entry");
}

/**
 * Store'en er et modul-singleton, så state fra forrige test ellers lækker ind i
 * næste: en efterladt pause fik startknappen til at hedde «Pause», og den
 * næste «pomodoro» ville så være en pause, der udløber — altså ingen fase at
 * registrere. Det samme gælder de modulrige variabler `slutterOm` og
 * `igangværendeFaseId`, som en afsluttet fase nulstiller.
 */
function nulstil() {
  usePomodoroStore.setState({
    mode: "idle",
    timeRemaining: 0,
    sessionsCompleted: 0,
    isRunning: false,
    config: DEFAULT_POMODORO_CONFIG,
    netopSkiftet: false,
    stats: null,
    statsFejl: null,
    statsDag: null,
    klarFase: null,
    registrerer: false,
    faseFejl: false,
  });
}

beforeEach(() => {
  nu = new Date(2026, 9, 1, 9, 0).getTime();
  gemt = konfiguration();
  stats = {
    i_dag: { day: "2026-10-01", sessions: 1, minutes: 25 },
    dage: [],
    minutter_i_dag: 25,
  };
  clients = [{ id: "c1", name: "Kunde A", company: null }];
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_pomodoro_config") return gemt;
    if (cmd === "get_pomodoro_stats") return stats;
    if (cmd === "list_clients") return clients;
    return null;
  });
  vi.useFakeTimers({ now: nu });
  vi.setSystemTime(nu);
  nulstil();
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Starter en arbejdsfase og lader den udløbe. */
async function gennemfoerPomodoro() {
  fireEvent.click(screen.getByRole("button", { name: /^start/i }));
  await act(async () => {
    vi.advanceTimersByTime(25 * 60_000);
  });
}

/** Vælger kunden i tilbuddet og trykker gem. */
async function registrer() {
  fireEvent.change(screen.getByLabelText("Klient"), {
    target: { value: "c1" },
  });
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /registrér som tid/i }));
  });
}

describe("Pomodoroens tid kan registreres", () => {
  it("tilbyder ingen registrering før en fase er afsluttet", () => {
    render(<PomodoroTimer />);
    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
  });

  it("tilbyder at registrere tiden efter en gennemført pomodoro", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();

    expect(screen.getByTestId("pomodoro-fase")).toBeTruthy();
    expect(screen.getByText(/25m/)).toBeTruthy();
  });

  it("tilbyder det ikke efter en fase brugeren sprang over", async () => {
    // En fase på ti sekunder er ikke pomodoros tid. Uden denne skeln kunne en
    // bruger, der afbrød hver fase, få tilbud om at bogføre ingenting.
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /^start/i }));
    await act(async () => {
      vi.advanceTimersByTime(10_000);
    });
    fireEvent.click(screen.getByRole("button", { name: /spring over/i }));

    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
  });

  it("skriver de 25 minutter som ÉN tidsregistrering for den valgte kunde", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();
    await registrer();

    const kald = oprettelser();
    expect(kald).toHaveLength(1);
    const { input } = kald[0][1] as { input: Record<string, unknown> };
    expect(input.client_id).toBe("c1");
    expect(input.duration).toBe(25 * 60);
    // Lokale væg-tider, ikke UTC: 09:00 → 09:25.
    expect(input.start_time).toBe("2026-10-01T09:00:00");
    expect(input.end_time).toBe("2026-10-01T09:25:00");
  });

  it("fjerner tilbuddet, når tiden er registreret", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();
    await registrer();

    // Ellers kunne den samme pomodoro bogføres igen senere, og ingen af de to
    // registreringer kan slettes fra UI'et.
    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
    expect(oprettelser()).toHaveLength(1);
  });

  it("læser ikke dobbelt op på samme pomodoro ved et dobbeltklik", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();

    // Uden låsen skrev to `create_time_entry` med hver sin nye uuid, og
    // rapporterne viste den samme halve time to gange.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Klient"), {
        target: { value: "c1" },
      });
      const knap = screen.getByRole("button", { name: /registrér som tid/i });
      fireEvent.click(knap);
      fireEvent.click(knap);
      fireEvent.click(knap);
    });

    expect(oprettelser()).toHaveLength(1);
  });

  it("beholder tilbuddet og siger at tiden ikke blev registreret, når skrivningen fejler", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "list_clients") return clients;
      if (cmd === "create_time_entry") throw new Error("låst database");
      return null;
    });
    await registrer();

    // Tilbuddet bliver stående, så «prøv igen» bogfører præcis det samme
    // minut — og skærmen må ikke sige «kunne ikke hente», for det er
    // skrivningen der fejlede.
    expect(screen.getByTestId("pomodoro-fase")).toBeTruthy();
    expect(screen.getByTestId("pomodoro-fase-fejl").textContent).toContain(
      "blev ikke registreret",
    );
  });

  it("lader en vellykket skrivning efter en fejl fjerne tilbuddet", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();

    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "list_clients") return clients;
      if (cmd === "create_time_entry") throw new Error("låst database");
      return null;
    });
    await registrer();
    expect(screen.getByTestId("pomodoro-fase")).toBeTruthy();

    // Databasen bliver ledig igen, og «prøv igen» skriver præcis en gang.
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "list_clients") return clients;
      return null;
    });
    await registrer();

    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
    expect(oprettelser()).toHaveLength(2);
  });

  it("viser hvilken dag en gammel fase lå, så den ikke ligner dagens", async () => {
    // `klarFase` overlever et døgnskifte. Uden datoen stod gårsdags pomodoro
    // som «Du arbejdede i 25m kl. 09:00» og lignede dagens, selv om
    // registreringen skrives på den dag perioden faktisk lå.
    // Sæt **før** render: en `setState` efter mount tegner ikke uden `act`, og
    // testen ville så dømme et kort der aldrig blev vist.
    usePomodoroStore.setState({
      klarFase: {
        id: "fase-1",
        start: "2026-09-30T09:00:00",
        slut: "2026-09-30T09:25:00",
        varighed: 1500,
      },
    });
    render(<PomodoroTimer />);

    const påstand = screen.getByTestId("pomodoro-fase").textContent ?? "";
    expect(påstand).toContain("30. sep");
    // Klokkeslættet alene er ikke nok: 09:00 i går ser identisk ud som 09:00
    // i dag, så det er datoen der skelner.
    expect(påstand).not.toContain("kl. 09:00 – registrer");
  });

  it("kræver en kunde, før den skriver noget", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    await gennemfoerPomodoro();

    // Knappen er død uden kunde: uden en kunde er tiden ikke fakturerbar, og
    // en stribel af sådanne registreringer er værre end ingen.
    const knap = screen.getByRole("button", { name: /registrér som tid/i });
    expect(knap.hasAttribute("disabled")).toBe(true);
    expect(oprettelser()).toHaveLength(0);
  });

  it("viser klientlisten, men skriver ikke, når den ikke kan hentes", async () => {
    render(<PomodoroTimer />);
    await act(async () => {
      await Promise.resolve();
    });
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "list_clients") throw new Error("låst database");
      return null;
    });
    await gennemfoerPomodoro();

    // «Ingen klienter endnu» er en påstand om brugerens data, og den er ikke
    // længere sand — så feltet siger det neutrale og fejlen står over det.
    expect(screen.getByRole("alert").textContent).toContain("kunder");
    expect(oprettelser()).toHaveLength(0);
  });

  it("skriver i alle fem sprog", async () => {
    for (const sprogKode of ["da", "sv", "nb", "de", "en"]) {
      cleanup();
      nulstil();
      await act(async () => {
        await i18n.changeLanguage(sprogKode);
      });

      render(<PomodoroTimer />);
      await act(async () => {
        await Promise.resolve();
      });
      await gennemfoerPomodoro();

      // Nøglen skal være oversat, ikke blot findes: `t()` giver nøglen tilbage
      // for en tekst den ikke kender, og det er præcis den løgn K40 fandt.
      const etiket = i18n.t("pomodoro.faseSave");
      expect(etiket).not.toBe("pomodoro.faseSave");
      expect(screen.getByRole("button", { name: etiket })).toBeTruthy();

      const påstand = i18n.t("pomodoro.faseLabel", { time: "25m" });
      expect(påstand).toContain("25m");
      expect(påstand).not.toContain("pomodoro.faseLabel");
    }
    await act(async () => {
      await i18n.changeLanguage("da");
    });
  });
});
describe("pomodoroStore.registrerFase uden om UI'et", () => {
  beforeEach(() => {
    nu = new Date(2026, 9, 1, 9, 0).getTime();
    invoke.mockReset();
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return konfiguration();
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "list_clients") return clients;
      return null;
    });
    vi.useFakeTimers({ now: nu });
    vi.setSystemTime(nu);
    nulstil();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skriver ikke en kunde som en tom streng", async () => {
    // Knappen er død uden kunde, så dette kan ikke nås fra klik — men et
    // tastaturkald eller en fremtidig genvej kan. `client_id = ''` er ikke
    // NULL, så den joiner til ingen kunde og hverken synken eller rapporten kan
    // skelne den fra en rigtig.
    usePomodoroStore.setState({
      klarFase: {
        id: "fase-2",
        start: "2026-10-01T09:00:00",
        slut: "2026-10-01T09:25:00",
        varighed: 1500,
      },
    });
    await act(async () => {
      await usePomodoroStore.getState().registrerFase("");
    });

    expect(oprettelser()).toHaveLength(0);
    // Tilbuddet står, så brugeren kan vælge en kunde og prøve igen.
    expect(usePomodoroStore.getState().klarFase).not.toBeNull();
  });

  it("skriver fasens id med, så tidslinjen kan se at den er bogført", async () => {
    // Registreringen skal kunne sige **hvilken** fase den er lavet af. Uden id'et
    // står fasen i dagens tidslinje bagefter stadig som en pomodoro uden at
    // vide at dens 25 minutter også står i ugeoversigten, og da rækken er
    // bevidst ubeklikkelig er der ingen anden sted at finde ud af det.
    usePomodoroStore.setState({
      klarFase: {
        id: "fase-3",
        start: "2026-10-01T09:00:00",
        slut: "2026-10-01T09:25:00",
        varighed: 1500,
      },
    });
    await act(async () => {
      await usePomodoroStore.getState().registrerFase("c1");
    });

    expect(oprettelser()).toHaveLength(1);
    const input = (oprettelser()[0][1] as { input: Record<string, unknown> })
      .input;
    expect(input.pomodoro_session_id).toBe("fase-3");
  });
});
