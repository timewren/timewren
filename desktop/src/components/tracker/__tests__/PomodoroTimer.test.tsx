import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
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
let nu = new Date(2026, 8, 30, 9, 0).getTime();

function konfiguration(overrides: Record<string, unknown> = {}) {
  return {
    work_minutes: 25,
    short_break_minutes: 5,
    long_break_minutes: 15,
    sessions_before_long: 4,
    ...overrides,
  };
}

/** Gemt konfiguration, som `get_pomodoro_config` svarer med. */
let gemt: Record<string, unknown> = konfiguration();

/** Det `get_pomodoro_stats` svarer med. */
let stats: Record<string, unknown> = {
  i_dag: { day: "2026-09-30", sessions: 0, minutes: 0 },
  dage: [],
  minutter_i_dag: 0,
};

beforeEach(() => {
  nu = new Date(2026, 8, 30, 9, 0).getTime();
  gemt = konfiguration();
  stats = {
    i_dag: { day: "2026-09-30", sessions: 0, minutes: 0 },
    dage: [],
    minutter_i_dag: 0,
  };
  invoke.mockReset();
  invoke.mockImplementation(async (cmd: string) => {
    if (cmd === "get_pomodoro_config") return gemt;
    if (cmd === "get_pomodoro_stats") return stats;
    // Appen spørger om kunderne, når en pomodoro er afsluttet og den tilbyder
    // at registrere tiden. Mocken skal svare på det appen spørger — et `null`
    // for et ubekendt kommando gav en klientliste på `null`, altså en
    // fejltilstand der lignede en længere-kommende-fejl.
    if (cmd === "list_clients") return [];
    return null;
  });
  vi.useFakeTimers({ now: nu });
  vi.setSystemTime(nu);

  // Store'en er et modul-singleton, så state fra forrige test ellers lækkede
  // ind i næste: en efterladt pause fik startknappen til at hedde "Pause",
  // og testen fandt ingen knap at trykke på. Dagscounteren nulstilles også —
  // ellers lækkede dagens pomodoros fra en test til den næste.
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
  });
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

/** Urets tekst. Repoet bruger ikke jest-dom, så assertions på indhold
 *  sammenligner `textContent` direkte. */
function ur() {
  return screen.getByRole("timer").textContent;
}

