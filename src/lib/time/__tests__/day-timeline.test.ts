import { describe, expect, it, vi } from "vitest";

// day-timeline importerer schema (og dermed db-modulet) for loaderen.
vi.mock("@/lib/db", () => ({ db: {} }));

import {
  buildDayTimeline,
  type DayTimelineEntryRow,
  type DayTimelineSegmentRow,
} from "../day-timeline";

/**
 * De 18 grundcases for udfoldning og gaps ligger i
 * src/lib/trpc/routers/__tests__/logbook.test.ts (via buildDayDetails-aliaset).
 * Her testes kun det nye: options (minGapMinutes, excludeRejected) og summary.
 */

function makeEntry(
  over: Partial<DayTimelineEntryRow> = {},
): DayTimelineEntryRow {
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

const NO_SEGMENTS: DayTimelineSegmentRow[] = [];

describe("buildDayTimeline — options.minGapMinutes", () => {
  const entries = [
    makeEntry({
      id: "a",
      startTime: new Date(2026, 7, 17, 9, 0),
      endTime: new Date(2026, 7, 17, 10, 0),
      hours: "1",
    }),
    // 6 min hul
    makeEntry({
      id: "b",
      startTime: new Date(2026, 7, 17, 10, 6),
      endTime: new Date(2026, 7, 17, 11, 0),
      hours: "0.9",
    }),
    // 30 min hul
    makeEntry({
      id: "c",
      startTime: new Date(2026, 7, 17, 11, 30),
      endTime: new Date(2026, 7, 17, 12, 0),
      hours: "0.5",
    }),
  ];

  it("tæller alle huller >0 min når minGapMinutes ikke er sat (Logbogens adfærd)", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.gaps).toEqual([
      { afterIndex: 0, minutes: 6 },
      { afterIndex: 1, minutes: 30 },
    ]);
  });

  it("frafiltrerer huller under tærsklen ved minGapMinutes: 15", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS, {
      minGapMinutes: 15,
    });
    expect(day.gaps).toEqual([{ afterIndex: 1, minutes: 30 }]);
    expect(day.summary.gapMinutes).toBe(30);
  });

  it("medtager hul præcis på tærsklen (>=)", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS, { minGapMinutes: 6 });
    expect(day.gaps.map((g) => g.minutes)).toEqual([6, 30]);
  });

  it("frafiltrerer alt ved en høj tærskel", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS, {
      minGapMinutes: 60,
    });
    expect(day.gaps).toEqual([]);
    expect(day.summary.gapMinutes).toBe(0);
  });
});

describe("buildDayTimeline — options.excludeRejected", () => {
  const entries = [
    makeEntry({
      id: "ok",
      approvalStatus: "approved",
      startTime: new Date(2026, 7, 17, 9, 0),
      endTime: new Date(2026, 7, 17, 10, 0),
      hours: "1",
    }),
    makeEntry({
      id: "afvist",
      approvalStatus: "rejected",
      startTime: new Date(2026, 7, 17, 10, 30),
      endTime: new Date(2026, 7, 17, 11, 0),
      hours: "0.5",
    }),
  ];

  it("medtager afviste registreringer som default (uændret Logbog)", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.intervals).toHaveLength(2);
    expect(day.totalHours).toBe(1.5);
    expect(day.gaps).toEqual([{ afterIndex: 0, minutes: 30 }]);
  });

  it("udelader afviste registreringer — og deres pauser — når excludeRejected er sat", () => {
    const [day] = buildDayTimeline(entries, NO_SEGMENTS, {
      excludeRejected: true,
    });
    expect(day.intervals).toHaveLength(1);
    expect(day.totalHours).toBe(1);
    expect(day.gaps).toEqual([]);
  });

  it("lader entries uden approvalStatus overleve excludeRejected", () => {
    const [day] = buildDayTimeline([makeEntry({ id: "ukendt" })], NO_SEGMENTS, {
      excludeRejected: true,
    });
    expect(day.intervals).toHaveLength(1);
  });
});

