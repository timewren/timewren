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
import { KlippekortForm } from "@/components/klippekort/KlippekortForm";
import { ClientForm } from "@/components/projects/ClientForm";
import { ClientList } from "@/components/projects/ClientList";
import { ProjectForm } from "@/components/projects/ProjectForm";
import { ProjectList } from "@/components/projects/ProjectList";
import type { Client, Project } from "@/lib/types";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

/**
 * 87,50 kr/t er et helt normalt freelancertarif i Danmark — og det er præcis
 * det beløb, appen stoppede ved at gemme.
 *
 * De tre formularer bar `step="25"` på timeprisfeltet. For et
 * `<input type="number">` er `step` ikke bare piletastens spring: browseren
 * **validerer** værdien mod `min + n × step`, og en værdi der ikke passer er
 * `stepMismatch` — feltet er da ugyldigt. Målt i jsdom:
 * `step="25"` + `87,5` → `validity.stepMismatch === true`,
 * `checkValidity() === false`; `step="any"` + `87,5` → begge dele sande.
 *
 * Gem-knappen er `type="button"` med `onClick={handleSubmit}`, så et klik
 * gemmer alligevel. Men `<form onSubmit>` er der, og Enter i et af felterne
 * sender formularen gennem den samme validering — så brugeren skriver 87,50,
 * trykker Enter, og **intet gemmes**. Det er præcis den stille tab af data,
 * der ligner «appen hang».
 *
 * Samme klasse fejl lå i `KlippekortCard` (afrundet til hele kroner) og i
 * `ReportView` (momssatsen skrevet «8 %» for 7,5). De dømmes hver for sig i
 * deres egne tests; her er det, der **kan gemmes**.
 */

/** Satsen der ikke må afrundes, og den der ikke må afvises. */
const SATS = "87.5";

const CLIENT: Client = {
  id: "c1",
  remote_id: null,
  name: "Acme",
  email: null,
  phone: null,
  company: null,
  cvr: null,
  hourly_rate: 87.5,
  notes: null,
  is_archived: false,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
} as unknown as Client;

const PROJECT: Project = {
  id: "p1",
  remote_id: null,
  client_id: "c1",
  name: "Web",
  color: "#6B7280",
  hourly_rate: 87.5,
  estimated_hours: 10,
  is_archived: false,
  created_at: "2026-01-01T00:00:00",
  updated_at: "2026-01-01T00:00:00",
  client_name: "Acme",
} as unknown as Project;

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation((cmd: string) => {
    if (cmd === "list_clients")
      return Promise.resolve([{ id: "c1", name: "Acme" } as Client]);
    if (cmd === "list_projects")
      return Promise.resolve([
        { id: "p1", name: "Web", client_id: "c1" } as Project,
      ]);
    return Promise.resolve(null);
  });
});

afterEach(async () => {
  cleanup();
  await i18n.changeLanguage("da");
});

/** Find feltet ved sin etiket, så testen ikke hænger på et `id`. */
function prisFelt(): HTMLInputElement {
  const etiket = screen
    .getAllByText(/kr|€|Stundensatz|Timepris/i)
    .find((e) => e.tagName === "LABEL");
  if (!etiket) throw new Error("ingen etiket på timeprisen fundet");
  const felt = document.getElementById(etiket.getAttribute("for") ?? "");
  if (!(felt instanceof HTMLInputElement)) {
    throw new Error("etiketen peger ikke på et input");
  }
  return felt;
}

