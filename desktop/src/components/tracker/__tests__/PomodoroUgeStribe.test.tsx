import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import type { PomodoroStats } from "@/lib/types";
import { PomodoroUgeStribe } from "../PomodoroUgeStribe";

/** Klokken er tirsdag 30. september 2026 kl. 09. Kolonnerne er derfor
 *  onsdag 23. til tirsdag 29. — datoerne er **lokale**, fordi Rust skriver
 *  dem som `%Y-%m-%d` uden tidszone, og det er den kalenderdag brugeren
 *  afsluttede en pomodoro på, der skal tælles. */
const IDAG = "2026-09-29";
const UGE = [
  "2026-09-23",
  "2026-09-24",
  "2026-09-25",
  "2026-09-26",
  "2026-09-27",
  "2026-09-28",
  "2026-09-29",
];

function stats(overrides: Partial<PomodoroStats> = {}): PomodoroStats {
  return {
    i_dag: { day: IDAG, sessions: 0, minutes: 0 },
    dage: [],
    minutter_i_dag: 0,
    ...overrides,
  };
}

/** De syv kolonner i DOM'en. `navn` følger det valgte sprog. */
function kolonner(navn: RegExp = /seneste uge/i) {
  return within(screen.getByRole("list", { name: navn })).getAllByRole(
    "listitem",
  );
}

/**
 * Højden af en søjle i procent, som den er tegnet.
 *
 * Den inline-højde ligger på den **indvendige** div. Yderboksen er dekoration
 * og har ingen, så spørger man på den får man den tomme streng — altså ville
 * porten have været grøn fordi den læste det forkerte element.
 */
function søjleHøjde(kolonne: HTMLElement): string {
  const søjle = kolonne.querySelector<HTMLElement>("div > div[style]");
  return søjle?.style.height ?? "";
}

beforeEach(() => {
  invoke.mockReset();
  // Striben regner fra **klokken**, ikke fra svaret (det er hele fundet), så
  // porten skal have et ur. `IDAG` er den klokken står på, og testene der
  // vil se en anden dag sætter den selv med `setSystemTime`.
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 8, 29, 9, 0));
});

afterEach(() => {
  vi.useRealTimers();
  cleanup();
  i18n.changeLanguage("da");
});

