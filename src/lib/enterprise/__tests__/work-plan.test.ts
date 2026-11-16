import { describe, expect, it } from "vitest";
import {
  assignmentAt,
  exportRows,
  halveDay,
  inheritedRotationAnchor,
  makePlanLookup,
  mergeRegisteredIntoEntries,
  normalizeDeviation,
  type PlanComplianceEntry,
  planWallTime,
  registeredDay,
  rotationWeekIndex,
  spanHours,
  validateWeeks,
  versionAt,
  WORK_PLAN_PRESET_DEFS,
  type WorkPlanAssignmentLike,
  type WorkPlanVersionLike,
  weeklyHours,
} from "../work-plan";

// Ren logik for fast arbejdsplan (#510). Køres i både UTC og
// Europe/Copenhagen i CI — intet her må afhænge af processens tidszone.

const standard = WORK_PLAN_PRESET_DEFS.standard;
const teachers = WORK_PLAN_PRESET_DEFS.teachers;

describe("forudindstillinger", () => {
  it("giver 37 t pr. uge og er gyldige", () => {
    expect(weeklyHours(standard.weeks)).toEqual([37]);
    expect(weeklyHours(teachers.weeks)).toEqual([37, 37]);
    expect(validateWeeks(standard.weeks, 1)).toBeNull();
    expect(validateWeeks(teachers.weeks, 2)).toBeNull();
  });
});

describe("validateWeeks", () => {
  it("afviser slut før start, dobbelt ugedag og for lang pause", () => {
    expect(
      validateWeeks(
        [[{ weekday: 1, start: "16:00", end: "08:00", breakMinutes: 0 }]],
        1,
      ),
    ).toMatch(/Sluttid/);
    expect(
      validateWeeks(
        [
          [
            { weekday: 1, start: "08:00", end: "16:00", breakMinutes: 0 },
            { weekday: 1, start: "08:00", end: "12:00", breakMinutes: 0 },
          ],
        ],
        1,
      ),
    ).toMatch(/to gange/);
    expect(
      validateWeeks(
        [[{ weekday: 2, start: "08:00", end: "08:30", breakMinutes: 30 }]],
        1,
      ),
    ).toMatch(/Pausen/);
    expect(validateWeeks(standard.weeks, 2)).toMatch(/rotationen/);
  });
});

describe("spanHours", () => {
  it("trækker pausen fra", () => {
    expect(spanHours("08:00", "16:00", 30)).toBe(7.5);
    expect(spanHours("08:00", "15:30", 30)).toBe(7);
    expect(spanHours("10:00", "09:00", 0)).toBe(0);
  });
});

describe("rotationWeekIndex", () => {
  it("uge A er ugen for ikrafttræden — også over årsskifte og sommertid", () => {
    // 2026-03-04 er onsdag; mandagen er 2026-03-02
    expect(rotationWeekIndex("2026-03-04", 2, "2026-03-02")).toBe(0);
    expect(rotationWeekIndex("2026-03-04", 2, "2026-03-09")).toBe(1);
    // Over sommertid (29/3) og videre
    expect(rotationWeekIndex("2026-03-04", 2, "2026-03-30")).toBe(0);
    expect(rotationWeekIndex("2026-03-04", 2, "2026-04-05")).toBe(0);
    expect(rotationWeekIndex("2026-03-04", 2, "2026-04-06")).toBe(1);
    // Årsskifte: 2026-12-28 (man) → 2027-01-04 (man)
    const a = rotationWeekIndex("2026-03-04", 2, "2026-12-28");
    expect(rotationWeekIndex("2026-03-04", 2, "2027-01-04")).toBe(1 - a);
    expect(rotationWeekIndex("2026-03-04", 1, "2027-01-04")).toBe(0);
  });
});

describe("inheritedRotationAnchor", () => {
  it("en ny version midt i uge B fortsætter rotationen", () => {
    const prev = {
      validFrom: "2026-03-04",
      rotationWeeks: 2,
      rotationAnchor: null,
    };
    // 2026-03-12 ligger i uge B for den gamle version
    expect(rotationWeekIndex("2026-03-04", 2, "2026-03-12")).toBe(1);
    const anchor = inheritedRotationAnchor(prev, 2);
    expect(anchor).toBe("2026-03-02");
    expect(rotationWeekIndex(anchor ?? "2026-03-12", 2, "2026-03-12")).toBe(1);
    // Uden forrige 14-dages version starter rotationen forfra
    expect(
      inheritedRotationAnchor({ ...prev, rotationWeeks: 1 }, 2),
    ).toBeNull();
    expect(inheritedRotationAnchor(prev, 1)).toBeNull();
    expect(inheritedRotationAnchor(null, 2)).toBeNull();
  });
});

