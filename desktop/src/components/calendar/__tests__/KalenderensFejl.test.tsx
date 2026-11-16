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

import { DayView } from "@/components/calendar/DayView";
import { MonthView } from "@/components/calendar/MonthView";
import { WeekView } from "@/components/calendar/WeekView";

/**
 * En fejlet indlæsning må ikke se ud som en dag uden arbejde.
 *
 * Kalenderens tre visninger tømte hver sin liste i et `catch`, så en låst
 * database, en afbrudt synk eller en korrupt fil tegnede en hel arbejdsdag uden
 * én eneste registrering. Det er ikke en tom konto — det er en *løgn om
 * brugerens eget arbejde*, og den er dyrere end de andre: en bruger der
 * re-registrerer en dag, fordi appen sagde den var tom, ender med dobbelt
 * registreret tid, der så skal slettes igen.
 */

const ENHED = [
  {
    id: "t1",
    project_id: null,
    project_name: "Kundesite",
    client_id: "c1",
    client_name: "Kunde A",
    description: "Landingpage",
    start_time: "2026-09-29T09:00:00",
    end_time: "2026-09-29T11:00:00",
    duration: 7200,
    is_billable: true,
    is_running: false,
    source: "manual",
  },
  // Den 30. har sin egen registrering, så skiftet af dag er synligt.
  {
    id: "t2",
    project_id: null,
    project_name: "Kundesite",
    client_id: "c1",
    client_name: "Kunde A",
    description: "Nyt site",
    start_time: "2026-09-30T09:00:00",
    end_time: "2026-09-30T11:00:00",
    duration: 7200,
    is_billable: true,
    is_running: false,
    source: "manual",
  },
];

/** Hvor mange kalenderkald der er kørt — `get_setting` tælles ikke med. */
function tidsKald(): number {
  return invoke.mock.calls.filter((c) => String(c[0]).startsWith("list_"))
    .length;
}

/** Et kald, der ikke svarer, før testen siger det. */
function deferrer(fejl: Error) {
  let afvis: (e: Error) => void = () => {};
  const promise = new Promise((_resolve, reject) => {
    afvis = reject;
  });
  return { promise, afvis, fejl };
}

/** De tre kalenderkommandoer, hvis svar en visning tegner. */
function svar(entries: unknown[]) {
  return (cmd: string) => {
    if (cmd === "list_time_entries") return Promise.resolve(entries);
    return Promise.resolve([]);
  };
}

/** Månedsvisningen skriver tiden i dagens `aria-label`, de to andre som tekst. */
function registreretTid(): HTMLElement | null {
  return (
    screen.queryByText("Landingpage") ??
    screen
      .getByLabelText(/^29\./)
      .ownerDocument.querySelector('[aria-label*="2t 0m"]')
  );
}

const CASER = [
  {
    navn: "DayView",
    render: () => (
      <DayView
        date={new Date(2026, 8, 29, 9, 0)}
        onEditEntry={vi.fn()}
        onCreateEntry={vi.fn()}
        onNavigateDay={vi.fn()}
      />
    ),
  },
  {
    navn: "WeekView",
    render: () => (
      <WeekView
        date={new Date(2026, 8, 29, 9, 0)}
        onEditEntry={vi.fn()}
        onCreateEntry={vi.fn()}
      />
    ),
  },
  {
    navn: "MonthView",
    render: () => (
      <MonthView date={new Date(2026, 8, 29, 9, 0)} onSelectDay={vi.fn()} />
    ),
  },
];