describe("buildDayTimeline — gapDetails ved overlap", () => {
  it("citerer det interval der ejer spans slut, ikke det foregående i rækken", () => {
    const entries = [
      // Det lange interval ejer maxEnd (13:00) …
      makeEntry({
        id: "lang",
        projectName: "Lang opgave",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 13, 0),
        hours: "4",
      }),
      // … mens det korte ligger inde i det og slutter allerede 10:00.
      makeEntry({
        id: "kort",
        projectName: "Kort opgave",
        startTime: new Date(2026, 7, 17, 9, 30),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "0.5",
      }),
      makeEntry({
        id: "efter",
        projectName: "Efter pausen",
        startTime: new Date(2026, 7, 17, 14, 0),
        endTime: new Date(2026, 7, 17, 15, 0),
        hours: "1",
      }),
    ];
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);

    expect(day.gapDetails).toEqual([
      { afterIndex: 0, beforeIndex: 2, minutes: 60 },
    ]);
    // Pausen skal citere den lange opgaves 13:00 — ikke den korte opgaves
    // 10:00, som ville få hullet til at se ud som 4 timer fra en anden post.
    expect(day.intervals[day.gapDetails[0].afterIndex].projectName).toBe(
      "Lang opgave",
    );
    expect(day.intervals[day.gapDetails[0].afterIndex].end).toBe(
      new Date(2026, 7, 17, 13, 0).toISOString(),
    );
    expect(day.intervals[day.gapDetails[0].beforeIndex].projectName).toBe(
      "Efter pausen",
    );
  });

  it("holder gaps som en ren projektion af gapDetails", () => {
    const entries = [
      makeEntry({
        id: "a",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "1",
      }),
      makeEntry({
        id: "b",
        startTime: new Date(2026, 7, 17, 11, 0),
        endTime: new Date(2026, 7, 17, 12, 0),
        hours: "1",
      }),
    ];
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.gaps).toEqual(
      day.gapDetails.map(({ afterIndex, minutes }) => ({
        afterIndex,
        minutes,
      })),
    );
  });
});

describe("buildDayTimeline — summary", () => {
  it("summerer span, arbejdet tid og pauser for en almindelig dag", () => {
    const entries = [
      makeEntry({
        id: "a",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 0),
        hours: "2",
      }),
      makeEntry({
        id: "b",
        startTime: new Date(2026, 7, 17, 12, 0),
        endTime: new Date(2026, 7, 17, 14, 0),
        hours: "2",
      }),
    ];
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.summary).toEqual({
      gapMinutes: 60,
      spanMinutes: 300,
      workedMinutes: 240,
      untimedEntries: 0,
      syntheticEntries: 0,
    });
    // span = arbejdet + pauser når intet er filtreret fra
    expect(day.summary.workedMinutes + day.summary.gapMinutes).toBe(
      day.summary.spanMinutes,
    );
  });

  it("tæller overlappende intervaller kun én gang i workedMinutes", () => {
    const entries = [
      makeEntry({
        id: "a",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 13, 0),
        hours: "4",
      }),
      makeEntry({
        id: "b",
        startTime: new Date(2026, 7, 17, 9, 30),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "0.5",
      }),
    ];
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.summary.workedMinutes).toBe(240);
    expect(day.summary.spanMinutes).toBe(240);
    expect(day.summary.gapMinutes).toBe(0);
  });

  it("tæller registreringer uden tidspunkter som untimedEntries uden at påvirke span", () => {
    const entries = [
      makeEntry({
        id: "a",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 10, 0),
        hours: "1",
      }),
      makeEntry({ id: "b", startTime: null, endTime: null, hours: "3" }),
    ];
    const [day] = buildDayTimeline(entries, NO_SEGMENTS);
    expect(day.summary.untimedEntries).toBe(1);
    expect(day.summary.spanMinutes).toBe(60);
    expect(day.summary.workedMinutes).toBe(60);
    expect(day.totalHours).toBe(4);
  });

  it("tæller timer-udledte intervaller som syntheticEntries", () => {
    const [day] = buildDayTimeline(
      [makeEntry({ id: "a", source: "timer", hours: "2.5" })],
      NO_SEGMENTS,
    );
    expect(day.summary.syntheticEntries).toBe(1);
  });

  it("giver nul-summary for en dag helt uden tidspunkter", () => {
    const [day] = buildDayTimeline(
      [makeEntry({ id: "a", startTime: null, endTime: null, hours: "2" })],
      NO_SEGMENTS,
    );
    expect(day.summary).toEqual({
      gapMinutes: 0,
      spanMinutes: 0,
      workedMinutes: 0,
      untimedEntries: 1,
      syntheticEntries: 0,
    });
  });

  it("bruger segmenternes ægte tidspunkter i summary", () => {
    const entries = [
      makeEntry({
        id: "a",
        source: "timer",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 16, 0),
        hours: "4",
      }),
    ];
    const segments: DayTimelineSegmentRow[] = [
      {
        timeEntryId: "a",
        startTime: new Date(2026, 7, 17, 9, 0),
        endTime: new Date(2026, 7, 17, 11, 0),
        durationMinutes: 120,
      },
      {
        timeEntryId: "a",
        startTime: new Date(2026, 7, 17, 14, 0),
        endTime: new Date(2026, 7, 17, 16, 0),
        durationMinutes: 120,
      },
    ];
    const [day] = buildDayTimeline(entries, segments);
    expect(day.summary.workedMinutes).toBe(240);
    expect(day.summary.gapMinutes).toBe(180);
    expect(day.summary.spanMinutes).toBe(420);
    expect(day.summary.syntheticEntries).toBe(0);
  });
});
