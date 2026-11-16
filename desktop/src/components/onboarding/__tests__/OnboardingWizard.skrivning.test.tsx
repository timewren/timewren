import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import da from "@/locales/da.json";
import { OnboardingWizard } from "../OnboardingWizard";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

/** Lyder på de opslag, der skal svare, så trin ikke springes over af sig selv. */
function svar(over: Record<string, () => Promise<unknown>> = {}) {
  invoke.mockImplementation(async (cmd: string) => {
    if (over[cmd]) return over[cmd]();
    if (cmd === "list_clients" || cmd === "list_projects") return [];
    if (cmd === "start_trial") {
      return { is_active: true, days_remaining: 30, started_at: null };
    }
    if (cmd === "create_client") {
      return { id: 1, name: "Kunde A", company: null };
    }
    return undefined;
  });
}

beforeEach(() => {
  invoke.mockReset();
  svar();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  invoke.mockReset();
  vi.restoreAllMocks();
});

function næste() {
  return screen.getByRole("button", { name: da.common.next });
}

async function visTrin(nummer: 0 | 1 | 2 | 3 | 4 | 5) {
  render(<OnboardingWizard onComplete={() => {}} />);
  if (nummer === 0) return;

  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(find(da.onboarding.licenseTitle)).toHaveLength(1),
  );

  if (nummer === 1) return;

  fireEvent.click(screen.getByText(da.onboarding.licenseStartTrial));
  await vi.waitFor(() => expect(næste()).toBeTruthy());
  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(find(da.onboarding.cloudTitle)).toHaveLength(1),
  );

  if (nummer === 2) return;

  fireEvent.click(screen.getByText(da.onboarding.cloudSkip));
  await vi.waitFor(() =>
    expect(find(da.onboarding.step2Title)).toHaveLength(1),
  );

  if (nummer === 3) return;

  fireEvent.click(næste());
  await vi.waitFor(() =>
    expect(find(da.onboarding.step3Title)).toHaveLength(1),
  );

  if (nummer === 4) return;

  fireEvent.click(næste());
  await vi.waitFor(() => expect(find(da.ai.providerTitle)).toHaveLength(1));
}

function find(tekst: string) {
  return screen.queryAllByText(tekst, { normalizer: (t) => t.trim() });
}

function skriv(navn: string, værdi: string) {
  fireEvent.change(screen.getByPlaceholderText(navn), {
    target: { value: værdi },
  });
}

function advarsler() {
  return screen.queryAllByRole("alert").map((n) => n.textContent?.trim());
}

/**
 * Wizarden skrev kunde, projekt, AI-nøgle og prøveperiode — og gik videre i alle
 * fire tilfælde, også når skrivningen fejlede. Det sagde til brugeren, at han
 * nu var oprettet, og gjorde det stille, så han aldrig så det: en kunde der ikke
 * findes, et projekt uden kunde, en tabt BYOK-nøgle. Prøveperioden var værre,
 * fordi der så ikke stod en «Næste» at gå videre med — brugeren sad fast uden
 * en eneste forklaring.
 */
