import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock modules that trigger DB connection on import
vi.mock("@/lib/db", () => ({
  db: {},
}));
vi.mock("@/lib/permissions/server", () => ({
  canViewAllOrgTime: vi.fn(),
}));

import { canViewAllOrgTime } from "@/lib/permissions/server";
import {
  assertDayDetailAccess,
  buildDayDetails,
  type DayDetailEntryRow,
  type DayDetailSegmentRow,
} from "../logbook";

const mockCanViewAllOrgTime = vi.mocked(canViewAllOrgTime);

/** Mock-db der kun understøtter member-opslaget i assertDayDetailAccess. */
function makeDb(memberRows: Array<{ userId: string }>) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(memberRows),
        }),
      }),
    }),
  } as never;
}

// =============================================
// assertDayDetailAccess — adgangskontrol
// =============================================
describe("assertDayDetailAccess", () => {
  beforeEach(() => {
    mockCanViewAllOrgTime.mockReset();
  });

  it("tillader altid at se sin egen logbog", async () => {
    await expect(
      assertDayDetailAccess(makeDb([]), "org-1", "user-1", "user-1"),
    ).resolves.toBeUndefined();
    expect(mockCanViewAllOrgTime).not.toHaveBeenCalled();
  });

  it("afviser menigt medlem der vil se en anden bruger", async () => {
    mockCanViewAllOrgTime.mockResolvedValue(false);
    const err = await assertDayDetailAccess(
      makeDb([{ userId: "user-2" }]),
      "org-1",
      "user-1",
      "user-2",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("afviser solo-bruger (ingen org) der vil se en anden bruger", async () => {
    // canViewAllOrgTime returnerer true for solo-brugere, men uden org
    // findes der ingen andre at se — kun egen logbog er tilladt.
    mockCanViewAllOrgTime.mockResolvedValue(true);
    const err = await assertDayDetailAccess(
      makeDb([{ userId: "user-2" }]),
      null,
      "user-1",
      "user-2",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });

  it("tillader org-admin at se et medlem af samme org", async () => {
    mockCanViewAllOrgTime.mockResolvedValue(true);
    await expect(
      assertDayDetailAccess(
        makeDb([{ userId: "user-2" }]),
        "org-1",
        "admin-1",
        "user-2",
      ),
    ).resolves.toBeUndefined();
  });

  it("afviser org-admin når target ikke er medlem af org'en", async () => {
    mockCanViewAllOrgTime.mockResolvedValue(true);
    const err = await assertDayDetailAccess(
      makeDb([]),
      "org-1",
      "admin-1",
      "fremmed-bruger",
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect((err as TRPCError).code).toBe("FORBIDDEN");
  });
});

// =============================================
// buildDayDetails — segment-udfoldning + gaps
// =============================================
function makeEntry(over: Partial<DayDetailEntryRow> = {}): DayDetailEntryRow {
  return {
    id: "entry-1",
    date: new Date(2026, 7, 17), // mandag 17/8
    startTime: new Date(2026, 7, 17, 9, 0),
    endTime: new Date(2026, 7, 17, 11, 30),
    hours: "2.50",
    description: "Udvikling",
    source: "manual",
    projectName: "Web",
    clientName: "Acme",
    ...over,
  };
}

describe("buildDayDetails", () => {
  it("folder segmenter ud som intervaller i stedet for entryens egen start/slut", () => {
    const entry = makeEntry({
      startTime: new Date(2026, 7, 17, 9, 0),
      endTime: new Date(2026, 7, 17, 16, 0),
      hours: "4.50",
    });
    const segments: DayDetailSegmentRow[] = [
      {
        timeEntryId: "entry-1",
        startTime: new Date(2026, 7, 17, 14, 0),
        endTime: new Date(2026, 7, 17, 16, 0),
        durationMinutes: 120,
      },
      {
        timeEntryId: "entry-1",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 30),
        durationMinutes: 150,
      },
    ];

    const days = buildDayDetails([entry], segments);
    expect(days).toHaveLength(1);
    expect(days[0].intervals).toHaveLength(2);
    // Sorteret på start — segmentet 9:00-11:30 først
    expect(days[0].intervals[0].start).toBe(
      new Date(2026, 7, 17, 9, 0).toISOString(),
    );
    expect(days[0].intervals[0].hours).toBeCloseTo(2.5);
    expect(days[0].intervals[1].hours).toBeCloseTo(2);
    expect(days[0].intervals.every((iv) => iv.hasTimestamps)).toBe(true);
    expect(days[0].totalHours).toBeCloseTo(4.5);
  });

  it("dagstotal er summen af entries' hours, ikke afrundede segment-timer", () => {
    // Tre 50-min-segmenter: round2(50/60)*3 = 2,49 — men entryens hours er
    // 2,50, og det er det samme tal ugematrixens celle viser.
    const entry = makeEntry({ hours: "2.50" });
    const segments: DayDetailSegmentRow[] = [0, 1, 2].map((i) => ({
      timeEntryId: "entry-1",
      startTime: new Date(2026, 7, 17, 9 + i, 0),
      endTime: new Date(2026, 7, 17, 9 + i, 50),
      durationMinutes: 50,
    }));

    const days = buildDayDetails([entry], segments);
    expect(days[0].intervals.map((iv) => iv.hours)).toEqual([0.83, 0.83, 0.83]);
    expect(days[0].totalHours).toBe(2.5);
  });

  it("beregner pauser (gaps) mellem tidsstemplede intervaller", () => {
    const entries = [
      makeEntry({
        id: "e1",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 30),
        hours: "2.50",
      }),
      makeEntry({
        id: "e2",
        startTime: new Date(2026, 7, 17, 12, 15),
        endTime: new Date(2026, 7, 17, 16, 0),
        hours: "3.75",
      }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days[0].gaps).toEqual([{ afterIndex: 0, minutes: 45 }]);
    expect(days[0].totalHours).toBeCloseTo(6.25);
  });

  it("giver ingen gap ved sammenhængende eller overlappende intervaller", () => {
    const entries = [
      makeEntry({
        id: "e1",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 12, 0),
        hours: "3.00",
      }),
      makeEntry({
        id: "e2",
        startTime: new Date(2026, 7, 17, 11, 30),
        endTime: new Date(2026, 7, 17, 14, 0),
        hours: "2.50",
      }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days[0].gaps).toEqual([]);
  });

  it("giver ingen falsk pause når et langt interval dækker de senere", () => {
    // 09-13 dækker både 09:30-10 og 10:30-12 — parvis nabo-sammenligning
    // ville ellers opfinde en "30 min pause" mellem 10:00 og 10:30.
    const entries = [
      makeEntry({
        id: "lang",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 13, 0),
        hours: "4.00",
      }),
      makeEntry({
        id: "kort1",
        startTime: new Date(2026, 7, 17, 9, 30),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "0.50",
      }),
      makeEntry({
        id: "kort2",
        startTime: new Date(2026, 7, 17, 10, 30),
        endTime: new Date(2026, 7, 17, 12, 0),
        hours: "1.50",
      }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days[0].gaps).toEqual([]);
  });

  it("beregner pause fra løbende maxEnd, ikke fra forrige intervals slut", () => {
    // 09-13, 09:30-10, 14-15: pausen er 13-14 (60 min). Den hører til efter
    // interval 0 (09-13), som ejer det dækkede spans slut på 13:00 — ikke
    // efter interval 1 (09:30-10), der ligger inde i det og slutter 10:00.
    const entries = [
      makeEntry({
        id: "lang",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 13, 0),
        hours: "4.00",
      }),
      makeEntry({
        id: "indlejret",
        startTime: new Date(2026, 7, 17, 9, 30),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "0.50",
      }),
      makeEntry({
        id: "senere",
        startTime: new Date(2026, 7, 17, 14, 0),
        endTime: new Date(2026, 7, 17, 15, 0),
        hours: "1.00",
      }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days[0].gaps).toEqual([{ afterIndex: 0, minutes: 60 }]);
  });

  it("medtager intervaller uden tidspunkter sidst, uden gap-deltagelse", () => {
    const entries = [
      makeEntry({
        id: "manuel",
        startTime: null,
        endTime: null,
        hours: "3.60",
        description: "Import fra regneark",
        source: "import",
      }),
      makeEntry({
        id: "e1",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 0),
        hours: "2.00",
      }),
      makeEntry({
        id: "e2",
        startTime: new Date(2026, 7, 17, 13, 0),
        endTime: new Date(2026, 7, 17, 15, 0),
        hours: "2.00",
      }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days[0].intervals).toHaveLength(3);
    // Uden tidspunkt sorteres sidst
    const last = days[0].intervals[2];
    expect(last.hasTimestamps).toBe(false);
    expect(last.start).toBeNull();
    expect(last.hours).toBeCloseTo(3.6);
    // Gap kun mellem de to tidsstemplede (2 timers pause 11-13);
    // afterIndex peger på intervallet FØR pausen (9-11 = index 0)
    expect(days[0].gaps).toEqual([{ afterIndex: 0, minutes: 120 }]);
    expect(days[0].totalHours).toBeCloseTo(7.6);
  });

  it("grupperer pr. dag og sorterer dagene kronologisk", () => {
    const entries = [
      makeEntry({
        id: "tirsdag",
        date: new Date(2026, 7, 18),
        startTime: new Date(2026, 7, 18, 10, 0),
        endTime: new Date(2026, 7, 18, 12, 0),
        hours: "2.00",
      }),
      makeEntry({ id: "mandag" }),
    ];

    const days = buildDayDetails(entries, []);
    expect(days.map((d) => d.date)).toEqual(["2026-08-17", "2026-08-18"]);
  });

  it("markerer timer-entry uden segmenter som syntetisk", () => {
    const days = buildDayDetails([makeEntry({ source: "timer" })], []);
    expect(days[0].intervals[0].source).toBe("timer");
    expect(days[0].intervals[0].hasTimestamps).toBe(true);
    expect(days[0].intervals[0].synthetic).toBe(true);
  });

  it("markerer IKKE segment-intervaller som syntetiske, selv ved source timer", () => {
    const entry = makeEntry({ source: "timer" });
    const segments: DayDetailSegmentRow[] = [
      {
        timeEntryId: "entry-1",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 30),
        durationMinutes: 150,
      },
    ];
    const days = buildDayDetails([entry], segments);
    expect(days[0].intervals[0].synthetic).toBe(false);
  });

  it("markerer ikke manuelle eller utidsstemplede entries som syntetiske", () => {
    const days = buildDayDetails(
      [
        makeEntry({ id: "manual", source: "manual" }),
        makeEntry({
          id: "timer-uden-tid",
          source: "timer",
          startTime: null,
          endTime: null,
        }),
      ],
      [],
    );
    expect(days[0].intervals.every((iv) => !iv.synthetic)).toBe(true);
  });
});