describe("PomodoroUgeStribe", () => {
  it("viser alle syv dage, også dem uden en pomodoro", () => {
    // `get_pomodoro_stats` grupperer på `day`, så en dag uden pomodoros har
    // ingen række i svaret. Uden nul-striben fik brugeren fire kolonner i en
    // uge, hvor to af dem var en pause han ikke kunne se.
    render(
      <PomodoroUgeStribe
        stats={stats({
          dage: [{ day: IDAG, sessions: 2, minutes: 50 }],
          i_dag: { day: IDAG, sessions: 2, minutes: 50 },
          minutter_i_dag: 50,
        })}
      />,
    );

    expect(kolonner()).toHaveLength(7);
    // Dagens søjle er fuld, de andre er tomme — og en tom søjle er 0 høj, så
    // den kan læses som «ingen pomodoros den dag».
    expect(søjleHøjde(kolonner()[6])).toBe("100%");
    expect(søjleHøjde(kolonner()[0])).toBe("0%");
  });

  it("tegner ikke striben for en uge uden en eneste pomodoro", () => {
    // Syv tomme søjler forteller intet, og «Ingen pomodoros i dag endnu» står
    // allerede lige over. Uden denne tjek lå der en tom boks under timeren
    // for alle nye brugere.
    render(<PomodoroUgeStribe stats={stats()} />);

    expect(screen.queryByRole("list")).toBeNull();
  });

  it("tegner ikke striben, før backend har svaret", () => {
    render(<PomodoroUgeStribe stats={null} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("markerer dagen, så skærmlæseren hører hvilken det er", () => {
    // Uden markering er «i dag» kun erfaringsfarve — og farve er præcis det,
    // en skærmlæser ikke kan se.
    render(
      <PomodoroUgeStribe
        stats={stats({ dage: [{ day: IDAG, sessions: 1, minutes: 25 }] })}
      />,
    );

    const markerede = kolonner().filter((k) => k.getAttribute("aria-current"));
    expect(markerede).toHaveLength(1);
    expect(markerede[0]).toBe(kolonner()[6]);
  });

  it("tæller ikke gårsdagens række som dagens, når svaret er fra i går", () => {
    // **Fundet fra reviewet.** `get_pomodoro_stats` svarer med den dag
    // kommandoen læste, og brugeren kan have appen åben over et døgnskifte:
    // svaret rummer da både gårsdags række og dagens. Låner UI'et dagens
    // dato fra svaret, markerer den gårsdags kolonne som i dag — to kolonner
    // med samme dato, og et antal der ikke passer med tælleren lige over
    // striben. Dagens dato skal derfor komme fra klokken, ikke fra svaret.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 8, 30, 9, 0));
    try {
      render(
        <PomodoroUgeStribe
          stats={stats({
            // Svaret er fra 29/9 — det er det brugeren så da appen blev ånet.
            i_dag: { day: "2026-09-29", sessions: 2, minutes: 50 },
            dage: [
              { day: "2026-09-29", sessions: 2, minutes: 50 },
              { day: "2026-09-30", sessions: 1, minutes: 25 },
            ],
            minutter_i_dag: 50,
          })}
        />,
      );

      // Klokken er 30/9, så ugen er 24/9–30/og dagens kolonne er den syvende.
      expect(kolonner()).toHaveLength(7);
      const markerede = kolonner().filter((k) =>
        k.getAttribute("aria-current"),
      );
      expect(markerede).toHaveLength(1);
      expect(markerede[0]).toBe(kolonner()[6]);

      // Gårsdags 2 og dagens 1 står hver i deres egen kolonne.
      const tekster = kolonner().map((k) => k.textContent);
      expect(tekster[5]).toContain("2 pomodoros");
      expect(tekster[6]).toContain("1 pomodoro");
    } finally {
      vi.useRealTimers();
    }
  });

  it("lader en lille dag være synlig, så en travl uge ikke skjuler den", () => {
    // 1 mod 6 er 17 % — fint. Men 1 mod 30 er 3 %, som i en 48 px boks er
    // halvanden pixel: dagen ligner en dag uden pomodoros.
    render(
      <PomodoroUgeStribe
        stats={stats({
          dage: [
            { day: "2026-09-23", sessions: 1, minutes: 25 },
            { day: IDAG, sessions: 24, minutes: 600 },
          ],
          i_dag: { day: IDAG, sessions: 24, minutes: 600 },
        })}
      />,
    );

    expect(søjleHøjde(kolonner()[6])).toBe("100%");
    expect(søjleHøjde(kolonner()[0])).toBe("8%");
    // En dag uden pomodoros er stadig 0 — bunden må ikke slå igennem her,
    // ellers kan dagen uden og dagen med én ikke skelnes.
    expect(søjleHøjde(kolonner()[3])).toBe("0%");
  });

  it("læser dag og antal højt for hver søjle", () => {
    // Søjlens højde er en visuel størrelse, ingen skærmlæser kan læse den.
    render(
      <PomodoroUgeStribe
        stats={stats({
          dage: [
            { day: "2026-09-23", sessions: 2, minutes: 50 },
            { day: IDAG, sessions: 1, minutes: 25 },
          ],
          i_dag: { day: IDAG, sessions: 1, minutes: 25 },
        })}
      />,
    );

    const tekster = kolonner().map((k) => k.textContent);
    expect(tekster[0]).toContain("2 pomodoros");
    expect(tekster[6]).toContain("1 pomodoro");
    // En dag uden pomodoros skal sige det, ikke være tom.
    expect(tekster[1]).toContain("ingen pomodoro");
  });

  it("regner sig ikke frem i kalenderen over en månedsgrænse", () => {
    // Datoerne er lokale. `new Date("2026-09-23")` er UTC-midnat og er derfor
    // *22/9* i Danmark — så en UTC-læsning ville flytte hele striben en dag
    // tilbage for alt vest for Greenwich, uden at nogen test på en maskine i
    // UTC ville bemærke det.
    vi.setSystemTime(new Date(2026, 9, 2, 9, 0));
    render(
      <PomodoroUgeStribe
        stats={stats({
          i_dag: { day: "2026-10-02", sessions: 1, minutes: 25 },
          dage: [{ day: "2026-10-02", sessions: 1, minutes: 25 }],
        })}
      />,
    );

    // 26/9–2/10: syv dage, hvor den første er september og den sidste er den
    // 2. oktober. En UTC-læsning ville givet 25/9–1/10.
    expect(kolonner()[0].textContent).toContain("Lør");
    expect(kolonner()[6].getAttribute("aria-current")).toBe("date");
  });

  it("skriver dagene i alle fem sprog", () => {
    const uge = UGE.map((day, n) => ({
      day,
      sessions: n === 6 ? 1 : 0,
      minutes: n === 6 ? 25 : 0,
    }));

    for (const [sprog, dagsnavn, uten, ugelabel] of [
      ["da", "Tir", "ingen pomodoro", /seneste uge/i],
      ["en", "Tue", "no pomodoro", /last week/i],
      ["sv", "Tis", "inga pomodoror", /senaste veckan/i],
      ["nb", "Tir", "ingen pomodoroer", /siste uke/i],
      ["de", "Di", "keine Pomodoros", /letzten Woche/i],
    ] as const) {
      i18n.changeLanguage(sprog);
      const { unmount } = render(
        <PomodoroUgeStribe
          stats={stats({
            i_dag: { day: IDAG, sessions: 1, minutes: 25 },
            dage: uge,
          })}
        />,
      );

      const k = kolonner(ugelabel);
      expect(k[6].textContent).toContain(dagsnavn);
      expect(k[0].textContent).toContain(uten);
      unmount();
    }
  });
});