describe("PomodoroTimer", () => {
  it("viser den konfigurerede arbejdstid, før timeren er startet", () => {
    render(<PomodoroTimer />);
    // Ved indlæsning står der 25:00 fra den gemte konfiguration, ikke 00:00.
    expect(ur()).toBe("25:00");
  });

  it("tæller ned, og løber over i den næste fase", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(ur()).toBe("24:00"));

    // 25 minutter senere er arbejdsfasen slut, og pausen står parat.
    vi.advanceTimersByTime(24 * 60_000);
    await vi.waitFor(() => expect(screen.getByText("Kort pause")).toBeTruthy());
  });

  it("tæller ned fra klokkeslættet, så en forsinket fane ikke gør timeren langsommere", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    // Ét tik, men 90 sekunder er gået: en skjult fade tikker sjældnere.
    vi.advanceTimersByTime(90_000);
    await vi.waitFor(() => expect(ur()).toBe("23:30"));
  });

  it("standser på pause og fortsætter derfra", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(ur()).toBe("24:30"));

    fireEvent.click(screen.getByRole("button", { name: /pause/i }));

    // Tiden står stille, selvom der tikker videre.
    vi.advanceTimersByTime(60_000);
    expect(ur()).toBe("24:30");

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(ur()).toBe("24:00"));
  });

  it("sender en notifikation ved fase-skiftet", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "notify",
        expect.objectContaining({ body: "Tid til en kort pause." }),
      ),
    );
  });

  it("giver den lange pause efter fire sessioner", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    // Spring over fire gange: fire korte pauser, og så den lange.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole("button", { name: /start/i }));
      fireEvent.click(screen.getByRole("button", { name: /spring over/i }));
      fireEvent.click(screen.getByRole("button", { name: /start/i }));
      fireEvent.click(screen.getByRole("button", { name: /spring over/i }));
    }
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    fireEvent.click(screen.getByRole("button", { name: /spring over/i }));

    expect(screen.getByText("Lang pause")).toBeTruthy();
  });

  it("gemmer en ændret konfiguration med gyldige tal", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /pomodoro-indstillinger/i }),
    );
    const felt = screen.getByLabelText("Arbejdstid (min)");
    fireEvent.change(felt, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("set_pomodoro_config", {
        config: konfiguration({ work_minutes: 40 }),
      }),
    );
  });

  it("gemmer aldrig 0 minutter, selv om feltet er tømt", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /pomodoro-indstillinger/i }),
    );
    // Number("") er 0, som ville give en fase på nul sekunder.
    fireEvent.change(screen.getByLabelText("Kort pause (min)"), {
      target: { value: "" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Gem" }));

    // Feltet var tomt, så den rettede værdi er den, der allerede stod der:
    // der skrives intet, og slet ikke en pause på nul minutter.
    expect(invoke).not.toHaveBeenCalledWith(
      "set_pomodoro_config",
      expect.objectContaining({
        config: expect.objectContaining({ short_break_minutes: 0 }),
      }),
    );

    // Vinduet kan åbnes igen med den gyldige værdi.
    fireEvent.click(
      screen.getByRole("button", { name: /pomodoro-indstillinger/i }),
    );
    expect(screen.getByLabelText("Kort pause (min)")).toHaveProperty(
      "value",
      "5",
    );
  });

  it("læser en gemt konfiguration med 0 minutter som standard, ikke som en nul-fase", async () => {
    // En konfiguration fra en tidligere fejlende version må ikke give en
    // pomodoro, der er færdig samme sekund den starter.
    gemt = konfiguration({ work_minutes: 0, short_break_minutes: 0 });

    render(<PomodoroTimer />);
    await vi.waitFor(() => expect(ur()).toBe("25:00"));
  });

  it("overlever en kasseret gemt konfiguration", async () => {
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return { work_minutes: "ikke et tal" };
      return null;
    });

    render(<PomodoroTimer />);
    await vi.waitFor(() => expect(ur()).toBe("25:00"));
  });

  it("kan nulstilles", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(ur()).toBe("24:30"));

    fireEvent.click(screen.getByRole("button", { name: /nulstil/i }));
    expect(ur()).toBe("25:00");
    expect(screen.queryByText(/Runde/)).toBeNull();
  });
});

