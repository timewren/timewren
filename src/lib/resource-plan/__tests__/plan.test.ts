import { describe, expect, it } from "vitest";
import { resourcePlanAccess } from "../access";
import {
  absenceHoursOn,
  bookingStatus,
  buildPlanRows,
  deviationStatus,
  isoWeekNumber,
  parseHoursInput,
  planWeeks,
  remainingPlannedHours,
  rowKey,
  toWeekStart,
  weekCapacity,
} from "../plan";

// Man-fre 7,4 t; weekend 0
const norm = (date: string) => {
  const dow = new Date(`${date}T12:00:00Z`).getUTCDay();
  return dow === 0 || dow === 6 ? 0 : 7.4;
};

describe("uger", () => {
  it("normaliserer til mandag og tæller fremad", () => {
    expect(toWeekStart("2026-10-08")).toBe("2026-10-05");
    expect(toWeekStart("2026-10-11")).toBe("2026-10-05"); // søndag
    expect(planWeeks("2026-10-07", 3)).toEqual([
      "2026-10-05",
      "2026-10-12",
      "2026-10-19",
    ]);
  });

  it("krydser sommertid og årsskifte uden at glide", () => {
    // Sommertid slutter 25/10-2026
    expect(planWeeks("2026-10-19", 2)).toEqual(["2026-10-19", "2026-10-26"]);
    expect(planWeeks("2026-12-28", 2)).toEqual(["2026-12-28", "2027-01-04"]);
  });

  it("begrænser antal uger", () => {
    expect(planWeeks("2026-10-05", 50)).toHaveLength(12);
    expect(planWeeks("2026-10-05", 0)).toHaveLength(1);
  });

  it("ISO-ugenumre", () => {
    expect(isoWeekNumber("2026-10-05")).toBe(41);
    expect(isoWeekNumber("2026-12-31")).toBe(53);
    expect(isoWeekNumber("2027-01-04")).toBe(1);
    expect(isoWeekNumber("2027-01-01")).toBe(53); // fredag i uge 53 af 2026
  });

  it("afviser ugyldige datoer", () => {
    expect(() => toWeekStart("05-10-2026")).toThrow();
  });
});

describe("kapacitet", () => {
  const today = "2026-10-07";

  it("normtid uden fravær", () => {
    expect(weekCapacity("2026-10-05", norm, [], today)).toEqual({
      normHours: 37,
      absenceHours: 0,
      capacity: 37,
    });
  });

  it("fridage er allerede trukket fra i hoursFor", () => {
    const withHoliday = (d: string) => (d === "2026-10-09" ? 0 : norm(d));
    expect(weekCapacity("2026-10-05", withHoliday, [], today).capacity).toBe(
      29.6,
    );
  });

  it("trækker ferie, halve dage og delvist fravær fra", () => {
    const cap = weekCapacity(
      "2026-10-05",
      norm,
      [
        {
          startDate: "2026-10-05",
          endDate: "2026-10-06",
          halfDayStart: false,
          halfDayEnd: true,
          hoursPerDay: null,
        },
        {
          startDate: "2026-10-08",
          endDate: "2026-10-08",
          halfDayStart: false,
          halfDayEnd: false,
          hoursPerDay: 2,
        },
      ],
      today,
    );
    expect(cap.absenceHours).toBe(13.1); // 7,4 + 3,7 + 2
    expect(cap.capacity).toBe(23.9);
  });

  it("åben sygemelding tæller kun til og med i dag", () => {
    const open = {
      startDate: "2026-10-06",
      endDate: null,
      halfDayStart: false,
      halfDayEnd: false,
      hoursPerDay: null,
    };
    expect(absenceHoursOn("2026-10-07", 7.4, [open], today)).toBe(7.4);
    expect(absenceHoursOn("2026-10-08", 7.4, [open], today)).toBe(0);
  });

  it("weekend uden normtid giver intet fravær", () => {
    const vacation = {
      startDate: "2026-10-05",
      endDate: "2026-10-11",
      halfDayStart: false,
      halfDayEnd: false,
      hoursPerDay: null,
    };
    expect(weekCapacity("2026-10-05", norm, [vacation], today)).toEqual({
      normHours: 37,
      absenceHours: 37,
      capacity: 0,
    });
  });
});

describe("booking", () => {
  it("over, under, ok og ingen", () => {
    expect(bookingStatus(40, 37)).toBe("over");
    expect(bookingStatus(37, 37)).toBe("ok");
    expect(bookingStatus(29.6, 37)).toBe("ok"); // præcis 80 %
    expect(bookingStatus(20, 37)).toBe("under");
    expect(bookingStatus(0, 0)).toBe("none");
    expect(bookingStatus(5, 0)).toBe("over"); // planlagt i en ferieuge
  });
});

