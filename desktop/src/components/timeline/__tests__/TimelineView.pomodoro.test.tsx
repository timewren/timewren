import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";

const invoke = vi.fn();
const listen = vi.fn(async () => () => {});

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (...args: unknown[]) => listen(...(args as [])),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("@/lib/sentry", () => ({ captureError: vi.fn() }));

import type { Activity } from "@/lib/types";
import { TimelineView } from "../TimelineView";

/** Uret er låst, så dagens linje ikke driver med væggen. */
const CLOCK = new Date(2026, 8, 29, 9, 0);

function makeActivity(id: number): Activity {
  const time = String(8 + id).padStart(2, "0");
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
    started_at: `2026-09-29T${time}:00:00`,
    ended_at: `2026-09-29T${time}:30:00`,
    duration: 1800,
  };
}

/** Én gennemført fase, som `list_pomodoro_sessions` svarer med.
 *
 *  `day` er den dag fasen **tæller på** — den den afsluttede. Derfor er den
 *  parameter, ikke afledt af starten: en fase 23.45–00.10 hører til dagen efter
 *  midnat, præcis som `K61`s registrering skriver den. */
function makeFase(
  id: string,
  startedAt: string,
  endedAt: string,
  minutes = 25,
  day = endedAt.slice(0, 10),
  registreret = false,
) {
  return {
    id,
    day,
    minutes,
    started_at: startedAt,
    ended_at: endedAt,
    registreret,
  };
}

