import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Outlook-synk: /me/calendarView ind i calendar_events via den fælles
 * planlægger (filtre, privatlivstilstand, aflysninger), med mocket Graph.
 */

const h = vi.hoisted(() => {
  const inserts: Record<string, unknown>[] = [];
  const updates: Record<string, unknown>[] = [];
  const claim = { rows: [{ id: "conn-o" }] as { id: string }[] };
  const db = {
    query: {
      calendarConnections: { findFirst: vi.fn() },
      calendarEvents: { findMany: vi.fn() },
    },
    insert: vi.fn(() => ({
      values: async (v: Record<string, unknown>) => {
        inserts.push(v);
      },
    })),
    update: vi.fn(() => ({
      set: (v: Record<string, unknown>) => {
        updates.push(v);
        const where = vi.fn(() => {
          const p = Promise.resolve(undefined) as Promise<undefined> & {
            returning: () => Promise<{ id: string }[]>;
          };
          p.returning = async () => claim.rows;
          return p;
        });
        return { where };
      },
    })),
    delete: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
  };
  return { db, inserts, updates, claim };
});
vi.mock("@/lib/db", () => ({ db: h.db }));

import { encryptSecret } from "@/lib/utils/encryption";
import {
  disconnectOutlook,
  type GraphEvent,
  mapGraphEvent,
  syncOutlookCalendar,
} from "../outlook-calendar";

const fetchMock = vi.fn();

function connection(overrides: Record<string, unknown> = {}) {
  return {
    id: "conn-o",
    userId: "user-1",
    organizationId: "org-1",
    provider: "outlook",
    oauthBrand: "timewren",
    accessToken: encryptSecret("graph-access"),
    refreshToken: encryptSecret("graph-refresh"),
    tokenExpiry: new Date(Date.now() + 3_600_000),
    grantedScopes: null,
    syncEnabled: true,
    syncError: null,
    syncFilters: null,
    privacyMode: "off",
    lastSynced: null,
    providerAccountId: "a@example.com",
    ...overrides,
  };
}

const meeting: GraphEvent = {
  id: "AAMk-1",
  subject: "Kundemøde",
  bodyPreview: "Agenda",
  location: { displayName: "Kontoret" },
  start: { dateTime: "2026-11-10T09:00:00.0000000", timeZone: "UTC" },
  end: { dateTime: "2026-11-10T10:00:00.0000000", timeZone: "UTC" },
  isAllDay: false,
  isCancelled: false,
  responseStatus: { response: "accepted" },
  changeKey: "ck-1",
};

