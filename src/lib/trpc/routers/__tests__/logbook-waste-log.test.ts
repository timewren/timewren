import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

// Mock alt der åbner en DB-forbindelse ved import.
vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { logbookRouter } from "../logbook";

const ORG_ID = "org-1";
const ADMIN_ID = "admin-1";

type EntryRow = {
  id: string;
  userId: string;
  date: Date;
  startTime: Date | null;
  endTime: Date | null;
  hours: string;
  description: string | null;
  source: string | null;
  approvalStatus: string | null;
  project: { name: string; client: { name: string } | null } | null;
  client: { name: string } | null;
};

/**
 * Mock-db der dækker præcis de opslag wasteLog (og isAuthed/requireOrgAdmin
 * på vejen dertil) laver: medlemsrollen, medlemslisten, entries og segmenter.
 */
function makeDb(opts: {
  role: "owner" | "admin" | "member" | null;
  memberRows?: { userId: string; name: string | null; email: string | null }[];
  entries?: EntryRow[];
}) {
  const memberRows = opts.memberRows ?? [
    { userId: ADMIN_ID, name: "Admin Andersen", email: "admin@test.local" },
  ];
  return {
    query: {
      sessions: {
        findFirst: async () => ({ activeOrganizationId: ORG_ID }),
      },
      members: {
        findFirst: async () =>
          opts.role
            ? { id: "membership-1", role: opts.role, organizationId: ORG_ID }
            : undefined,
      },
      organizationModules: { findMany: async () => [] },
      timeEntries: { findMany: async () => opts.entries ?? [] },
      timeEntrySegments: { findMany: async () => [] },
    },
    select: () => ({
      from: () => ({
        innerJoin: () => ({
          where: async () => memberRows,
        }),
      }),
    }),
  } as never;
}

/** Som makeDb, men med en spion på entry-opslaget. */
function makeSpyDb(opts: Parameters<typeof makeDb>[0]) {
  const db = makeDb(opts) as unknown as {
    query: { timeEntries: { findMany: () => Promise<unknown[]> } };
  };
  const timeEntriesFindMany = vi.fn(async () => []);
  db.query.timeEntries.findMany = timeEntriesFindMany;
  return { db: db as never, timeEntriesFindMany };
}

function makeCaller(db: unknown) {
  return logbookRouter.createCaller({
    session: {
      user: { id: ADMIN_ID, email: "admin@test.local", name: "Admin" },
      activeOrganizationId: ORG_ID,
    },
    db,
    headers: null,
  } as never);
}

function entry(over: Partial<EntryRow> & Pick<EntryRow, "id">): EntryRow {
  return {
    userId: ADMIN_ID,
    date: new Date(2026, 7, 17),
    startTime: new Date(2026, 7, 17, 9, 0),
    endTime: new Date(2026, 7, 17, 10, 0),
    hours: "1",
    description: "Arbejde",
    source: "timer",
    approvalStatus: "approved",
    project: { name: "Web", client: { name: "Acme" } },
    client: null,
    ...over,
  };
}

const PERIOD = { from: "2026-08-17", to: "2026-08-23" };