describe("versionAt / assignmentAt", () => {
  const versions: WorkPlanVersionLike[] = [
    { planId: "p", validFrom: "2026-01-05", rotationWeeks: 1, weeks: [[]] },
    { planId: "p", validFrom: "2026-06-01", rotationWeeks: 1, weeks: [[]] },
  ];
  it("vælger senest ikrafttrådte version", () => {
    expect(versionAt(versions, "2026-01-04")).toBeNull();
    expect(versionAt(versions, "2026-05-31")?.validFrom).toBe("2026-01-05");
    expect(versionAt(versions, "2026-06-01")?.validFrom).toBe("2026-06-01");
  });

  const assignments: WorkPlanAssignmentLike[] = [
    {
      planId: "dept",
      userId: null,
      departmentId: "d1",
      validFrom: "2026-01-01",
      validTo: null,
    },
    {
      planId: "own",
      userId: "u1",
      departmentId: null,
      validFrom: "2026-03-01",
      validTo: "2026-03-31",
    },
  ];
  it("personlig tildeling vinder over afdelingens inden for perioden", () => {
    expect(assignmentAt(assignments, "u1", "d1", "2026-02-15")?.planId).toBe(
      "dept",
    );
    expect(assignmentAt(assignments, "u1", "d1", "2026-03-15")?.planId).toBe(
      "own",
    );
    expect(assignmentAt(assignments, "u1", "d1", "2026-04-01")?.planId).toBe(
      "dept",
    );
    expect(assignmentAt(assignments, "u1", null, "2026-04-01")).toBeNull();
    expect(assignmentAt(assignments, "u2", "d2", "2026-03-15")).toBeNull();
  });
});

describe("makePlanLookup", () => {
  const lookup = makePlanLookup({
    userId: "u1",
    departmentAt: () => null,
    assignments: [
      {
        planId: "t",
        userId: "u1",
        departmentId: null,
        validFrom: "2026-08-03",
        validTo: null,
      },
    ],
    versionsByPlan: new Map([
      [
        "t",
        [
          {
            planId: "t",
            validFrom: "2026-08-03",
            rotationWeeks: teachers.rotationWeeks,
            weeks: teachers.weeks,
          },
        ],
      ],
    ]),
  });
  it("giver uge A/B-tider og fri i weekenden", () => {
    // 2026-08-03 mandag uge A, 2026-08-10 mandag uge B
    expect(lookup.planFor("2026-08-03")).toMatchObject({
      weekIndex: 0,
      start: "08:00",
      end: "16:00",
      hours: 7.5,
    });
    expect(lookup.planFor("2026-08-10")).toMatchObject({
      weekIndex: 1,
      end: "17:00",
      hours: 8.5,
    });
    expect(lookup.planFor("2026-08-08")).toBeNull(); // lørdag
    expect(lookup.hasPlan("2026-08-08")).toBe(true);
    expect(lookup.hasPlan("2026-08-02")).toBe(false); // før tildeling
  });
});

describe("registeredDay", () => {
  const planned = {
    planId: "p",
    weekIndex: 0,
    start: "08:00",
    end: "16:00",
    breakMinutes: 30,
    hours: 7.5,
  };
  it("efter plan uden afvigelse", () => {
    const d = registeredDay({
      date: "2026-10-05",
      planned,
      dayOff: null,
      absence: false,
      deviation: null,
    });
    expect(d).toMatchObject({ status: "plan", hours: 7.5, start: "08:00" });
  });
  it("hel fridag og fravær nulstiller; halv fridag halverer", () => {
    expect(
      registeredDay({
        date: "2026-12-25",
        planned,
        dayOff: { name: "Juledag", isHalfDay: false },
        absence: false,
        deviation: null,
      }),
    ).toMatchObject({ status: "day_off", hours: 0, planned: null });
    expect(
      registeredDay({
        date: "2026-10-06",
        planned,
        dayOff: null,
        absence: true,
        deviation: null,
      }),
    ).toMatchObject({ status: "absence", hours: 0 });
    const half = registeredDay({
      date: "2026-12-24",
      planned,
      dayOff: { name: "Juleaften", isHalfDay: true },
      absence: false,
      deviation: null,
    });
    expect(half).toMatchObject({ status: "plan", end: "12:00", hours: 3.75 });
    expect(halveDay(planned).breakMinutes).toBe(15);
  });
  it("afvigelsen vinder altid", () => {
    const d = registeredDay({
      date: "2026-10-07",
      planned,
      dayOff: null,
      absence: false,
      deviation: {
        date: "2026-10-07",
        kind: "worked",
        startTime: "08:00",
        endTime: "18:00",
        breakMinutes: 30,
        hours: 9.5,
        note: null,
      },
    });
    expect(d).toMatchObject({ status: "deviation", hours: 9.5, end: "18:00" });
    expect(d.planned?.hours).toBe(7.5);
  });
});