describe("timeprisen 87,50 kan gemmes", () => {
  it("ClientForm: felttet gemmer 87,50 uændret", async () => {
    render(<ClientForm open onClose={() => {}} onSaved={() => {}} />);
    const felt = prisFelt();
    fireEvent.change(felt, { target: { value: SATS } });
    // Beviset på rettelsen: browserens egen validering.
    expect(felt.validity.stepMismatch, "87,50 må ikke være stepMismatch").toBe(
      false,
    );
    expect(felt.checkValidity()).toBe(true);
    // Og tallet overlever utværksættelsen uændret.
    fireEvent.change(
      screen.getByLabelText(/navn|name|navn|succé/i, {
        selector: "input",
      }),
      { target: { value: "Acme" } },
    );
    fireEvent.click(screen.getByText(i18n.t("common.create")));
    await waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[0] === "create_client")).toBe(
        true,
      ),
    );
    const kald = invoke.mock.calls.find((c) => c[0] === "create_client");
    const input = (kald?.[1] as { input?: { hourly_rate?: number | null } })
      ?.input;
    expect(input?.hourly_rate).toBe(87.5);
  });

  it("ClientForm: en redigeret kunde beholder sin sats ved gem", async () => {
    render(
      <ClientForm open onClose={() => {}} onSaved={() => {}} client={CLIENT} />,
    );
    await waitFor(() => expect(prisFelt().value).toBe(SATS));
    expect(prisFelt().checkValidity()).toBe(true);
    fireEvent.click(screen.getByText(i18n.t("common.save")));
    await waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[0] === "update_client")).toBe(
        true,
      ),
    );
    const kald = invoke.mock.calls.find((c) => c[0] === "update_client");
    const client = (kald?.[1] as { client?: { hourly_rate?: number | null } })
      ?.client;
    expect(client?.hourly_rate).toBe(87.5);
  });

  it("ProjectForm: feltet er gyldigt ved 87,50", async () => {
    render(<ProjectForm open onClose={() => {}} onSaved={() => {}} />);
    const felt = prisFelt();
    fireEvent.change(felt, { target: { value: SATS } });
    expect(felt.validity.stepMismatch).toBe(false);
    expect(felt.checkValidity()).toBe(true);
  });

  it("ProjectForm: et redigeret projekt på 87,50 kan gemmes uændret", async () => {
    // Samme redigeringsvej som kunden: satsen læses *ind* i feltet ved åbning,
    // så en `step` der afvister den gør et gemt projekt uændringsligt.
    render(
      <ProjectForm
        open
        onClose={() => {}}
        onSaved={() => {}}
        project={PROJECT}
      />,
    );
    await waitFor(() => expect(prisFelt().value).toBe(SATS));
    expect(prisFelt().checkValidity()).toBe(true);
    fireEvent.click(screen.getByText(i18n.t("common.save")));
    await waitFor(() =>
      expect(invoke.mock.calls.some((c) => c[0] === "update_project")).toBe(
        true,
      ),
    );
    const kald = invoke.mock.calls.find((c) => c[0] === "update_project");
    const project = (kald?.[1] as { project?: { hourly_rate?: number | null } })
      ?.project;
    expect(project?.hourly_rate).toBe(87.5);
  });

  it("KlippekortForm: feltet er gyldigt ved 87,50", async () => {
    render(<KlippekortForm open onClose={() => {}} onSaved={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByRole("dialog", { name: i18n.t("klippekort.new") }),
      ).toBeTruthy(),
    );
    const felt = prisFelt();
    fireEvent.change(felt, { target: { value: SATS } });
    expect(felt.validity.stepMismatch).toBe(false);
    expect(felt.checkValidity()).toBe(true);
  });

  it("et eksisterende klippekort på 87,50 kan redigeres og gemmes", async () => {
    // Redigeringsvejen læser satsen *ind* i feltet, så en `step` der afvister
    // den gør et gemt klippekort uændringsligt — brugeren kan ikke engang rette
    // navnet, uden at sættet forsvinder.
    const klippekort = {
      id: "k1",
      remote_id: null,
      client_id: "c1",
      project_id: null,
      name: "Design",
      total_hours: 20,
      used_hours: 0,
      hourly_rate: 87.5,
      status: "active",
      expires_at: null,
      created_at: "2026-01-01T00:00:00",
      updated_at: "2026-01-01T00:00:00",
      client_name: "Acme",
      project_name: null,
    };
    render(
      <KlippekortForm
        open
        onClose={() => {}}
        onSaved={() => {}}
        klippekort={klippekort as never}
      />,
    );
    await waitFor(() => expect(prisFelt().value).toBe(SATS));
    expect(prisFelt().checkValidity()).toBe(true);
  });

  it("heltallssatser er stadig gyldige", async () => {
    // `step="any"` må ikke gøre 900 ugyldigt — det ville være en ny måde at
    // låse den sats, der låser de fleste.
    render(<ClientForm open onClose={() => {}} onSaved={() => {}} />);
    const felt = prisFelt();
    for (const sats of ["0", "900", "87.5", "1234.56"]) {
      fireEvent.change(felt, { target: { value: sats } });
      expect(felt.checkValidity(), sats).toBe(true);
    }
    // Og en negativ sats er stadig ugyldig — `min="0"` står.
    fireEvent.change(felt, { target: { value: "-5" } });
    expect(felt.checkValidity()).toBe(false);
  });
});