describe("en fejlet kalenderindlæsning er ikke en tom arbejdsdag", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockRejectedValue(new Error("database is locked"));
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("da");
  });

  for (const c of CASER) {
    it(`${c.navn}: siger at indlæsningen fejlede, og ikke at dagen er tom`, async () => {
      render(c.render());

      await waitFor(() => {
        expect(
          screen.getByText(i18n.t("errors.couldNotLoadEntries")),
        ).toBeTruthy();
      });

      // Beviset på selve forvekslingen: en registreret enhed må ikke stå
      // nogen steder. Før rettelsen viste disse skærme bare det tomme gitter.
      expect(screen.queryByText("Landingpage")).toBeNull();
      expect(screen.queryByText("Kundesite")).toBeNull();
    });
  }

  for (const c of CASER) {
    it(`${c.navn}: tilbyder at prøve igen, og et kald der lykkes, tegner dagen`, async () => {
      render(c.render());

      await waitFor(() => {
        expect(
          screen.getByText(i18n.t("errors.couldNotLoadEntries")),
        ).toBeTruthy();
      });

      // Databasen svarer igen. Knappen skal føre til et nyt kald — ikke blot
      // til at tegne den gamle fejl igen.
      invoke.mockImplementation(svar(ENHED));
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("errors.tryAgain") }),
      );

      await waitFor(() => {
        expect(invoke.mock.calls.length).toBeGreaterThan(1);
        expect(registreretTid()).toBeTruthy();
      });
      expect(
        screen.queryByText(i18n.t("errors.couldNotLoadEntries")),
      ).toBeNull();
    });

    it(`${c.navn}: skjuler en tidligere fejl, når et nyt kald lykkes`, async () => {
      // Omvendt af «behold fejlen»: et kald der virker efter et der fejlede
      // skal fjerne beskeden, ellers lå den der og skjulte det indhold, der kom.
      let fejlet = true;
      invoke.mockImplementation((cmd: string) =>
        fejlet ? Promise.reject(new Error("locked")) : svar(ENHED)(cmd),
      );

      render(c.render());
      await waitFor(() => {
        expect(
          screen.getByText(i18n.t("errors.couldNotLoadEntries")),
        ).toBeTruthy();
      });

      fejlet = false;
      fireEvent.click(
        screen.getByRole("button", { name: i18n.t("errors.tryAgain") }),
      );

      await waitFor(() => {
        expect(
          screen.queryByText(i18n.t("errors.couldNotLoadEntries")),
        ).toBeNull();
      });
    });
  }

  it("MonthView tegner tiden, når indlæsningen lykkes — porten må ikke dømme en død skærm", async () => {
    // Omvendt af de tre fejl-tilfælde: når kaldene svarer, skal skærmen vise
    // registreringen. Ellers ville en port, der bare kræver `<LoadError` kunne
    // være grøn med en skærm, der aldrig viser noget.
    invoke.mockImplementation(svar(ENHED));

    render(CASER[2].render());

    await waitFor(() => {
      // Månedsvisningen skriver den registrerede tid i dagens `aria-label`,
      // så det er den, der beviser at indholdet faktisk tegnes.
      const dag = screen.getByLabelText(/29\./).getAttribute("aria-label");
      expect(dag).toContain("2t 0m");
    });
    expect(screen.queryByText(i18n.t("errors.couldNotLoadEntries"))).toBeNull();
  });

  it("et gammelt kald må ikke tømme den dag, der vises nu", async () => {
    // Kaldene er ikke samtidige: brugeren kan skifte dag, og et kald for i går
    // kan komme tilbage efter et for i dag. Uden nummereringen ville den
    // gamle dags fejl tømme den nye dags indhold og hænge en fejltekst op den
    // dag, der virker — altså præcis den løgn, denne opgave fjerner, bare
    // forklædt som et gammelt svar.
    const gammelt = deferrer(new Error("database is locked"));
    invoke.mockImplementation(() => gammelt.promise);

    const { rerender } = render(CASER[0].render());
    await waitFor(() => {
      // `useMergeGapSeconds` kalder også `get_setting`, så tælles kun de tre
      // kalenderkald.
      expect(tidsKald()).toBe(3);
    });

    // Dagen skifter, og det nye kald svarer med en registrering.
    invoke.mockImplementation(svar(ENHED));
    rerender(
      <DayView
        date={new Date(2026, 8, 30, 9, 0)}
        onEditEntry={vi.fn()}
        onCreateEntry={vi.fn()}
        onNavigateDay={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByText("Nyt site")).toBeTruthy();
    });

    // Nu kommer det gamle kald tilbage med sin fejl.
    gammelt.afvis(new Error("database is locked"));
    await waitFor(() => {
      expect(tidsKald()).toBe(6);
    });

    expect(screen.getByText("Nyt site")).toBeTruthy();
    expect(screen.queryByText(i18n.t("errors.couldNotLoadEntries"))).toBeNull();
  });
});