function graphPages(pages: { value: GraphEvent[]; next?: string }[]) {
  let i = 0;
  fetchMock.mockImplementation(async () => {
    const page = pages[i++] ?? { value: [] };
    return new Response(
      JSON.stringify({
        value: page.value,
        ...(page.next && { "@odata.nextLink": page.next }),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
}

beforeEach(() => {
  vi.stubEnv("ENCRYPTION_KEY", "c".repeat(64));
  vi.stubEnv("TIMEWREN_MICROSOFT_CLIENT_ID", "tw-ms-id");
  vi.stubEnv("TIMEWREN_MICROSOFT_CLIENT_SECRET", "tw-ms-secret");
  vi.clearAllMocks();
  h.inserts.length = 0;
  h.updates.length = 0;
  h.claim.rows = [{ id: "conn-o" }];
  h.db.query.calendarConnections.findFirst.mockResolvedValue(connection());
  h.db.query.calendarEvents.findMany.mockResolvedValue([]);
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mapGraphEvent", () => {
  it("UTC-tider, svarstatus og changeKey", () => {
    expect(mapGraphEvent(meeting)).toMatchObject({
      externalId: "AAMk-1",
      title: "Kundemøde",
      location: "Kontoret",
      startTime: new Date("2026-11-10T09:00:00Z"),
      endTime: new Date("2026-11-10T10:00:00Z"),
      isAllDay: false,
      responseStatus: "accepted",
      etag: "ck-1",
    });
    expect(
      mapGraphEvent({
        ...meeting,
        responseStatus: { response: "tentativelyAccepted" },
      })?.responseStatus,
    ).toBe("tentative");
  });

  it("heldag som dato (UTC-midnat) og manglende felter afvises", () => {
    const allDay = mapGraphEvent({
      ...meeting,
      isAllDay: true,
      start: { dateTime: "2026-11-12T00:00:00.0000000", timeZone: "UTC" },
      end: { dateTime: "2026-11-13T00:00:00.0000000", timeZone: "UTC" },
    });
    expect(allDay?.startTime).toEqual(new Date("2026-11-12T00:00:00Z"));
    expect(allDay?.isAllDay).toBe(true);
    expect(mapGraphEvent({ ...meeting, id: undefined })).toBeNull();
    expect(mapGraphEvent({ ...meeting, start: null })).toBeNull();
    expect(mapGraphEvent({ ...meeting, id: "x".repeat(300) })).toBeNull();
  });
});

describe("syncOutlookCalendar", () => {
  it("henter calendarView med forbindelsens token og indsætter hændelser", async () => {
    graphPages([{ value: [meeting] }]);

    const result = await syncOutlookCalendar("user-1");

    expect(result).toMatchObject({ success: true, synced: 1, total: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toMatch(
      /^https:\/\/graph\.microsoft\.com\/v1\.0\/me\/calendarView\?/,
    );
    expect(init.headers.Authorization).toBe("Bearer graph-access");
    expect(init.headers.Prefer).toContain('outlook.timezone="UTC"');
    expect(h.inserts[0]).toMatchObject({
      userId: "user-1",
      organizationId: "org-1",
      calendarConnectionId: "conn-o",
      externalId: "AAMk-1",
      title: "Kundemøde",
      eventType: "external",
      syncDirection: "inbound",
    });
  });

  it("privatlivstilstand og synk-filtre gælder som for de andre udbydere", async () => {
    h.db.query.calendarConnections.findFirst.mockResolvedValue(
      connection({
        privacyMode: "mask_titles",
        syncFilters: { ignoreWords: ["frokost"] },
      }),
    );
    graphPages([
      {
        value: [
          meeting,
          { ...meeting, id: "AAMk-2", subject: "Frokost med Ole" },
        ],
      },
    ]);

    const result = await syncOutlookCalendar("user-1");

    expect(result).toMatchObject({ synced: 1, filtered: 1 });
    expect(h.inserts[0]).toMatchObject({
      title: "Optaget",
      description: null,
      location: null,
    });
  });

  it("aflyste og forsvundne hændelser markeres aflyst", async () => {
    h.db.query.calendarEvents.findMany.mockResolvedValue([
      {
        id: "ev-1",
        externalId: "AAMk-1",
        externalEtag: "ck-1",
        title: "Kundemøde",
        description: "Agenda",
        location: "Kontoret",
        startTime: new Date("2026-11-10T09:00:00Z"),
        endTime: new Date("2026-11-10T10:00:00Z"),
        isAllDay: false,
        responseStatus: "accepted",
        isCancelled: false,
      },
      {
        id: "ev-gone",
        externalId: "AAMk-gone",
        externalEtag: "x",
        title: "Slettet",
        description: null,
        location: null,
        startTime: new Date("2026-11-11T09:00:00Z"),
        endTime: new Date("2026-11-11T10:00:00Z"),
        isAllDay: false,
        responseStatus: null,
        isCancelled: false,
      },
    ]);
    graphPages([{ value: [{ ...meeting, isCancelled: true }] }]);

    const result = await syncOutlookCalendar("user-1");

    expect(result).toMatchObject({ success: true, deleted: 2, synced: 0 });
    expect(h.updates.filter((u) => u.isCancelled === true)).toHaveLength(2);
  });

  it("følger kun Graphs egne nextLinks (tokenet sendes ikke andre steder hen)", async () => {
    graphPages([
      {
        value: [meeting],
        next: "https://graph.microsoft.com/v1.0/me/calendarView?$skiptoken=2",
      },
      { value: [{ ...meeting, id: "AAMk-2" }], next: "https://evil.example/x" },
    ]);

    const result = await syncOutlookCalendar("user-1");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([u]) => new URL(String(u)).host)).toEqual([
      "graph.microsoft.com",
      "graph.microsoft.com",
    ]);
    expect(result).toMatchObject({ success: true, synced: 2 });
  });

  it("401 fra Graph: neutral fejl, token markeres udløbet, synk forbliver slået til", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 401 }));
    const result = await syncOutlookCalendar("user-1");
    expect(result.success).toBe(false);
    expect(result.error).not.toContain("reconnect");
    expect(h.inserts).toHaveLength(0);
    // Næste synk tvinger et refresh; invalid_grant slår så forbindelsen fra
    expect(h.updates).toContainEqual({ tokenExpiry: null });
    expect(h.updates.some((u) => u.syncEnabled === false)).toBe(false);
  });

  it("samtidig synk (ingen claim): springes over uden Graph-kald", async () => {
    h.claim.rows = [];
    const result = await syncOutlookCalendar("user-1");
    expect(result).toMatchObject({ success: true, incremental: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("ikke forbundet: fejl uden Graph-kald", async () => {
    h.db.query.calendarConnections.findFirst.mockResolvedValue(undefined);
    const result = await syncOutlookCalendar("user-1");
    expect(result.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("disconnectOutlook", () => {
  it("sletter forbindelsen (og dermed tokens)", async () => {
    await disconnectOutlook("user-1");
    expect(h.db.delete).toHaveBeenCalledTimes(1);
  });
});