/**
 * Listerne skrev ``${hourly_rate} kr`` — et råt tal og et dansk symbol i
 * markup'en. Det er samme fejl som den på kortet, bare en grad værre: `87.5`
 * stod som «87.5 kr» i alle fem sprog (engelsk decimaltegn oven på dansk), og
 * symbolets placering fulgte ikke sprogvalget.
 */
describe("listeners timepris følger sprog og decimaler", () => {
  const ryd = (s: string) => s.replaceAll("\u00a0", " ");
  const tekst = () => ryd(document.body.textContent ?? "");

  const kr = (lang: string, beløb: number, dec: number) =>
    ryd(
      new Intl.NumberFormat(lang, {
        style: "currency",
        currency: "DKK",
        minimumFractionDigits: dec,
        maximumFractionDigits: dec,
      }).format(beløb),
    );

  const LANGS = ["da", "de", "sv", "nb", "en"] as const;

  const SAG: Record<string, unknown> = {
    id: "c1",
    name: "Acme",
    company: "ApS",
    cvr: null,
    hourly_rate: 87.5,
    is_archived: false,
  };

  beforeEach(() => {
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_clients") return Promise.resolve([SAG]);
      if (cmd === "list_projects")
        return Promise.resolve([{ ...SAG, id: "p1", name: "Web" }]);
      if (cmd === "get_over_budget_projects") return Promise.resolve([]);
      return Promise.resolve(null);
    });
  });

  it("ClientList skriver 87,50 i hvert sit sprog", async () => {
    for (const lang of LANGS) {
      cleanup();
      await i18n.changeLanguage(lang);
      render(<ClientList />);
      await waitFor(() => expect(tekst()).toContain("Acme"));
      expect(tekst(), lang).toContain(kr(lang, 87.5, 2));
      // Det rå tal med dansk symbol var fejlen — det må ikke overleve.
      expect(tekst(), lang).not.toContain("87.5 kr");
      // Og i engelsk må decimaltegnet være et punktum, ikke et komma.
      if (lang === "en") expect(tekst()).not.toContain("87,50 kr");
    }
  });

  it("ProjectList skriver 87,50 i hvert sit sprog", async () => {
    for (const lang of LANGS) {
      cleanup();
      await i18n.changeLanguage(lang);
      render(<ProjectList />);
      await waitFor(() => expect(tekst()).toContain("Web"));
      expect(tekst(), lang).toContain(kr(lang, 87.5, 2));
      expect(tekst(), lang).not.toContain("87.5 kr");
      if (lang === "en") expect(tekst()).not.toContain("87,50 kr");
    }
  });

  it("en kunde uden sats viser stadig tankestregen", async () => {
    // `hourly_rate ? … : "—"` skal ikke blive til «0,00 kr.», fordi en
    // formateret 0 er en sand værdi. Det er den samme betingelse som før.
    cleanup();
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "list_clients")
        return Promise.resolve([{ ...SAG, hourly_rate: null }]);
      return Promise.resolve(null);
    });
    await i18n.changeLanguage("da");
    render(<ClientList />);
    await waitFor(() => expect(tekst()).toContain("Acme"));
    expect(tekst()).toContain("—");
    expect(tekst()).not.toContain("0,00 kr");
  });
});
