import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();

vi.mock("@/lib/tauri", () => ({
  tauriInvoke: (...args: unknown[]) => invoke(...args),
}));

import {
  bulkAssignProject,
  bulkConfirmActivities,
  bulkDelete,
  bulkMarkNonBillable,
  bulkRunInFlight,
  kunFejlede,
} from "../bulkActions";
import type { Activity, Project } from "../types";

let nextId = 1;

function makeActivity(overrides: Partial<Activity> = {}): Activity {
  const id = overrides.id ?? nextId++;
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
    started_at: "2026-09-29T09:00:00",
    ended_at: "2026-09-29T09:30:00",
    duration: 1800,
    ...overrides,
  };
}

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

const ACTIVITIES = [makeActivity(), makeActivity(), makeActivity()];
const IDS = ACTIVITIES.map((a) => a.id);

function callsTo(cmd: string): Record<string, unknown>[] {
  return invoke.mock.calls
    .filter((call) => call[0] === cmd)
    .map((call) => (call[1] ?? {}) as Record<string, unknown>);
}

describe("bulk-handlinger", () => {
  beforeEach(() => {
    nextId = 1;
    invoke.mockReset();
    invoke.mockImplementation(() => Promise.resolve(null));
  });

  it("opretter præcis én registrering pr. aktivitet", async () => {
    await bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id);

    expect(callsTo("create_time_entry")).toHaveLength(3);
    expect(
      callsTo("create_time_entry").map(
        (args) => (args.input as { start_time: string }).start_time,
      ),
    ).toEqual(ACTIVITIES.map((a) => a.started_at));
    expect(
      callsTo("confirm_classification").map((args) => args.activityId),
    ).toEqual(IDS);
  });

  it("springer aktiviteter over, der ikke længere findes", async () => {
    await bulkAssignProject([...IDS, 999], ACTIVITIES, [PROJECT], PROJECT.id);

    expect(callsTo("create_time_entry")).toHaveLength(3);
  });

  it("registrerer ikke dobbelt tid, når den kaldes to gange i træk", async () => {
    const [first, second] = await Promise.all([
      bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id),
      bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id),
    ]);

    // Den anden kørsel er en no-op, så der er tre registreringer — ikke seks.
    expect([first.kørte, second.kørte]).toEqual([true, false]);
    expect(callsTo("create_time_entry")).toHaveLength(3);
  });

  it("sletter ikke to gange, når den kaldes to gange i træk", async () => {
    await Promise.all([bulkDelete(IDS), bulkDelete(IDS)]);

    expect(callsTo("delete_activity").map((args) => args.activityId)).toEqual(
      IDS,
    );
  });

  it("låser også de øvrige operationer", async () => {
    // Sletning og tildeling skriver de samme aktiviteter, så de må ikke køre
    // sideløbende med hinanden.
    await Promise.all([
      bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id),
      bulkDelete(IDS),
      bulkMarkNonBillable(IDS, ACTIVITIES),
    ]);

    expect(callsTo("delete_activity")).toHaveLength(0);
    expect(callsTo("confirm_classification")).toHaveLength(3);
  });

  it("markerer ikke-fakturerbar uden at oprette registreringer", async () => {
    await bulkMarkNonBillable(IDS, ACTIVITIES);

    expect(
      callsTo("confirm_classification").map((args) => args.category),
    ).toEqual(["personal", "personal", "personal"]);
    expect(callsTo("create_time_entry")).toHaveLength(0);
  });

  it("låser op igen efter en fejl", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "create_time_entry"
        ? Promise.reject(new Error("database locked"))
        : Promise.resolve(null),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const fejlet = await bulkAssignProject(
      IDS,
      ACTIVITIES,
      [PROJECT],
      PROJECT.id,
    );
    expect(fejlet).toEqual({ kørte: true, fejlede: IDS });
    expect(bulkRunInFlight()).toBe(false);

    // En fejl må ikke låse bulk-handlingerne resten af sessionen.
    invoke.mockImplementation(() => Promise.resolve(null));
    await bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id);
    expect(bulkRunInFlight()).toBe(false);
    consoleError.mockRestore();
  });

  it("bekræfter en batch og registrerer præcis én gang pr. aktivitet", async () => {
    const confirmed = ACTIVITIES.map((a) => ({
      ...a,
      project_id: PROJECT.id,
      category: "development",
    }));

    await bulkConfirmActivities(confirmed, [PROJECT]);

    expect(callsTo("bulk_confirm_classifications")).toHaveLength(1);
    expect(
      (
        callsTo("bulk_confirm_classifications")[0].items as {
          activity_id: number;
        }[]
      ).map((item) => item.activity_id),
    ).toEqual(IDS);
    const entries = callsTo("create_time_entry");
    expect(entries).toHaveLength(3);
    expect(
      entries.map((args) => (args.input as { start_time: string }).start_time),
    ).toEqual(confirmed.map((a) => a.started_at));
    expect(
      entries.map((args) => (args.input as { client_id: string }).client_id),
    ).toEqual(["c-1", "c-1", "c-1"]);
  });

  // The batch confirmation is what teaches the pattern layer, so an activity
  // belonging to a customer without a project must carry that customer into the
  // bulk call — otherwise the learned pattern names nobody and the next session
  // classifies the same window to nobody again.
  it("sender hver aktivitets egen kunde med i batch-bekræftelsen", async () => {
    const clientOnly = ACTIVITIES.map((a) => ({
      ...a,
      project_id: null,
      client_id: "c-9",
    }));

    await bulkConfirmActivities(clientOnly, [PROJECT]);

    const items = callsTo("bulk_confirm_classifications")[0].items as {
      project_id: string | null;
      client_id: string | null;
    }[];
    expect(items.map((i) => [i.project_id, i.client_id])).toEqual(
      clientOnly.map(() => [null, "c-9"]),
    );
  });

  it("registrerer ikke dobbelt tid, når Bekræft alle trykkes to gange", async () => {
    const [first, second] = await Promise.all([
      bulkConfirmActivities(ACTIVITIES, [PROJECT]),
      bulkConfirmActivities(ACTIVITIES, [PROJECT]),
    ]);

    expect([first.kørte, second.kørte]).toEqual([true, false]);
    expect(callsTo("create_time_entry")).toHaveLength(3);
  });

  it("låser batch-bekræftelsen sammen med de øvrige bulk-handlinger", async () => {
    // "Bekræft alle" og tildel-projekt skriver de samme aktiviteter.
    await Promise.all([
      bulkConfirmActivities(ACTIVITIES, [PROJECT]),
      bulkAssignProject(IDS, ACTIVITIES, [PROJECT], PROJECT.id),
    ]);

    expect(callsTo("create_time_entry")).toHaveLength(3);
  });

  it("låser op igen efter en fejl i batch-bekræftelsen", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "create_time_entry"
        ? Promise.reject(new Error("database locked"))
        : Promise.resolve(null),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const fejlet = await bulkConfirmActivities(ACTIVITIES, [PROJECT]);
    expect(fejlet).toEqual({ kørte: true, fejlede: IDS });
    expect(bulkRunInFlight()).toBe(false);

    invoke.mockImplementation(() => Promise.resolve(null));
    await bulkConfirmActivities(ACTIVITIES, [PROJECT]);
    expect(bulkRunInFlight()).toBe(false);
    // De tre mislykkede forsøg plus hele genkaldet.
    expect(callsTo("create_time_entry")).toHaveLength(6);
    consoleError.mockRestore();
  });

  // En kørsl går én aktivitet ad gangen, så den tredje af tre kan fejle, mens de
  // to første er skrevet. Da må den ikke opgive resten — og den skal kunne sige
  // hvilke den ikke fik skrevet, ellers ved skærmen intet.
  it("fortsætter efter en fejl og melder præcis de fejlede", async () => {
    let oprettede = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "create_time_entry") {
        oprettede += 1;
        return oprettede === 2
          ? Promise.reject(new Error("database locked"))
          : Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const resultat = await bulkAssignProject(
      IDS,
      ACTIVITIES,
      [PROJECT],
      PROJECT.id,
    );

    // Alle tre blev forsøgt — den tredje fik også sin registrering.
    expect(callsTo("create_time_entry")).toHaveLength(3);
    expect(resultat).toEqual({ kørte: true, fejlede: [ACTIVITIES[1].id] });
    consoleError.mockRestore();
  });

  it("melder alle som fejlede, når selve bekræftelsen falder", async () => {
    invoke.mockImplementation((cmd: string) =>
      cmd === "bulk_confirm_classifications"
        ? Promise.reject(new Error("database locked"))
        : Promise.resolve(null),
    );
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const resultat = await bulkConfirmActivities(ACTIVITIES, [PROJECT]);

    // Bekræftelsen er én skrivning: fejler den, er ingen bekræftet, så alle skal
    // stå tilbage — og ingen må have fået en registrering.
    expect(resultat).toEqual({ kørte: true, fejlede: IDS });
    expect(callsTo("create_time_entry")).toHaveLength(0);
    consoleError.mockRestore();
  });

  it("melder kun den slettede, der fejlede", async () => {
    let kald = 0;
    invoke.mockImplementation((cmd: string) => {
      if (cmd === "delete_activity") {
        kald += 1;
        return kald === 3
          ? Promise.reject(new Error("database locked"))
          : Promise.resolve(null);
      }
      return Promise.resolve(null);
    });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    const resultat = await bulkDelete(IDS);

    expect(resultat).toEqual({ kørte: true, fejlede: [ACTIVITIES[2].id] });
    consoleError.mockRestore();
  });

  it("beholder kun de id'er, kørslen fejlede, som stadig findes", () => {
    expect(kunFejlede([1, 2, 999], ACTIVITIES)).toEqual(new Set([1, 2]));
    expect(kunFejlede([], ACTIVITIES)).toEqual(new Set());
  });

  it("beholder de fejlede, også når de er bekræftede i databasen", () => {
    // En bekræftet aktivitet uden registrering er stadig tabt tid: den skal
    // kunne vælges igen, så valget dømmes ikke efter `is_confirmed`.
    const bekræftetUdenRegistrering = ACTIVITIES.map((a) => ({
      ...a,
      is_confirmed: true,
      project_id: PROJECT.id,
    }));

    expect(kunFejlede(IDS, bekræftetUdenRegistrering)).toEqual(new Set(IDS));
  });
});