describe("Pomodoro-tælleren for dagen", () => {
  it("viser dagens pomodoros, selv om timeren ikke har kørt", async () => {
    // Tallet kommer fra databasen, så en pomodoro fra i går formiddag står
    // stadig, når brugeren åbner appen efter frokost. Før denne viste UI'et
    // intet, og tallet lå i en store der døde med appen.
    stats = {
      i_dag: { day: "2026-09-30", sessions: 3, minutes: 75 },
      dage: [{ day: "2026-09-30", sessions: 3, minutes: 75 }],
      minutter_i_dag: 75,
    };

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("3 pomodoros i dag")).toBeTruthy(),
    );
  });

  it("siger nul tydeligt, når dagen ingen pomodoros har", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("Ingen pomodoros i dag endnu")).toBeTruthy(),
    );
    // «Ingen pomodoros i dag endnu» er en * konstatering af dagen. Den må
    // ikke kunne læses som «vi ved det ikke», for det er der en egen
    // tilstand til.
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("tæller en gennemført arbejdsfase, når den udløber", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "record_pomodoro_session",
        expect.objectContaining({ minutes: 25 }),
      ),
    );
  });

  it("giver to ægte pomodoros to forskellige id'er", async () => {
    // Modsat fejl af den id-delerne lukker: hvis alle faser fik SAMME id,
    // ville `INSERT OR IGNORE` slette den anden pomodoro, og brugeren ville
    // miste en hel session i dagens tal. Så hver udløbet fase skal have sit
    // eget id.
    //
    // Faserne er sat til 1 minut. Testen dømmer fase-skiftet og id'et, ikke
    // længden, og en 25-minutters fase er 1500 tikker — den gjorde denne test
    // så langsom at den alene fik hele filen til at time ud i den fulde kørsel.
    gemt = konfiguration({ work_minutes: 1, short_break_minutes: 1 });

    render(<PomodoroTimer />);
    // Vent på at konfigurationen er **lagret i store'en**, ikke bare at
    // kommandoen er kaldt. `get_pomodoro_config` er asynkron, så et klik
    // med det samme ville skærf i den gamle 25-minutters fase — og testen
    // ville så tælle faser, der aldrig sluttede.
    await vi.waitFor(() =>
      expect(usePomodoroStore.getState().config.work_minutes).toBe(1),
    );

    /** Starter den fase der er aktiv. Knappen skal slås op igen for hver
     *  fase: React gengenerer ikke bare efter `advanceTimersByTime`, så et
     *  knappe-element fra den forrige fase ville kaldt den gamle `onClick` —
     *  `pause` i stedet for `start`, og testen ville så måle ingenting.
     *
     * State aflæses **synkront** og ikke med `waitFor`: med falske timere
     * skrider `waitFor` selv tiden frem, så en fase på ét minut var slidt op,
     * mens den ventede på at `isRunning` blev sand. */
    function startAktivFase() {
      fireEvent.click(screen.getByRole("button", { name: /^(start|pause)$/i }));
      expect(usePomodoroStore.getState().isRunning).toBe(true);
    }

    // Arbejde → pause → arbejde. To records kræver to *arbejds*faser; den
    // midterste tæller ikke med, og det er præcis det, nabo-testen dømmer.
    for (let i = 0; i < 3; i++) {
      await startAktivFase();
      await vi.advanceTimersByTimeAsync(60_000);
    }

    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "record_pomodoro_session"),
      ).toHaveLength(2),
    );

    const faseId = invoke.mock.calls
      .filter(([cmd]) => cmd === "record_pomodoro_session")
      .map(([, args]) => (args as { id: string }).id);

    for (const id of faseId) {
      expect(id).toEqual(expect.any(String));
      expect(id.length).toBeGreaterThan(0);
    }
    expect(faseId[0]).not.toBe(faseId[1]);
  });

  it("skriver ikke en pause som om den var arbejde", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    // Arbejdsfase → pause (udløber, skriver én).
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "record_pomodoro_session",
        expect.anything(),
      ),
    );

    // Pausen skal køre ud, før den regnes som arbejde igen. Uden dette skrev
    // hver pause dagens tal, og en cyklus på fire sessioner gav otte.
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(5 * 60_000);
    await vi.waitFor(() => expect(screen.getByText("Arbejde")).toBeTruthy());

    const kald = invoke.mock.calls.filter(
      ([cmd]) => cmd === "record_pomodoro_session",
    );
    expect(kald).toHaveLength(1);
  });

  it("springer over tæller ikke, for brugeren arbejdede ikke", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(10_000);
    fireEvent.click(screen.getByRole("button", { name: /spring over/i }));

    // Ti sekunders arbejde er ikke en pomodoro. Uden dette viste dagen «1
    // pomodoro i dag» for en fase brugeren afbrød efter ti sekunder, og det
    // er præcis den slags tallet, der gør en tæller ubrugelig.
    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === "record_pomodoro_session"),
    ).toHaveLength(0);
  });

  it("nulstilling afbryder den igangværende fase med at tælle den", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(10_000);
    fireEvent.click(screen.getByRole("button", { name: /nulstil/i }));

    // Ny arbejdsfase, der så udløber. Den har sit eget id, så den gamle,
    // afbrudte fase ikke kan tælles med på vejen.
    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);

    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        "record_pomodoro_session",
        expect.anything(),
      ),
    );
    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === "record_pomodoro_session"),
    ).toHaveLength(1);
  });

  it("siger at tallet ikke kunne hentes, i stedet for at vise nul", async () => {
    // En låst database. Uden en fejltilstand viste skærmen «Ingen pomodoros i
    // dag endnu» — altså at brugeren ikke har arbejdet, når det er sandheden at
    // vi ikke kunne læse det. Samme løgn som K48a lukkede for listerne.
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") throw new Error("låst");
      return null;
    });

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(
        screen.getByText("Kunne ikke hente dagens pomodoros"),
      ).toBeTruthy(),
    );
    expect(screen.queryByText("Ingen pomodoros i dag endnu")).toBeNull();

    // Og der er en vej til at prøve igen — på 44 px, som resten af appen.
    // Scopet til dagens tals fejl: kortet har to `role="alert"` nu, fordi en
    // afsluttet pomodoro også tilbyder at registrere sin tid.
    const prøv = within(screen.getByTestId("pomodoro-stats-fejl")).getByRole(
      "button",
      { name: /prøv igen/i },
    );
    expect(prøv).toBeTruthy();
    expect(prøv.className).toContain("min-h-11");
  });

  it("genindlæser tallet efter en gennemført fase", async () => {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_stats", { dage: 7 }),
    );
    const før = invoke.mock.calls.filter(
      ([cmd]) => cmd === "get_pomodoro_stats",
    ).length;

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);

    // Uden genindlæsningen stod skærmen med tallet fra før timeren startede,
    // altså en pomodoro kortere end den var.
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "get_pomodoro_stats")
          .length,
      ).toBeGreaterThan(før),
    );
  });

  it("viser dagens tal i alle fem sprog", async () => {
    stats = {
      i_dag: { day: "2026-09-30", sessions: 2, minutes: 50 },
      dage: [{ day: "2026-09-30", sessions: 2, minutes: 50 }],
      minutter_i_dag: 50,
    };

    for (const [sprog, forventet] of [
      ["da", "2 pomodoros i dag"],
      ["en", "2 pomodoros today"],
      ["sv", "2 pomodoros i dag"],
      ["nb", "2 pomodoros i dag"],
      ["de", "2 Pomodoros heute"],
    ] as const) {
      i18n.changeLanguage(sprog);
      const { unmount } = render(<PomodoroTimer />);
      await vi.waitFor(() => expect(screen.getByText(forventet)).toBeTruthy());
      unmount();
    }
    i18n.changeLanguage("da");
  });

  it("viser uge-striben under tælleren, når der er pomodoros at se", async () => {
    stats = {
      i_dag: { day: "2026-09-30", sessions: 2, minutes: 50 },
      dage: [
        { day: "2026-09-30", sessions: 2, minutes: 50 },
        { day: "2026-09-29", sessions: 1, minutes: 25 },
      ],
      minutter_i_dag: 50,
    };

    render(<PomodoroTimer />);

    // Dagens linje og striben kommer fra samme `loadStats`, så den første er
    // og også garantien for at den anden er tegnet.
    await vi.waitFor(() =>
      expect(screen.getByText("2 pomodoros i dag")).toBeTruthy(),
    );

    // Striben skal være monteret på dashboardet, ikke ligge i et lib som
    // ingen kalder. Syv kolonner under «2 pomodoros i dag».
    const stribe = screen.getByRole("list", { name: /seneste uge/i });
    expect(
      within(stribe)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining("ingen pomodoro"), // 24/9
      expect.stringContaining("ingen pomodoro"), // 25/9
      expect.stringContaining("ingen pomodoro"), // 26/9
      expect.stringContaining("ingen pomodoro"), // 27/9
      expect.stringContaining("ingen pomodoro"), // 28/9
      expect.stringContaining("1 pomodoro"), // 29/9
      expect.stringContaining("2 pomodoros"), // 30/9
    ]);
  });

  it("tegner ingen striben på en dag uden pomodoros", async () => {
    stats = {
      i_dag: { day: "2026-09-30", sessions: 0, minutes: 0 },
      dage: [],
      minutter_i_dag: 0,
    };

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("Ingen pomodoros i dag endnu")).toBeTruthy(),
    );

    // Syv tomme søjler forteller intet. Uden tjekket lå der en tom boks under
    // timeren for enhver bruger, der endnu ikke har gennemført en pomodoro.
    expect(screen.queryByRole("list", { name: /seneste uge/i })).toBeNull();
  });

  it("viser ikke gårsdags tal som dagens over et døgnskifte", async () => {
    // `get_pomodoro_stats` læser `day <= idag`, så et svar fra i går rummer
    // både gårsdags række og dagens. Viser UI'et «3 pomodoros i dag» oven over
    // et gammelt svar, står gårsdags tal som dagens — og brugeren kan ikke se
    // det, for tallet ligner en sandfærdighed. I det øjeblik dagen er skredt
    // og den nye indlæsning endnu ikke er kommet, skal skærmen derfor vise
    // **intet** frem for gårsdags tal.
    let kalder = 0;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") {
        kalder += 1;
        // Den anden hentning står i luften: den er grunden til at hullet
        // findes, og en test der lader den svare med det samme ville aldrig
        // ramme det.
        if (kalder > 1) return new Promise(() => {});
        return {
          i_dag: { day: "2026-09-30", sessions: 3, minutes: 75 },
          dage: [{ day: "2026-09-30", sessions: 3, minutes: 75 }],
          minutter_i_dag: 75,
        };
      }
      return null;
    });

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("3 pomodoros i dag")).toBeTruthy(),
    );

    vi.setSystemTime(new Date(2026, 9, 1, 0, 5));
    // `act` er ikke kosmetik: dagen holdes i state, og en tilstandsupdatering
    // fra et interval-callback udenfor `act` tegner ikke, før noget andant
    // udløser en tegning — så porten ville dømme den gamle DOM.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });

    // Uden `statsErIdag` stod «3 pomodoros i dag» videre — gårsdags række.
    // Og «Ingen pomodoros i dag endnu» må heller ikke stå: det er sand for
    // 1/10, men kun fordi vi har hentet det.
    expect(screen.queryByText("3 pomodoros i dag")).toBeNull();
    expect(screen.queryByText("Ingen pomodoros i dag endnu")).toBeNull();
  });

  it("henter tallet igen over et døgnskifte, uden at brugeren gør noget", async () => {
    stats = {
      i_dag: { day: "2026-09-30", sessions: 3, minutes: 75 },
      dage: [{ day: "2026-09-30", sessions: 3, minutes: 75 }],
      minutter_i_dag: 75,
    };

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("3 pomodoros i dag")).toBeTruthy(),
    );
    const før = invoke.mock.calls.filter(
      ([cmd]) => cmd === "get_pomodoro_stats",
    ).length;

    // Midnat passerer, og den nye dags rækker ligger i databasen.
    stats = {
      i_dag: { day: "2026-10-01", sessions: 1, minutes: 25 },
      dage: [
        { day: "2026-09-30", sessions: 3, minutes: 75 },
        { day: "2026-10-01", sessions: 1, minutes: 25 },
      ],
      minutter_i_dag: 25,
    };
    vi.setSystemTime(new Date(2026, 9, 1, 0, 5));
    // Ét minutsinterval — den rigtige holder et minut, så en sovnende maskine
    // fanger skiftet inden for et minut uden et kæmpeligt timeout.
    await vi.advanceTimersByTimeAsync(60_000);

    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "get_pomodoro_stats")
          .length,
      ).toBeGreaterThan(før),
    );
    await vi.waitFor(() =>
      expect(screen.getByText("1 pomodoro i dag")).toBeTruthy(),
    );
    // Og stribens dagens kolonne er den nye — 25/9–1/10, ikke 24/9–30/9.
    expect(
      within(screen.getByRole("list", { name: /seneste uge/i }))
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([
      expect.stringContaining("ingen pomodoro"), // 25/9
      expect.stringContaining("ingen pomodoro"), // 26/9
      expect.stringContaining("ingen pomodoro"), // 27/9
      expect.stringContaining("ingen pomodoro"), // 28/9
      expect.stringContaining("ingen pomodoro"), // 29/9
      expect.stringContaining("3 pomodoros"), // 30/9
      expect.stringContaining("1 pomodoro"), // 1/10 — dagens kolonne
    ]);
    // Syv kolonner, og **én** af dem er markeret som i dag.
    const markerede = within(screen.getByRole("list", { name: /seneste uge/i }))
      .getAllByRole("listitem")
      .filter((li) => li.getAttribute("aria-current"));
    expect(markerede).toHaveLength(1);
    expect(markerede[0].textContent).toContain("1 pomodoro");
  });

  it("henter ikke igen hvert minut på en dag der ikke er skredt", async () => {
    // Uret tikker hvert minut hele dagen. Uden `genindlæsHvisNyDag`s tjek
    // skrev appen til databasen 1440 gange om dagen for at læse det samme
    // tal — på en bærbar på batteri.
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "get_pomodoro_stats"),
      ).toHaveLength(1),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10 * 60_000);
    });

    expect(
      invoke.mock.calls.filter(([cmd]) => cmd === "get_pomodoro_stats"),
    ).toHaveLength(1);
  });

  it("henter igen når vinduet bliver synligt efter en lukket bærbar", async () => {
    // En bærbar der lå lukket over natten får ingen `setInterval`-tik, så uden
    // `visibilitychange` ville dagens tal være fra i går hele formiddagen.
    stats = {
      i_dag: { day: "2026-09-30", sessions: 3, minutes: 75 },
      dage: [{ day: "2026-09-30", sessions: 3, minutes: 75 }],
      minutter_i_dag: 75,
    };

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("3 pomodoros i dag")).toBeTruthy(),
    );
    const før = invoke.mock.calls.filter(
      ([cmd]) => cmd === "get_pomodoro_stats",
    ).length;

    stats = {
      i_dag: { day: "2026-10-01", sessions: 2, minutes: 50 },
      dage: [
        { day: "2026-09-30", sessions: 3, minutes: 75 },
        { day: "2026-10-01", sessions: 2, minutes: 50 },
      ],
      minutter_i_dag: 50,
    };
    vi.setSystemTime(new Date(2026, 9, 1, 9, 0));
    setTimeout(() => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: "visible",
      });
      document.dispatchEvent(new Event("visibilitychange"));
    }, 0);
    await vi.advanceTimersByTimeAsync(10);

    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "get_pomodoro_stats")
          .length,
      ).toBeGreaterThan(før),
    );
    await vi.waitFor(() =>
      expect(screen.getByText("2 pomodoros i dag")).toBeTruthy(),
    );
  });

  it("siger at pomodoroen ikke blev talt, når skrivningen fejlede", async () => {
    // Fund fra reviewet: efter en skrivningsfejl sagde skærmbilledet
    // «Kunne ikke hente dagens pomodoros» — altså at *hentningen* fejlede,
    // mens det var skrivningen der gjorde. Det er en anden fejl med en anden
    // følge: tallet er ikke ukendt, det er for lavt, fordi denne pomodoro ikke
    // blev skrevet.
    invoke.mockImplementation(async (cmd: string, args?: unknown) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") return stats;
      if (cmd === "record_pomodoro_session") {
        if ((args as { id?: string })?.id) throw new Error("skrivefejl");
        return null;
      }
      return null;
    });

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(screen.getByText("Ingen pomodoros i dag endnu")).toBeTruthy(),
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));
    vi.advanceTimersByTime(25 * 60_000);

    await vi.waitFor(() =>
      expect(screen.getByText("Pomodoroen blev ikke talt")).toBeTruthy(),
    );
    // Og **ingen** «prøv igen»: genindlæsningen ville hente det samme tal igen,
    // for tallet i databasen er korrekt — det er skrivningen der fejlede.
    //
    // Krogen er nødvendig: kortet har nu **to** fejltilstande, fordi en
    // afsluttet pomodoro også tilbyder at registrere sin tid, og den henter
    // kunderne. Uden scoping ville testen finde den andens «prøv igen».
    const statsFejl = within(screen.getByTestId("pomodoro-stats-fejl"));
    expect(statsFejl.queryByRole("button", { name: /prøv igen/i })).toBeNull();
  });

  it("beholder «prøv igen» når det er hentningen der fejlede", async () => {
    // Modsat af forrige: her er tallet ukendt, og at hente igen er præcis
    // det der hjælper. De to fejl må derfor ikke se ens ud.
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "get_pomodoro_config") return gemt;
      if (cmd === "get_pomodoro_stats") throw new Error("låst");
      return null;
    });

    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(
        screen.getByText("Kunne ikke hente dagens pomodoros"),
      ).toBeTruthy(),
    );

    // Scopet til dagens tals fejl — se kommentaren i testen ovenfor.
    expect(
      within(screen.getByTestId("pomodoro-stats-fejl")).getByRole("button", {
        name: /prøv igen/i,
      }),
    ).toBeTruthy();
  });
});