describe("logbook.wasteLog — adgang", () => {
  it("afviser et menigt medlem med FORBIDDEN", async () => {
    const caller = makeCaller(makeDb({ role: "member" }));
    const err = await caller
      .wasteLog({ ...PERIOD, minGapMinutes: 15 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("afviser en bruger uden org (fjernet medlem) med FORBIDDEN", async () => {
    // Ingen medlemskab ⇒ isAuthed nulstiller orgId ⇒ ingen organisationsdata.
    const caller = makeCaller(
      makeDb({ role: null, entries: [entry({ id: "a" })] }),
    );
    const err = await caller
      .wasteLog({ ...PERIOD, minGapMinutes: 15 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });
  it("giver org-admin data", async () => {
    const caller = makeCaller(makeDb({ role: "admin" }));
    const res = await caller.wasteLog({ ...PERIOD, minGapMinutes: 15 });
    expect(res.minGapMinutes).toBe(15);
    expect(res.rows).toEqual([]);
    expect(res.totals).toEqual({
      gapMinutes: 0,
      gapCount: 0,
      untimedEntries: 0,
    });
  });

  it("afviser en periode hvor slut ligger før start", async () => {
    const caller = makeCaller(makeDb({ role: "owner" }));
    const err = await caller
      .wasteLog({ from: "2026-08-23", to: "2026-08-17", minGapMinutes: 15 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });
});

describe("logbook.wasteLog — periodens længde", () => {
  it("afviser en periode over et år, så hele org'en ikke hentes i hukommelsen", async () => {
    const { db, timeEntriesFindMany } = makeSpyDb({ role: "owner" });
    const err = await makeCaller(db)
      .wasteLog({ from: "2020-01-01", to: "2030-01-01", minGapMinutes: 15 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect((err as TRPCError).message).toContain("366 dage");
    // Vigtigst: forespørgslen må aldrig nå databasen.
    expect(timeEntriesFindMany).not.toHaveBeenCalled();
  });

  it("tillader præcis 366 dage", async () => {
    const caller = makeCaller(makeDb({ role: "owner" }));
    // 2026-01-01 → 2026-12-31 er 365 dage; +1 dag rammer grænsen præcist.
    await expect(
      caller.wasteLog({
        from: "2026-01-01",
        to: "2027-01-01",
        minGapMinutes: 15,
      }),
    ).resolves.toBeDefined();
  });

  it("afviser 367 dage", async () => {
    const caller = makeCaller(makeDb({ role: "owner" }));
    const err = await caller
      .wasteLog({ from: "2026-01-01", to: "2027-01-02", minGapMinutes: 15 })
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
  });
});

describe("logbook.wasteLog — data", () => {
  it("summerer pauser pr. bruger og pr. dag over tærsklen", async () => {
    const db = makeDb({
      role: "owner",
      entries: [
        entry({
          id: "a",
          startTime: new Date(2026, 7, 17, 9, 0),
          endTime: new Date(2026, 7, 17, 10, 0),
        }),
        // 6 min hul — under tærsklen på 15
        entry({
          id: "b",
          startTime: new Date(2026, 7, 17, 10, 6),
          endTime: new Date(2026, 7, 17, 11, 0),
        }),
        // 60 min hul — tæller
        entry({
          id: "c",
          startTime: new Date(2026, 7, 17, 12, 0),
          endTime: new Date(2026, 7, 17, 13, 0),
        }),
      ],
    });
    const res = await makeCaller(db).wasteLog({ ...PERIOD, minGapMinutes: 15 });

    expect(res.totals.gapMinutes).toBe(60);
    expect(res.totals.gapCount).toBe(1);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0].userId).toBe(ADMIN_ID);
    expect(res.rows[0].date).toBe("2026-08-17");
    expect(res.rows[0].gapMinutes).toBe(60);
    expect(res.rows[0].afterEntry?.projectName).toBe("Web");
    expect(res.byDay).toEqual([
      { date: "2026-08-17", gapMinutes: 60, gapCount: 1 },
    ]);
    expect(res.byUser[0].gapMinutes).toBe(60);
  });

  it("udelader afviste registreringer og deres pauser", async () => {
    const db = makeDb({
      role: "owner",
      entries: [
        entry({
          id: "a",
          startTime: new Date(2026, 7, 17, 9, 0),
          endTime: new Date(2026, 7, 17, 10, 0),
        }),
        entry({
          id: "afvist",
          approvalStatus: "rejected",
          startTime: new Date(2026, 7, 17, 11, 0),
          endTime: new Date(2026, 7, 17, 12, 0),
        }),
      ],
    });
    const res = await makeCaller(db).wasteLog({ ...PERIOD, minGapMinutes: 15 });
    expect(res.totals.gapMinutes).toBe(0);
    expect(res.rows).toEqual([]);
  });

  it("tæller registreringer uden tidspunkter, så totalen ikke lyver", async () => {
    const db = makeDb({
      role: "owner",
      entries: [
        entry({ id: "a", startTime: null, endTime: null, hours: "7.5" }),
      ],
    });
    const res = await makeCaller(db).wasteLog({ ...PERIOD, minGapMinutes: 15 });
    expect(res.totals.gapMinutes).toBe(0);
    expect(res.totals.untimedEntries).toBe(1);
    expect(res.byUser[0].untimedEntries).toBe(1);
  });

  it("holder to medarbejderes pauser adskilt", async () => {
    const db = makeDb({
      role: "owner",
      memberRows: [
        { userId: ADMIN_ID, name: "Admin Andersen", email: null },
        { userId: "user-2", name: "Bodil Bruun", email: null },
      ],
      entries: [
        entry({
          id: "a1",
          startTime: new Date(2026, 7, 17, 9, 0),
          endTime: new Date(2026, 7, 17, 10, 0),
        }),
        entry({
          id: "a2",
          startTime: new Date(2026, 7, 17, 11, 0),
          endTime: new Date(2026, 7, 17, 12, 0),
        }),
        entry({
          id: "b1",
          userId: "user-2",
          startTime: new Date(2026, 7, 17, 9, 0),
          endTime: new Date(2026, 7, 17, 10, 0),
        }),
        entry({
          id: "b2",
          userId: "user-2",
          startTime: new Date(2026, 7, 17, 12, 0),
          endTime: new Date(2026, 7, 17, 13, 0),
        }),
      ],
    });
    const res = await makeCaller(db).wasteLog({ ...PERIOD, minGapMinutes: 15 });
    // Sorteret faldende på spildtid: Bodil har 120 min, Admin 60.
    expect(res.byUser.map((u) => [u.userName, u.gapMinutes])).toEqual([
      ["Bodil Bruun", 120],
      ["Admin Andersen", 60],
    ]);
    expect(res.totals.gapMinutes).toBe(180);
    expect(res.totals.gapCount).toBe(2);
  });
});