describe("afvigelse", () => {
  const today = "2026-10-14"; // onsdag i uge 42

  it("kommende uger vurderes ikke", () => {
    expect(
      deviationStatus({
        planned: 10,
        registered: 0,
        weekStart: "2026-10-19",
        today,
      }),
    ).toBe("future");
  });

  it("afsluttet uge: over og under med tærskel", () => {
    const base = { weekStart: "2026-10-05", today };
    expect(deviationStatus({ ...base, planned: 10, registered: 13 })).toBe(
      "over",
    );
    expect(deviationStatus({ ...base, planned: 10, registered: 7 })).toBe(
      "under",
    );
    // 1,5 t under 10 t er under 20 %-tærsklen
    expect(deviationStatus({ ...base, planned: 10, registered: 8.5 })).toBe(
      "ok",
    );
    // Uplanlagt arbejde: 1 t eller mere er en afvigelse
    expect(deviationStatus({ ...base, planned: 0, registered: 1 })).toBe(
      "over",
    );
  });

  it("igangværende uge markeres kun ved overskridelse", () => {
    const base = { weekStart: "2026-10-12", today };
    expect(deviationStatus({ ...base, planned: 20, registered: 2 })).toBe("ok");
    expect(deviationStatus({ ...base, planned: 5, registered: 9 })).toBe(
      "over",
    );
  });
});

describe("buildPlanRows", () => {
  const w = "2026-10-05";

  it("fordeler registreret tid på aktivitet, projekt og ikke-planlagt", () => {
    const rows = buildPlanRows(
      [
        {
          userId: "u1",
          projectId: "p1",
          activityTypeId: null,
          weekStart: w,
          hours: 10,
        },
        {
          userId: "u1",
          projectId: "p1",
          activityTypeId: "a1",
          weekStart: w,
          hours: 5,
        },
      ],
      [
        // Egen aktivitetsrække
        {
          userId: "u1",
          projectId: "p1",
          activityTypeId: "a1",
          weekStart: w,
          hours: 4,
        },
        // Anden aktivitet → projektets række
        {
          userId: "u1",
          projectId: "p1",
          activityTypeId: "a2",
          weekStart: w,
          hours: 2,
        },
        {
          userId: "u1",
          projectId: "p1",
          activityTypeId: null,
          weekStart: w,
          hours: 3,
        },
        // Ikke planlagt projekt
        {
          userId: "u1",
          projectId: "p2",
          activityTypeId: "a1",
          weekStart: w,
          hours: 6,
        },
      ],
    );
    const get = (p: string, a: string | null) =>
      rows.find((r) => r.key === rowKey("u1", p, a));
    expect(get("p1", "a1")?.registered[w]).toBe(4);
    expect(get("p1", null)?.registered[w]).toBe(5);
    expect(get("p1", null)?.planned[w]).toBe(10);
    expect(get("p2", null)).toMatchObject({
      unplanned: true,
      registered: { [w]: 6 },
    });
    expect(rows).toHaveLength(3);
  });

  it("ignorerer 0-timers celler", () => {
    expect(
      buildPlanRows(
        [
          {
            userId: "u",
            projectId: "p",
            activityTypeId: null,
            weekStart: w,
            hours: 0,
          },
        ],
        [],
      ),
    ).toEqual([]);
  });
});

describe("remainingPlannedHours", () => {
  it("tæller kun igangværende og kommende uger, minus det brugte", () => {
    expect(
      remainingPlannedHours(
        [
          { weekStart: "2026-09-28", planned: 10, registered: 0 }, // fortid
          { weekStart: "2026-10-05", planned: 10, registered: 4 },
          { weekStart: "2026-10-12", planned: 8, registered: 0 },
          { weekStart: "2026-10-19", planned: 2, registered: 5 }, // aldrig negativ
        ],
        "2026-10-05",
      ),
    ).toBe(14);
  });
});

describe("parseHoursInput", () => {
  it("dansk komma, tom og ugyldig", () => {
    expect(parseHoursInput("7,5")).toBe(7.5);
    expect(parseHoursInput(" 8 ")).toBe(8);
    expect(parseHoursInput("")).toBe(0);
    expect(parseHoursInput("abc")).toBeNull();
    expect(parseHoursInput("-2")).toBeNull();
    expect(parseHoursInput("169")).toBeNull();
  });
});

describe("adgang", () => {
  it("roller", () => {
    expect(resourcePlanAccess("owner")).toEqual({
      canPlan: true,
      scope: "all",
    });
    expect(resourcePlanAccess("admin")).toEqual({
      canPlan: true,
      scope: "all",
    });
    expect(resourcePlanAccess("manager")).toEqual({
      canPlan: true,
      scope: "team",
    });
    expect(resourcePlanAccess("hr")).toEqual({ canPlan: false, scope: "all" });
    expect(resourcePlanAccess("member")).toEqual({
      canPlan: false,
      scope: "self",
    });
    expect(resourcePlanAccess(null)).toEqual({ canPlan: false, scope: "self" });
  });
});
