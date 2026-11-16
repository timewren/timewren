import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Kontrakttest for desktop-pullen. Formålet er at låse felt-formen fast:
// skrivebordsappen kan hverken vise eller sende en tidspost tilbage uden
// tidsstemplerne, og den parserer kun fulde ISO-instanter (et `YYYY-MM-DD`
// kan den ikke læse som tidspunkt).

const USER = "user-1";

const WITH_STAMPS = {
  id: "11111111-1111-1111-1111-111111111111",
  userId: USER,
  projectId: "p1",
  clientId: "c1",
  description: "Timer",
  hours: "2.50",
  date: new Date("2026-09-30T00:00:00.000Z"),
  startTime: new Date("2026-09-30T08:00:00.000Z"),
  endTime: new Date("2026-09-30T10:30:00.000Z"),
};

const WITHOUT_STAMPS = {
  id: "22222222-2222-2222-2222-222222222222",
  userId: USER,
  projectId: null,
  clientId: "c1",
  description: "Registreret i browseren",
  hours: "1.00",
  date: new Date("2026-09-29T00:00:00.000Z"),
  startTime: null,
  endTime: null,
};

const state = vi.hoisted(() => ({
  timeEntries: [] as Record<string, unknown>[],
  tombstones: [] as Record<string, unknown>[],
  clients: [] as Record<string, unknown>[],
}));

vi.mock("@/lib/desktop-auth", () => ({
  authenticateDevice: vi.fn(async () => ({
    userId: "user-1",
    deviceId: "device-1",
  })),
}));

vi.mock("@/lib/desktop-org", () => ({
  resolveDesktopOrgId: vi.fn(async () => "org-1"),
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const db = {
    update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
    select: () => ({
      from: (table: unknown) => ({
        where: () =>
          Promise.resolve(
            table === schema.timeEntries
              ? state.timeEntries
              : table === schema.desktopSyncTombstones
                ? state.tombstones
                : table === schema.clients
                  ? state.clients
                  : [],
          ),
      }),
    }),
  };
  return { db };
});

const { GET } = await import("./route");

// Ruten læser `since` på `request.nextUrl`, altså en rigtig NextRequest.
function request(since?: string): NextRequest {
  const url = new URL("https://app.timetrack.dk/api/desktop/sync/pull");
  if (since !== undefined) url.searchParams.set("since", since);
  return new NextRequest(url, {
    headers: { Authorization: "Bearer device-token" },
  });
}

interface PullEntity {
  type: string;
  action: string;
  data: Record<string, unknown>;
}

function timeEntriesOf(body: { entities: PullEntity[] }): PullEntity[] {
  return body.entities.filter((e) => e.type === "time_entry");
}

beforeEach(() => {
  state.timeEntries = [];
  state.tombstones = [];
  state.clients = [];
});

describe("GET /api/desktop/sync/pull", () => {
  it("sender ikke en gammel sletning efter genaktivering", async () => {
    state.clients = [{ id: "client-1", isArchived: false }];
    state.tombstones = [
      { entityType: "client", entityId: "client-1", userId: USER },
      { entityType: "client", entityId: "client-2", userId: USER },
      {
        entityType: "time_entry",
        entityId: "other-entry",
        userId: "colleague",
        organizationId: "org-1",
      },
    ];
    const body = await (await GET(request("2026-09-30T00:00:00Z"))).json();
    expect(
      body.entities.filter((e: PullEntity) => e.action === "delete"),
    ).toEqual([{ type: "client", action: "delete", data: { id: "client-2" } }]);
  });
  it("kræver since-parameteren", async () => {
    const res = await GET(request());
    expect(res.status).toBe(400);
  });

  it("afviser en ugyldig since-tidsstempel", async () => {
    const res = await GET(request("ikke-en-dato"));
    expect(res.status).toBe(400);
  });

  it("leverer tidsstempler for en post der har dem", async () => {
    state.timeEntries = [WITH_STAMPS];

    const res = await GET(request("2026-09-30T00:00:00.000Z"));
    const body = await res.json();

    const [entry] = timeEntriesOf(body);
    expect(entry.data.startTime).toBe("2026-09-30T08:00:00.000Z");
    expect(entry.data.endTime).toBe("2026-09-30T10:30:00.000Z");
    expect(entry.data.hours).toBe("2.50");
    expect(entry.data.date).toBe("2026-09-30T00:00:00.000Z");
  });

  it("leverer altid hours og date, også for en post uden tidsstempler", async () => {
    state.timeEntries = [WITHOUT_STAMPS];

    const res = await GET(request("2026-09-30T00:00:00.000Z"));
    const body = await res.json();

    const [entry] = timeEntriesOf(body);
    expect(entry.data.hours).toBe("1.00");
    // Appen læser `date` som et tidspunkt, så en dato uden klokkeslæt
    // kan den ikke bruge — den falder tilbage på createdAt.
    expect(String(entry.data.date)).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    expect(entry.data.startTime).toBeNull();
  });

  it("kalder en ny post en create og en ændret post en update", async () => {
    const since = new Date("2026-09-30T00:00:00.000Z");
    state.timeEntries = [
      { ...WITH_STAMPS, createdAt: new Date("2026-09-30T09:00:00.000Z") },
      {
        ...WITHOUT_STAMPS,
        createdAt: new Date("2026-09-01T09:00:00.000Z"),
        updatedAt: new Date("2026-09-30T11:00:00.000Z"),
      },
    ];

    const res = await GET(request(since.toISOString()));
    const body = await res.json();

    const actions = timeEntriesOf(body).map((e) => ({
      id: e.data.id,
      action: e.action,
    }));
    expect(actions).toEqual([
      { id: WITH_STAMPS.id, action: "create" },
      { id: WITHOUT_STAMPS.id, action: "update" },
    ]);
  });

  it("melder en slettet post som delete, så appen kan arkivere den lokalt", async () => {
    state.tombstones = [
      {
        entityType: "time_entry",
        entityId: WITHOUT_STAMPS.id,
        userId: USER,
        organizationId: "org-1",
      },
    ];

    const res = await GET(request("2026-09-30T00:00:00.000Z"));
    const body = await res.json();

    expect(body.entities).toContainEqual({
      type: "time_entry",
      action: "delete",
      data: { id: WITHOUT_STAMPS.id },
    });
  });
});