describe("Wizarden fortæller, når den ikke kunne skrive", () => {
  it("siger det, når kunden ikke kunne oprettes, og bliver stående", async () => {
    svar({ create_client: () => Promise.reject(new Error("låst db")) });
    await visTrin(3);

    skriv(da.form.clientNamePlaceholder, "Kunde A");
    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newClient }),
    );

    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.projects.couldNotSaveClient),
    );
    // Ikke bare en besked: wizarden må heller ikke have gået videre til
    // projektrinnet, for der står «vi oprettede din kunde».
    expect(find(da.onboarding.step3Title)).toHaveLength(0);
    expect(find(da.onboarding.step2Title)).toHaveLength(1);
  });

  it("lader brugeren prøve igen, og går videre når det lykkes", async () => {
    let forsøg = 0;
    invoke.mockImplementation(async (cmd: string) => {
      if (cmd === "list_clients" || cmd === "list_projects") return [];
      if (cmd === "start_trial") {
        return { is_active: true, days_remaining: 30, started_at: null };
      }
      if (cmd === "create_client") {
        forsøg += 1;
        if (forsøg === 1) throw new Error("låst db");
        return { id: 7, name: "Kunde A", company: null };
      }
      return undefined;
    });
    await visTrin(3);

    skriv(da.form.clientNamePlaceholder, "Kunde A");
    const opret = screen.getByRole("button", { name: da.projects.newClient });
    fireEvent.click(opret);
    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.projects.couldNotSaveClient),
    );

    fireEvent.click(opret);
    await vi.waitFor(() =>
      expect(find(da.onboarding.step3Title)).toHaveLength(1),
    );
    expect(forsøg).toBe(2);
    expect(advarsler()).not.toContain(da.projects.couldNotSaveClient);
  });

  it("giver en vej ud, når kunden ikke kunne gemmes", async () => {
    // Ellers sidder brugeren fast på trinnet: «Spring over» lå kun bag på et
    // tomt navnefelt, så et navn der fejlede lod ham hverken prøve igen på
    // en rimelig måde eller komme videre.
    svar({ create_client: () => Promise.reject(new Error("låst db")) });
    await visTrin(3);

    skriv(da.form.clientNamePlaceholder, "Kunde A");
    expect(find(da.onboarding.step4Skip)).toHaveLength(0);

    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newClient }),
    );
    await vi.waitFor(() =>
      expect(find(da.onboarding.step4Skip)).toHaveLength(1),
    );

    fireEvent.click(screen.getByText(da.onboarding.step4Skip));
    await vi.waitFor(() =>
      expect(find(da.onboarding.step3Title)).toHaveLength(1),
    );
  });

  it("rydder beskeden, når navnet rettes", async () => {
    svar({ create_client: () => Promise.reject(new Error("låst db")) });
    await visTrin(3);

    skriv(da.form.clientNamePlaceholder, "Kunde A");
    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newClient }),
    );
    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.projects.couldNotSaveClient),
    );

    skriv(da.form.clientNamePlaceholder, "Kunde B");
    expect(advarsler()).not.toContain(da.projects.couldNotSaveClient);
  });

  it("sager om projektet ikke kunne oprettes, og beholder den kunde", async () => {
    svar({ create_project: () => Promise.reject(new Error("låst db")) });
    await visTrin(3);

    // Kunden oprettes først, så projektrinnet har en kunde at hænge på.
    skriv(da.form.clientNamePlaceholder, "Kunde A");
    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newClient }),
    );
    await vi.waitFor(() =>
      expect(find(da.onboarding.step3Title)).toHaveLength(1),
    );

    skriv(da.form.projectNamePlaceholder, "Projekt 1");
    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newProject }),
    );

    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.projects.couldNotSaveProject),
    );
    expect(find(da.ai.providerTitle)).toHaveLength(0);
    // Kunden fra det forrige trin skal være med i det nye forsøg — ellers
    // ville et mislykket projektoprettelse også slette kunden.
    fireEvent.click(
      screen.getByRole("button", { name: da.projects.newProject }),
    );
    await vi.waitFor(() =>
      expect(
        invoke.mock.calls.filter(([cmd]) => cmd === "create_project"),
      ).toHaveLength(2),
    );
    const [, args] = invoke.mock.calls.filter(
      ([cmd]) => cmd === "create_project",
    )[1];
    expect((args as { input: { client_id: number } }).input.client_id).toBe(1);
  });

  it("sager om AI-nøglen ikke kunne gemmes", async () => {
    svar({ set_ai_config: () => Promise.reject(new Error("låst nøglering")) });
    await visTrin(5);

    // Pladsholderen afhænger af udbyderen, så feltet findes på sin etiket.
    fireEvent.change(screen.getByLabelText(da.ai.apiKeyTitle), {
      target: { value: "sk-secret" },
    });
    fireEvent.click(screen.getByRole("button", { name: da.common.save }));

    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.common.couldNotSave),
    );
    // Nøglen er BYOK: brugerens eneste kopi. Gik han videre, troede han den
    // var gemt, og så var den væk.
    expect(find(da.onboarding.step5Title)).toHaveLength(0);
  });

  it("sager om prøveperioden ikke startede", async () => {
    svar({ start_trial: () => Promise.reject(new Error("låst db")) });
    await visTrin(1);

    fireEvent.click(screen.getByText(da.onboarding.licenseStartTrial));

    await vi.waitFor(() =>
      expect(advarsler()).toContain(da.license.activateFailed),
    );
    // Uden prøveperiode eller licens står der ingen «Næste» — det var præcis
    // det brugeren sad fast i, nu med en forklaring og en knap der virker igen.
    expect(() =>
      screen.getByRole("button", { name: da.common.next }),
    ).toThrow();
    expect(
      screen.getByRole("button", {
        name: da.onboarding.licenseStartTrial,
      }),
    ).toBeTruthy();
  });
});
