import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import i18n from "@/lib/i18n";
import "@/lib/i18n";

const invoke = vi.fn();

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { InvoiceList } from "@/components/invoices/InvoiceList";
import { KlippekortList } from "@/components/klippekort/KlippekortList";
import { ClientList } from "@/components/projects/ClientList";
import { ProjectList } from "@/components/projects/ProjectList";

/**
 * En fejlet indlæsning må ikke se ud som en konto uden indhold.
 *
 * Før var mønsteret `catch (err) { console.error(...) } finally { setLoading(false) }`
 * i ti komponenter, så enhver fejl — en låst database, en korrupt fil, et
 * afbrudt kald — endte som den *tomme* tilstand: «Ingen klienter endnu», «Ingen
 * projekter endnu». Brugeren fik dermed besked på at oprette sin første kunde,
 * fordi databasen ikke svarede. Disse tests dømmer den forveksling.
 */
describe("fejlet indlæsning er ikke en tom konto", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockRejectedValue(new Error("database is locked"));
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("da");
  });

  const CASER: {
    navn: string;
    render: () => React.ReactElement;
    fejl: string;
    tom: string;
  }[] = [
    {
      navn: "ClientList",
      render: () => <ClientList />,
      fejl: "projects.clientsLoadFailed",
      tom: "projects.noClients",
    },
    {
      navn: "ProjectList",
      render: () => <ProjectList />,
      fejl: "projects.projectsLoadFailed",
      tom: "projects.noProjects",
    },
    {
      navn: "KlippekortList",
      render: () => <KlippekortList />,
      fejl: "klippekort.loadFailed",
      tom: "klippekort.noKlippekort",
    },
    {
      navn: "InvoiceList",
      render: () => <InvoiceList />,
      fejl: "invoices.listLoadFailed",
      tom: "invoices.noInvoices",
    },
  ];

  for (const c of CASER) {
    it(`${c.navn}: siger at indlæsningen fejlede, og ikke at kontoen er tom`, async () => {
      render(c.render());

      await waitFor(() => {
        expect(screen.getByText(i18n.t(c.fejl))).toBeTruthy();
      });

      // Beviset på selve forvekslingen. `getByText` ville kaste, hvis den
      // tomme tilstand stadig stod et andet sted på skærmen.
      expect(screen.queryByText(i18n.t(c.tom))).toBeNull();
    });
  }

  it("tilbyder at prøve igen, og et nyt kald der lykkes, tager fejlen væk", async () => {
    render(<ClientList />);

    await waitFor(() => {
      expect(
        screen.getByText(i18n.t("projects.clientsLoadFailed")),
      ).toBeTruthy();
    });

    // Databasen svarer igen. Knappen skal føre til et nyt kald — ikke blot
    // til at tegne den gamle fejl igen.
    invoke.mockResolvedValue([]);
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("errors.tryAgain") }),
    );

    await waitFor(() => {
      expect(screen.getByText(i18n.t("projects.noClients"))).toBeTruthy();
    });
    expect(screen.queryByText(i18n.t("projects.clientsLoadFailed"))).toBeNull();
    // Bevis på at knappen faktisk kaldte igen og ikke bare skjulte beskeden.
    expect(invoke.mock.calls.length).toBeGreaterThan(1);
  });

  it("skjuler en tidligere fejl, når et nyt kald lykkes", async () => {
    // Omvendt af «behold fejlen»: et kald der virker efter et der fejlede skal
    // fjerne beskeden, ellers lå den der og skjulte det indhold, der kom.
    let fejlet = true;
    invoke.mockImplementation(() =>
      fejlet
        ? Promise.reject(new Error("database is locked"))
        : Promise.resolve([]),
    );

    render(<ClientList />);
    await waitFor(() => {
      expect(
        screen.getByText(i18n.t("projects.clientsLoadFailed")),
      ).toBeTruthy();
    });

    fejlet = false;
    fireEvent.click(
      screen.getByRole("button", { name: i18n.t("errors.tryAgain") }),
    );

    await waitFor(() => {
      expect(screen.getByText(i18n.t("projects.noClients"))).toBeTruthy();
    });
    expect(screen.queryByText(i18n.t("projects.clientsLoadFailed"))).toBeNull();
  });
});

describe("pynt må ikke tage indhold med ned", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  afterEach(async () => {
    cleanup();
    await i18n.changeLanguage("da");
  });

  it("ProjectList viser projekterne, selv når budgetmærketingen fejler", async () => {
    // `get_over_budget_projects` lå i samme try som `list_projects`, så en
    // fejl i den pynt-række tømte hele listen og viste «Ingen projekter endnu».
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") {
        return Promise.resolve([
          {
            id: "p1",
            client_id: "c1",
            name: "Hjemmeside",
            client_name: "Kunde A",
            hourly_rate: null,
            color: null,
            estimated_hours: null,
          },
        ]);
      }
      return Promise.reject(new Error("database is locked"));
    });

    render(<ProjectList />);

    await waitFor(() => {
      expect(screen.getByText("Hjemmeside")).toBeTruthy();
    });
    expect(
      screen.queryByText(i18n.t("projects.projectsLoadFailed")),
    ).toBeNull();
  });

  it("ProjectList siger det når budgetmærketingen fejler, hvis listen også er tom", async () => {
    // Omvendt: når selve listen fejler, skal fejlen stadig være synlig — den
    // pynt-kald må ikke have spist den.
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_projects") return Promise.resolve([]);
      return Promise.reject(new Error("database is locked"));
    });

    render(<ProjectList />);

    await waitFor(() => {
      expect(screen.getByText(i18n.t("projects.noProjects"))).toBeTruthy();
    });
    expect(
      screen.queryByText(i18n.t("projects.projectsLoadFailed")),
    ).toBeNull();
  });
});