describe("normalizeDeviation", () => {
  it("beregner timer af tidsrum, accepterer rene timer og fravær", () => {
    expect(
      normalizeDeviation({
        kind: "worked",
        startTime: "07:30",
        endTime: "17:00",
        breakMinutes: 30,
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: "worked",
        startTime: "07:30",
        endTime: "17:00",
        breakMinutes: 30,
        hours: 9,
      },
    });
    expect(normalizeDeviation({ kind: "worked", hours: 5.25 })).toMatchObject({
      ok: true,
      value: { hours: 5.25, startTime: null },
    });
    expect(normalizeDeviation({ kind: "absence", hours: 4 })).toMatchObject({
      ok: true,
      value: { hours: 0, kind: "absence" },
    });
    expect(
      normalizeDeviation({ kind: "worked", startTime: "09:00" }),
    ).toMatchObject({ ok: false });
    expect(normalizeDeviation({ kind: "worked" })).toMatchObject({ ok: false });
  });
});

describe("mergeRegisteredIntoEntries", () => {
  const day = (date: string, hours: number, start: string | null) =>
    registeredDay({
      date,
      planned: start
        ? {
            planId: "p",
            weekIndex: 0,
            start,
            end: "16:00",
            breakMinutes: 30,
            hours,
          }
        : null,
      dayOff: null,
      absence: false,
      deviation: null,
    });

  it("erstatter dage med færre tidspost-timer end planen, kun til og med i dag", () => {
    const entries = [
      { date: "2026-10-05", hours: 2 },
      { date: "2026-10-06", hours: 9 },
    ];
    const merged = mergeRegisteredIntoEntries(
      entries,
      [
        day("2026-10-05", 7.5, "08:00"),
        day("2026-10-06", 7.5, "08:00"),
        day("2026-10-07", 7.5, "08:00"),
        day("2026-10-08", 7.5, "08:00"),
        day("2026-10-09", 7.5, "08:00"),
      ],
      "2026-10-08",
      planWallTime,
    );
    const byDate: Record<string, PlanComplianceEntry> = Object.fromEntries(
      merged.map((e) => [e.date, e]),
    );
    expect(byDate["2026-10-06"].hours).toBe(9); // tidsposterne er flest
    expect(byDate["2026-10-05"].hours).toBe(7.5);
    expect(byDate["2026-10-07"].hours).toBe(7.5);
    expect(byDate["2026-10-08"]).toBeUndefined(); // i dag er ikke slut
    expect(byDate["2026-10-09"]).toBeUndefined(); // fremtid
    const start = byDate["2026-10-05"].startTime as Date;
    const end = byDate["2026-10-05"].endTime as Date;
    // 08:00 dansk sommertid = 06:00Z, 7,5 t senere
    expect(start.toISOString()).toBe("2026-10-05T06:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-05T13:30:00.000Z");
  });

  it("afvigelsen erstatter dagens tidsposter — også nedad og ved 0 t", () => {
    const dev = (date: string, hours: number) =>
      registeredDay({
        date,
        planned: null,
        dayOff: null,
        absence: false,
        deviation: {
          date,
          kind: hours > 0 ? "worked" : "absence",
          startTime: null,
          endTime: null,
          breakMinutes: null,
          hours,
          note: null,
        },
      });
    const merged = mergeRegisteredIntoEntries(
      [
        { date: "2026-10-05", hours: 8 },
        { date: "2026-10-06", hours: 3 },
        { date: "2026-10-08", hours: 2 },
      ],
      [dev("2026-10-05", 6), dev("2026-10-06", 0), dev("2026-10-08", 9)],
      "2026-10-08",
      planWallTime,
    );
    expect(merged).toEqual([
      { date: "2026-10-05", hours: 6, startTime: null },
      { date: "2026-10-08", hours: 9, startTime: null },
    ]);
  });

  it("planWallTime følger dansk vintertid", () => {
    expect(planWallTime("2026-12-01", "08:00").toISOString()).toBe(
      "2026-12-01T07:00:00.000Z",
    );
  });
});

describe("exportRows", () => {
  it("giver én række pr. dag med status og decimaltimer", () => {
    const rows = exportRows([
      registeredDay({
        date: "2026-10-05",
        planned: {
          planId: "p",
          weekIndex: 0,
          start: "08:00",
          end: "16:00",
          breakMinutes: 30,
          hours: 7.5,
        },
        dayOff: null,
        absence: false,
        deviation: null,
      }),
    ]);
    expect(rows[0].slice(0, 7)).toEqual([
      "2026-10-05",
      "Efter plan",
      "08:00-16:00",
      7.5,
      "08:00-16:00",
      30,
      7.5,
    ]);
  });
});