describe("TimelineView pomodoro-faser", () => {
  let activities: Activity[];
  /** Hvad `list_pomodoro_sessions` skal svare med, eller kaste. */
  let faserSvar: unknown;
  let faserFejler: boolean;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.setSystemTime(CLOCK);
    activities = [makeActivity(1)];
    faserSvar = undefined;
    faserFejler = false;
    invoke.mockReset();
    listen.mockClear();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(activities);
      if (cmd === "list_projects") return Promise.resolve([]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      if (cmd === "list_pomodoro_sessions") {
        return faserFejler
          ? Promise.reject(new Error("læsefejl"))
          : Promise.resolve(faserSvar);
      }
      return Promise.resolve(null);
    });
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  /** Piletasten skal gå gennem `fireEvent` som i de øvrige tidslinjetests: en
   *  rå `dispatchEvent` når ikke React's handler, så dagen aldrig skifter og
   *  testen passerer af den grund, at intet ændrede sig. */
  async function skiftDag(key: string) {
    await act(async () => {
      fireEvent.keyDown(document.body, { key });
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  async function renderTimeline() {
    render(<TimelineView />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }

  it("viser en gennemført fase i dagens linje med klokkeslæt og længde", async () => {
    faserSvar = [makeFase("p1", "2026-09-29T09:00:00", "2026-09-29T09:25:00")];
    await renderTimeline();

    const række = screen.getByTestId("pomodoro-fase");
    // Klokkeslættet er hele pointen: «2 pomodoros i dag» er et tal uden klokkeslæt,
    // og det er præcis det uge-striben ikke kan løse alene.
    expect(række.textContent).toContain("09:00");
    expect(række.textContent).toContain("09:25");
    expect(række.textContent).toContain("25m");
  });

  it("sætter fasen mellem de aktiviteter den startede imellem", async () => {
    activities = [makeActivity(1), makeActivity(4)]; // 09:00 og 12:00
    faserSvar = [makeFase("p1", "2026-09-29T10:00:00", "2026-09-29T10:25:00")];
    await renderTimeline();

    const html = document.body.textContent ?? "";
    const forFase = html.indexOf("09:00");
    const iFase = html.indexOf("10:00");
    const efterFase = html.indexOf("12:00");
    expect(iFase).toBeGreaterThan(forFase);
    expect(efterFase).toBeGreaterThan(iFase);
  });

  it("viser faserne på en dag uden registreret tid", async () => {
    activities = [];
    faserSvar = [
      makeFase("p1", "2026-09-29T09:00:00", "2026-09-29T09:25:00"),
      makeFase("p2", "2026-09-29T09:30:00", "2026-09-29T09:55:00"),
    ];
    await renderTimeline();

    // Trackeren kan være slået fra mens brugeren kører pomodoros. Svaret «Ingen
    // aktiviteter registreret i dag» oven på to gennemførte faser ville være en
    // løgn om dagens arbejde.
    expect(
      screen.queryByText("Ingen aktiviteter registreret i dag"),
    ).toBeNull();
    expect(screen.getAllByTestId("pomodoro-fase")).toHaveLength(2);
  });

  it("skriver datoen på en fase der løb over midnat", async () => {
    // `fasePeriode` kan skrive starten på den foregående dag. En række der
    // siger 23.45–00.10 uden dato ligner en fase fra i går. Fasen tæller på
    // **dagen den afsluttede**, så den hører til 29/9 selv om den startede 28/9.
    faserSvar = [
      makeFase(
        "nat",
        "2026-09-28T23:45:00",
        "2026-09-29T00:10:00",
        25,
        "2026-09-29",
      ),
    ];
    await renderTimeline();

    expect(screen.getByTestId("pomodoro-fase").textContent).toContain("28/09");
  });

  it("lader en fase fra en anden dag ude af dagens linje", async () => {
    faserSvar = [
      makeFase("gammel", "2026-09-20T10:00:00", "2026-09-20T10:25:00"),
    ];
    await renderTimeline();

    // Rust filtrerer på dagen; hvis et gammelt svar slap igennem, må linjen
    // ikke vise gårsdages fase som dagens.
    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
  });

  it("siger at faserne ikke kunne hentes, uden at dagen forsvinder", async () => {
    activities = [makeActivity(1), makeActivity(2)];
    faserFejler = true;
    await renderTimeline();

    // Aktiviteterne står stadig: en fældet læsning af faserne er en tilføjelse,
    // der ikke lykkedes — ikke en dag der ikke findes.
    expect(
      screen.getByText("Kunne ikke hente dagens pomodoro-faser"),
    ).toBeTruthy();
    expect(screen.getByText("app-1")).toBeTruthy();
    expect(screen.getByText("app-2")).toBeTruthy();
  });

  it("siger fra på et svar der ikke er en liste, i stedet for at kaste", async () => {
    activities = [makeActivity(1)];
    // Kommando-svar i stedet for et array, eller en gammel build der svarer
    // `null`. Uden værnet kaster `fletPomodoroInd` ved `for … of`, og hele
    // dagens tidslinje bliver hvid — de 13 øvrige tests her ville så alle
    // fejle med en `TypeError` uden at sige hvorfor.
    faserSvar = null;
    await renderTimeline();

    expect(
      screen.getByText("Kunne ikke hente dagens pomodoro-faser"),
    ).toBeTruthy();
    expect(screen.getByText("app-1")).toBeTruthy();
  });

  it("lader et gammelt svar fra i går ikke skrive dagens faser væk", async () => {
    faserSvar = [
      makeFase(
        "i_går",
        "2026-09-28T10:00:00",
        "2026-09-28T10:25:00",
        25,
        "2026-09-29",
      ),
    ];
    await renderTimeline();

    // Brugeren skifter dag, og i gårs svar er stadig i luften.
    await skiftDag("ArrowRight");

    // Dagen skiftede; fasen fra i går skal væk, for ellers står den under
    // dagens blokke og ligner dagens.
    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
  });

  it("rydder gårsdagens faser med det samme dagen skifter", async () => {
    faserSvar = [
      makeFase(
        "p1",
        "2026-09-29T10:00:00",
        "2026-09-29T10:25:00",
        25,
        "2026-09-29",
      ),
    ];
    await renderTimeline();
    expect(screen.getAllByTestId("pomodoro-fase")).toHaveLength(1);

    // **Før** det nye svar er landet: det holdes i luften med vilje, for et
    // hængende svar er præcis det virkelige problem, rydningen løser. Uden
    // rydningen står gårsdagens fase under dagens blokke indtil svaret kommer,
    // og det er den forveksling ankomstnummereren er lavet for.
    let besvaret = false;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_activities") return Promise.resolve(activities);
      if (cmd === "list_projects") return Promise.resolve([]);
      if (cmd === "get_ai_config") return Promise.resolve(null);
      if (cmd === "list_pomodoro_sessions") {
        besvaret = true;
        return new Promise(() => {});
      }
      return Promise.resolve(null);
    });

    await skiftDag("ArrowRight");

    expect(besvaret).toBe(true);
    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
  });

  it("siger at en bogført fase også står som tid", async () => {
    // En fase brugeren har registreret som tid står stadig i dagens linje, og
    // dens minutter står *også* i ugeoversigten. Rækken er bevidst ubeklikkelig,
    // så uden denne markering har brugeren ingen sted at se at det er de samme
    // 25 minutter — og dagen læser som om de optrådte to gange.
    faserSvar = [
      makeFase(
        "bogført",
        "2026-09-29T09:00:00",
        "2026-09-29T09:25:00",
        25,
        "2026-09-29",
        true,
      ),
      makeFase(
        "ubogført",
        "2026-09-29T11:00:00",
        "2026-09-29T11:25:00",
        25,
        "2026-09-29",
        false,
      ),
    ];
    await renderTimeline();

    const rækker = screen.getAllByTestId("pomodoro-fase");
    // Rækkerne kommer i starttidspunktet rækkefølge, så 09:00 er den første.
    expect(rækker[0].textContent).toContain("09:00");
    expect(rækker[0].textContent).toContain("også registreret som tid");
    // **Og kun den.** En markering på alle rækker ville være det samme som ingen:
    // så læser dagen som om intet var bogført.
    expect(rækker[1].textContent).not.toContain("også registreret som tid");
    expect(rækker[1].textContent).toContain("11:00");
  });

  it("skriver markeringen i det sprog brugeren har valgt", async () => {
    // `t()` giver nøglen tilbage for en tekst den ikke kender, så en dansk
    // streng i alle fem sprog ville være grøn her. Nøglen skal være oversat,
    // altså forskellig fra sig selv — det er præcis den mutation der slap
    // igennem i `K63`.
    for (const [sprog, forventet] of [
      ["da", "også registreret som tid"],
      ["sv", "även registrerad som tid"],
      ["nb", "også registrert som tid"],
      ["de", "auch als Zeit erfasst"],
      ["en", "also registered as time"],
    ] as const) {
      cleanup();
      await act(async () => {
        await i18n.changeLanguage(sprog);
      });
      faserSvar = [
        makeFase(
          "bogført",
          "2026-09-29T09:00:00",
          "2026-09-29T09:25:00",
          25,
          "2026-09-29",
          true,
        ),
      ];
      await renderTimeline();

      const række = screen.getByTestId("pomodoro-fase").textContent ?? "";
      expect(række).toContain(forventet);
      expect(række).not.toContain("pomodoroPhaseRegistered");
    }
    await act(async () => {
      await i18n.changeLanguage("da");
    });
  });

  it("tegner ingen fase-rækker, når dagen ingen har", async () => {
    faserSvar = [];
    await renderTimeline();

    expect(screen.queryByTestId("pomodoro-fase")).toBeNull();
    // Og dagen er ikke «tom» af den grund: aktiviteten er der.
    expect(screen.getByText("app-1")).toBeTruthy();
  });
});
