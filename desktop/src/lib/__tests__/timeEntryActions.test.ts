import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

import {
  confirmActivityAsTimeEntry,
  createTimeEntry,
  resolveEntryTimes,
  type TimeEntryInput,
  timeEntryCreateInFlight,
} from "../timeEntryActions";
import type { Activity, Project } from "../types";

const INPUT: TimeEntryInput = {
  project_id: "p-1",
  client_id: "c-1",
  klippekort_id: null,
  description: "Udarbejdelse",
  start_time: "2026-09-29T09:00:00",
  end_time: "2026-09-29T10:00:00",
  duration: 3600,
  is_billable: true,
};

const PROJECT: Project = {
  id: "p-1",
  remote_id: null,
  client_id: "c-1",
  name: "Kundeprojekt",
  hourly_rate: null,
  color: null,
  estimated_hours: null,
  is_archived: false,
  created_at: "2026-09-01T00:00:00",
  updated_at: "2026-09-01T00:00:00",
  synced_at: null,
  client_name: "Kunden",
};

const ACTIVITY: Activity = {
  id: 7,
  app_name: "vscode",
  window_title: "index.ts",
  url: null,
  git_branch: null,
  git_repo: null,
  context_path: null,
  file_path: null,
  category: "development",
  project_id: "p-1",
  client_id: null,
  confidence: 0.9,
  classification_source: null,
  classification_reason: null,
  is_confirmed: false,
  is_idle: false,
  started_at: "2026-09-29T09:00:00",
  ended_at: "2026-09-29T10:00:00",
  duration: 3600,
};

function callsTo(cmd: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === cmd)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

/**
 * Hold every IPC call open until `release` is called, so a click can be doubled
 * without the second call resolving first. A run that makes several calls has
 * one open call per step, so all of them have to be released together.
 */
function holdInvoke() {
  const resolvers: (() => void)[] = [];
  invoke.mockImplementation(
    () =>
      new Promise((resolve) => {
        resolvers.push(() => resolve(null));
      }),
  );
  return async () => {
    // En kørsel åbner et nyt kald pr. trin, så alle skal slippes i rækkefølge.
    for (let step = 0; step < 10 && resolvers.length > 0; step++) {
      for (const resolve of resolvers.splice(0)) resolve();
      await Promise.resolve();
    }
  };
}

