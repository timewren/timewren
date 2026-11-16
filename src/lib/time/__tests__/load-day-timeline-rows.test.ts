import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

// Prædikaterne er drizzle-SQL-objekter og kan ikke inspiceres meningsfuldt.
// I stedet spionerer vi på selve byggeklodserne, så testen kan bevise AT
// bruger-filteret altid er med — også i solo-grenen uden org.
const inArraySpy = vi.fn();
const eqSpy = vi.fn();
const isNullSpy = vi.fn();
vi.mock("drizzle-orm", async (importOriginal) => {
  const actual = await importOriginal<typeof import("drizzle-orm")>();
  return {
    ...actual,
    inArray: (...args: unknown[]) => {
      inArraySpy(...args);
      return (actual.inArray as (...a: never[]) => unknown)(
        ...(args as never[]),
      );
    },
    eq: (...args: unknown[]) => {
      eqSpy(...args);
      return (actual.eq as (...a: never[]) => unknown)(...(args as never[]));
    },
    isNull: (...args: unknown[]) => {
      isNullSpy(...args);
      return (actual.isNull as (...a: never[]) => unknown)(
        ...(args as never[]),
      );
    },
  };
});

import { timeEntries } from "@/lib/db/schema";
import { loadDayTimelineRows } from "../day-timeline";

type EntryQueryArgs = { where?: unknown; columns?: unknown };

function makeDb(rows: unknown[], segments: unknown[] = []) {
  const timeEntriesFindMany = vi.fn(async (_args: EntryQueryArgs) => rows);
  const segmentsFindMany = vi.fn(async () => segments);
  return {
    db: {
      query: {
        timeEntries: { findMany: timeEntriesFindMany },
        timeEntrySegments: { findMany: segmentsFindMany },
      },
    } as never,
    timeEntriesFindMany,
    segmentsFindMany,
  };
}

function row(over: Record<string, unknown> = {}) {
  return {
    id: "e1",
    userId: "user-1",
    date: new Date(2026, 7, 17),
    startTime: new Date(2026, 7, 17, 9, 0),
    endTime: new Date(2026, 7, 17, 10, 0),
    hours: "1",
    description: "Arbejde",
    source: "timer",
    approvalStatus: "approved",
    project: { name: "Web", client: { name: "Projektets kunde" } },
    client: null,
    ...over,
  };
}

const PERIOD = { from: new Date(2026, 7, 17), to: new Date(2026, 7, 23) };

beforeEach(() => {
  inArraySpy.mockClear();
  eqSpy.mockClear();
  isNullSpy.mockClear();
});

describe("loadDayTimelineRows", () => {
  it("rammer slet ikke databasen uden brugere", async () => {
    const { db, timeEntriesFindMany, segmentsFindMany } = makeDb([]);
    const res = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: [],
      ...PERIOD,
    });
    expect(res).toEqual({ entries: [], segments: [] });
    expect(timeEntriesFindMany).not.toHaveBeenCalled();
    expect(segmentsFindMany).not.toHaveBeenCalled();
  });

  it("afgrænser altid på userIds — også i org-grenen", async () => {
    const { db } = makeDb([]);
    await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1", "user-2"],
      ...PERIOD,
    });
    expect(inArraySpy).toHaveBeenCalledWith(timeEntries.userId, [
      "user-1",
      "user-2",
    ]);
  });

  it("afgrænser på userIds når der ingen org er (solo-brugere)", async () => {
    const { db } = makeDb([]);
    await loadDayTimelineRows(db, {
      orgId: null,
      userIds: ["user-1"],
      ...PERIOD,
    });
    // Uden org findes der intet org-prædikat — så brugerfilteret er den
    // eneste afgrænsning og SKAL være der.
    expect(inArraySpy).toHaveBeenCalledWith(timeEntries.userId, ["user-1"]);
    expect(eqSpy).not.toHaveBeenCalledWith(
      timeEntries.organizationId,
      expect.anything(),
    );
  });

  it("medtager legacy-poster uden organization_id i org-grenen", async () => {
    const { db } = makeDb([]);
    await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    // #445: poster fra før multi-tenant har organization_id = NULL og
    // tilhører stadig ejeren. Et strengt eq() ville tabe dem, og en
    // manglende postering ser ud som spildtid.
    expect(eqSpy).toHaveBeenCalledWith(timeEntries.organizationId, "org-1");
    expect(isNullSpy).toHaveBeenCalledWith(timeEntries.organizationId);
  });

  it("henter approvalStatus og source, så kernens options kan virke", async () => {
    const { db, timeEntriesFindMany } = makeDb([]);
    await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    const columns = (
      timeEntriesFindMany.mock.calls[0][0] as {
        columns: Record<string, boolean>;
      }
    ).columns;
    expect(columns.approvalStatus).toBe(true);
    expect(columns.source).toBe(true);
    expect(columns.userId).toBe(true);
  });

  it("mapper entry-rækker til kernens format", async () => {
    const { db } = makeDb([row()]);
    const { entries } = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id: "e1",
      userId: "user-1",
      hours: "1",
      source: "timer",
      approvalStatus: "approved",
      projectName: "Web",
    });
  });

  it("foretrækker entryens egen klient over projektets klient", async () => {
    const { db } = makeDb([row({ client: { name: "Direkte kunde" } })]);
    const { entries } = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(entries[0].clientName).toBe("Direkte kunde");
  });

  it("falder tilbage til projektets klient når entryen ikke har en", async () => {
    const { db } = makeDb([row()]);
    const { entries } = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(entries[0].clientName).toBe("Projektets kunde");
  });

  it("giver null som klientnavn for intern tid uden projekt", async () => {
    const { db } = makeDb([row({ project: null, client: null })]);
    const { entries } = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(entries[0].clientName).toBeNull();
    expect(entries[0].projectName).toBeNull();
  });

  it("springer segment-opslaget over når der ingen entries er", async () => {
    const { db, segmentsFindMany } = makeDb([]);
    await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(segmentsFindMany).not.toHaveBeenCalled();
  });

  it("henter segmenterne for de fundne entries", async () => {
    const segment = {
      timeEntryId: "e1",
      startTime: new Date(2026, 7, 17, 9, 0),
      endTime: new Date(2026, 7, 17, 10, 0),
      durationMinutes: 60,
    };
    const { db, segmentsFindMany } = makeDb([row()], [segment]);
    const { segments } = await loadDayTimelineRows(db, {
      orgId: "org-1",
      userIds: ["user-1"],
      ...PERIOD,
    });
    expect(segmentsFindMany).toHaveBeenCalledTimes(1);
    expect(segments).toEqual([segment]);
  });
});