describe("PomodoroTimer — genvejen p", () => {
  /** De to sidste linjer i testfilens `beforeEach` gør nødvendigt, at hver
   *  test her venter på konfigurationen, før den trykker — ellers starter `p`
   *  med standardkonfigurationen og ur-visningen er ikke et bevis. */
  async function klar() {
    render(<PomodoroTimer />);
    await vi.waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("get_pomodoro_config", undefined),
    );
  }

  it("starter pomodoroen med p", async () => {
    await klar();

    fireEvent.keyDown(document.body, { key: "p" });

    // Beviset er uret, ikke en intern: `p` skal gøre præcis det knappen gør.
    await vi.waitFor(() => expect(ur()).toBe("25:00"));
    vi.advanceTimersByTime(60_000);
    await vi.waitFor(() => expect(ur()).toBe("24:00"));
    expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy();
  });

  it("sætter den på pause igen med p, og fortsætter derfra", async () => {
    await klar();

    fireEvent.keyDown(document.body, { key: "p" });
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(ur()).toBe("24:30"));

    fireEvent.keyDown(document.body, { key: "p" });

    // Tiden står stille, selv om der tikker videre — ellers var `p` bare et
    // alias til `start` og pausen ville ikke finde sted.
    vi.advanceTimersByTime(60_000);
    expect(ur()).toBe("24:30");

    fireEvent.keyDown(document.body, { key: "p" });
    vi.advanceTimersByTime(30_000);
    await vi.waitFor(() => expect(ur()).toBe("24:00"));
  });

  it("virker også med stor P, som et tastatur med Shift giver", async () => {
    await klar();

    fireEvent.keyDown(document.body, { key: "P", shiftKey: true });

    await vi.waitFor(() =>
      expect(screen.getByRole("button", { name: /pause/i })).toBeTruthy(),
    );
  });

  it("lader Ctrl+P være i fred — det er browserens egen print", async () => {
    await klar();

    fireEvent.keyDown(document.body, { key: "p", ctrlKey: true });

    // `preventDefault` ville ikke kunne mærkes her, så dømmer vi på det
    // brugbare resultat: uret tikker ikke, og der står stadig «Start».
    vi.advanceTimersByTime(60_000);
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("lader Alt+P være i fred — det er et menuvalg på Windows", async () => {
    await klar();

    fireEvent.keyDown(document.body, { key: "p", altKey: true });

    vi.advanceTimersByTime(60_000);
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
  });

  it("gør ingenting i et tekstfelt", async () => {
    await klar();

    // Et felt uden for timeren: væernet skal være på **tasten**, ikke kun på
    // at timeren selv har et felt — ellers ville en dialog over dashboardet
    // få sin egen «p»-skrivning til at starte en pomodoro.
    const felt = document.createElement("input");
    document.body.appendChild(felt);

    fireEvent.keyDown(felt, { key: "p" });

    vi.advanceTimersByTime(60_000);
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
    felt.remove();
  });

  it("gør ingenting når en dialog ligger åben over dashboardet", async () => {
    await klar();

    // «Ny registrering» kan åbnes fra dashboardet, og `PomodoroTimer` er
    // stadig monteret bagved. Genvejen skal ikke starte en pomodoro, brugeren
    // ikke kan se.
    const dialog = document.createElement("div");
    dialog.setAttribute("role", "dialog");
    document.body.appendChild(dialog);

    fireEvent.keyDown(document.body, { key: "p" });

    vi.advanceTimersByTime(60_000);
    expect(screen.getByRole("button", { name: /start/i })).toBeTruthy();
    dialog.remove();
  });

  it("gør ingeting mens indstillingspanelet står åbent", async () => {
    await klar();

    fireEvent.click(
      screen.getByRole("button", { name: /pomodoro-indstillinger/i }),
    );
    // Panelet er en `<section>`, ikke en dialog, så det skal have sit eget
    // værn — ellers ville `p` starte en pomodoro bagved det.
    fireEvent.keyDown(document.body, { key: "p" });

    // Dømt på store'ens state, ikke på skærmen: panelet står åbent både før
    // og efter en start, så «Gem er der» kan ikke se forskellen. Det var
    // grunden til at mutationen «værnet væk» var grøn.
    expect(usePomodoroStore.getState().isRunning).toBe(false);
    expect(usePomodoroStore.getState().mode).toBe("idle");
    expect(screen.getByRole("button", { name: "Gem" })).toBeTruthy();
  });

  it("viser nøglen, så genvejen kan findes uden at lede i hjælpen", async () => {
    await klar();

    expect(screen.getByText("Tastatur: p starter/slutter")).toBeTruthy();
  });
});