describe("enkelt-registreringer", () => {
  beforeEach(() => {
    invoke.mockReset();
    invoke.mockImplementation(() => Promise.resolve(null));
  });

  it("opretter præcis én registrering pr. kald", async () => {
    await expect(createTimeEntry(INPUT)).resolves.toBe(true);

    const entries = callsTo("create_time_entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].input).toEqual(INPUT);
  });

  it("registrerer ikke dobbelt tid, når der trykkes to gange", async () => {
    const release = holdInvoke();

    const first = createTimeEntry(INPUT);
    // React har ikke disablet knappen endnu, så det andre klik kommer med.
    await expect(createTimeEntry(INPUT)).resolves.toBe(false);
    await release();
    await expect(first).resolves.toBe(true);

    expect(callsTo("create_time_entry")).toHaveLength(1);
    expect(timeEntryCreateInFlight()).toBe(false);
  });

  it("låser op igen efter en fejl", async () => {
    invoke.mockImplementation(() =>
      Promise.reject(new Error("database locked")),
    );

    await expect(createTimeEntry(INPUT)).rejects.toThrow("database locked");
    expect(timeEntryCreateInFlight()).toBe(false);

    // En fejl må ikke låse registreringerne resten af sessionen.
    invoke.mockImplementation(() => Promise.resolve(null));
    await expect(createTimeEntry(INPUT)).resolves.toBe(true);
    // Den mislykkede plus genkaldet.
    expect(callsTo("create_time_entry")).toHaveLength(2);
  });

  it("deler låsen mellem formen, dialogen og rapporten", async () => {
    const release = holdInvoke();

    const form = createTimeEntry(INPUT);
    await expect(createTimeEntry(INPUT)).resolves.toBe(false);
    await release();
    await form;

    expect(callsTo("create_time_entry")).toHaveLength(1);
  });

  it("bekrefter aktiviteten og registrerer den som én enhed", async () => {
    const confirmed = await confirmActivityAsTimeEntry({
      activity: ACTIVITY,
      projectId: "p-1",
      category: "development",
      projects: [PROJECT],
    });

    expect(confirmed).toBe(true);
    expect(callsTo("confirm_classification")).toHaveLength(1);
    const entries = callsTo("create_time_entry");
    expect(entries).toHaveLength(1);
    expect(entries[0].input).toEqual({
      project_id: "p-1",
      client_id: "c-1",
      klippekort_id: null,
      description: "vscode - index.ts",
      start_time: ACTIVITY.started_at,
      end_time: ACTIVITY.ended_at,
      duration: ACTIVITY.duration,
      is_billable: true,
    });
  });

  it("klassificerer ikke to gange, når dialogen trykkes to gange", async () => {
    const release = holdInvoke();

    const first = confirmActivityAsTimeEntry({
      activity: ACTIVITY,
      projectId: "p-1",
      category: "development",
      projects: [PROJECT],
    });
    // Et gentaget klik, der kun nåede klassificeringen, ville efterlade
    // aktiviteten bekræftet uden at blive registreret.
    await expect(
      confirmActivityAsTimeEntry({
        activity: ACTIVITY,
        projectId: "p-1",
        category: "development",
        projects: [PROJECT],
      }),
    ).resolves.toBe(false);
    await release();
    await expect(first).resolves.toBe(true);

    expect(callsTo("confirm_classification")).toHaveLength(1);
    expect(callsTo("create_time_entry")).toHaveLength(1);
  });

  it("registrerer personlig tid som ikke-fakturerbar", async () => {
    await confirmActivityAsTimeEntry({
      activity: ACTIVITY,
      projectId: null,
      category: "personal",
      projects: [PROJECT],
    });

    const input = callsTo("create_time_entry")[0].input as TimeEntryInput;
    expect(input.is_billable).toBe(false);
    expect(input.client_id).toBeNull();
    expect(input.project_id).toBeNull();
  });
});

describe("dato og klokkeslæt", () => {
  /** Udpacker tidsstemplerne, ellers fejler assertionerne på union-typen. */
  function tidsrum(date: string, start: string, end: string) {
    const rå = resolveEntryTimes(date, start, end);
    if (!rå.ok) throw new Error(`uventet fejl: ${rå.error}`);
    return rå.times;
  }

  it("regulerer en almindelig vagt", () => {
    expect(tidsrum("2026-09-30", "09:00", "17:00")).toEqual({
      start_time: "2026-09-30T09:00:00",
      end_time: "2026-09-30T17:00:00",
      duration: 8 * 3600,
      crossesMidnight: false,
    });
  });

  it("ruller en nattevagt over midnat", () => {
    // 22:00 → 02:00 er fire timer, ikke minus tyve. Før denne rettelse
    // afviste formularen registreringen som "sluttid skal være efter starttid",
    // så en nattevagt ikke kunne registreres manuelt overhovedet.
    expect(tidsrum("2026-09-30", "22:00", "02:00")).toEqual({
      start_time: "2026-09-30T22:00:00",
      end_time: "2026-10-01T02:00:00",
      duration: 4 * 3600,
      crossesMidnight: true,
    });
  });

  it("ruller over måneds- og årsskift", () => {
    expect(tidsrum("2026-01-31", "23:00", "01:00").end_time).toBe(
      "2026-02-01T01:00:00",
    );
    expect(tidsrum("2026-12-31", "23:00", "01:00").end_time).toBe(
      "2027-01-01T01:00:00",
    );
  });

  it("regulerer skuddagsdatoen 29. februar", () => {
    expect(tidsrum("2028-02-29", "23:00", "01:00").end_time).toBe(
      "2028-03-01T01:00:00",
    );
  });

  it("regulerer en nattevagt hen over begge DST-skift", () => {
    // 29. marts og 25. oktober 2026 er de to sidste søndage i månederne, så det
    // er dér uret stilles. Tidsstemplerne er naive lokale væg-tid, som de altid
    // har været for den manuelle formular, så vagten skal stadig være fire timer
    // i begge retninger — det er denne test, der fanger en fremtidig
    // UTC-konvertering, der ville gøre den til tre eller fem.
    expect(tidsrum("2026-03-28", "22:00", "02:00").duration).toBe(4 * 3600);
    expect(tidsrum("2026-10-24", "22:00", "02:00").duration).toBe(4 * 3600);
  });

  it("afviser ligelige klokkeslæt", () => {
    expect(resolveEntryTimes("2026-09-30", "09:00", "09:00")).toEqual({
      ok: false,
      error: "endNotAfterStart",
    });
  });

  it("afviser manglende felter hver for sig", () => {
    expect(resolveEntryTimes("2026-09-30", "", "17:00").ok).toBe(false);
    expect(resolveEntryTimes("2026-09-30", "09:00", "").ok).toBe(false);
    expect(resolveEntryTimes("", "09:00", "17:00").ok).toBe(false);
  });
});

describe("kunde uden projekt", () => {
  beforeEach(() => {
    invoke.mockReset();
  });

  /** An activity the classifier billed to a customer but no project. */
  const CLIENT_ONLY: Activity = {
    ...ACTIVITY,
    id: 9,
    project_id: null,
    client_id: "c-9",
    window_title: "Opkaldsnotat",
  };

  it("beholder kunden fra aktiviteten når der ikke er noget projekt", async () => {
    await confirmActivityAsTimeEntry({
      activity: CLIENT_ONLY,
      projectId: null,
      category: "consulting",
      projects: [PROJECT],
    });

    const calls = invoke.mock.calls.filter((c) => c[0] === "create_time_entry");
    expect(calls).toHaveLength(1);
    expect((calls[0][1] as { input: TimeEntryInput }).input).toMatchObject({
      project_id: null,
      client_id: "c-9",
    });
  });

  it("lader projektets kunde vinde over aktivitetens egen", async () => {
    await confirmActivityAsTimeEntry({
      activity: CLIENT_ONLY,
      projectId: "p-1",
      category: "consulting",
      projects: [PROJECT],
    });

    const calls = invoke.mock.calls.filter((c) => c[0] === "create_time_entry");
    expect((calls[0][1] as { input: TimeEntryInput }).input).toMatchObject({
      project_id: "p-1",
      client_id: "c-1",
    });
  });

  it("giver kunden null når hverken projekt eller aktivitet kender en", async () => {
    const orphan: Activity = { ...ACTIVITY, project_id: null, client_id: null };

    await confirmActivityAsTimeEntry({
      activity: orphan,
      projectId: null,
      category: "consulting",
      projects: [PROJECT],
    });

    const calls = invoke.mock.calls.filter((c) => c[0] === "create_time_entry");
    expect(
      (calls[0][1] as { input: TimeEntryInput }).input.client_id,
    ).toBeNull();
  });

  // The billable customer must reach `confirm_classification` too, not only the
  // time entry: the backend learns a pattern from the confirmation, and a
  // pattern without a customer is a pattern that cannot classify anything.
  it("sender kunden med til bekræftelsen, så mønsteret kan lære den", async () => {
    await confirmActivityAsTimeEntry({
      activity: CLIENT_ONLY,
      projectId: null,
      category: "consulting",
      projects: [PROJECT],
    });

    const calls = invoke.mock.calls.filter(
      (c) => c[0] === "confirm_classification",
    );
    expect(calls[0][1]).toMatchObject({
      activityId: 9,
      projectId: null,
      clientId: "c-9",
    });
  });

  it("lader dialogens eget kundevalg vinde over aktivitetens", async () => {
    await confirmActivityAsTimeEntry({
      activity: CLIENT_ONLY,
      projectId: null,
      clientId: "c-valgt",
      category: "consulting",
      projects: [PROJECT],
    });

    const calls = invoke.mock.calls.filter(
      (c) => c[0] === "confirm_classification",
    );
    expect((calls[0][1] as { clientId: string | null }).clientId).toBe(
      "c-valgt",
    );
  });

  // "Eget arbejde" — a project with no customer — is a real shape, and the one
  // the customer-without-a-project feature creates demand for. The customer must
  // be cleared there, in BOTH writes: `create_time_entry` falls back to the
  // customer's own klippekort when a project-specific one is missing, and
  // `compute_coverage` takes COALESCE(p.client_id, a.client_id), so an inherited
  // customer is what actually gets billed.
  describe("projekt uden kunde", () => {
    const OWN_PROJECT: Project = {
      ...PROJECT,
      id: "p-eget",
      name: "Eget arbejde",
      client_id: null,
      client_name: null,
    };

    it("ryder kunden i stedet for at arve aktivitetens", async () => {
      await confirmActivityAsTimeEntry({
        activity: CLIENT_ONLY,
        projectId: "p-eget",
        category: "consulting",
        projects: [PROJECT, OWN_PROJECT],
      });

      const entries = invoke.mock.calls.filter(
        (c) => c[0] === "create_time_entry",
      );
      expect(entries[0][1]).toMatchObject({
        input: { project_id: "p-eget", client_id: null },
      });
    });

    // The backend learns a pattern from the confirmation, and
    // `classify_by_history` trusts the pattern's own customer over its
    // project's — so a stale customer here keeps being handed out for every
    // later activity that app and title matches.
    it("sender kunden til bekræftelsen ryddet, så mønsteret ikke lærer den", async () => {
      await confirmActivityAsTimeEntry({
        activity: CLIENT_ONLY,
        projectId: "p-eget",
        clientId: "c-9",
        category: "consulting",
        projects: [PROJECT, OWN_PROJECT],
      });

      const calls = invoke.mock.calls.filter(
        (c) => c[0] === "confirm_classification",
      );
      expect((calls[0][1] as { clientId: string | null }).clientId).toBeNull();
    });

    it("sender projektets egen kunde, når den har en", async () => {
      await confirmActivityAsTimeEntry({
        activity: CLIENT_ONLY,
        projectId: "p-1",
        category: "consulting",
        projects: [PROJECT, OWN_PROJECT],
      });

      const calls = invoke.mock.calls.filter(
        (c) => c[0] === "confirm_classification",
      );
      expect((calls[0][1] as { clientId: string | null }).clientId).toBe("c-1");
    });
  });

  // A project the list has not loaded yet must not clear the customer: the
  // frontend leaves it alone on that race (TimeEntryForm, TimerWidget), so the
  // entry has to agree or the two ends disagree about who is billed.
  it("beholder kunden, når projektet endnu ikke er indlæst", async () => {
    await confirmActivityAsTimeEntry({
      activity: CLIENT_ONLY,
      projectId: "p-ud-efter-navn",
      category: "consulting",
      projects: [PROJECT],
    });

    const entries = invoke.mock.calls.filter(
      (c) => c[0] === "create_time_entry",
    );
    expect((entries[0][1] as { input: TimeEntryInput }).input.client_id).toBe(
      "c-9",
    );
  });
});
