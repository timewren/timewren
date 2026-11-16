import { describe, expect, it } from "vitest";
import { aggregateDataset } from "../aggregate";
import { defaultConfigFor, reportFiltersSchema } from "../config";
import type { EnterpriseDataset, TimeFact } from "../types";

const filters = reportFiltersSchema.parse({});

function calendar(from: string, to: string) {
  const out: EnterpriseDataset["calendar"] = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    const date = `${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, "0")}-${String(cur.getDate()).padStart(2, "0")}`;
    out.push({
      date,
      isHoliday: false,
      isPayrollHoliday: false,
      isHalfHoliday: false,
      holidayName: null,
      isClosure: false,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

function fact(date: string, hours: number, userId = "u1"): TimeFact {
  return {
    userId,
    date,
    projectId: "pr1",
    projectName: "Undervisning",
    activityTypeId: null,
    activityTypeName: "",
    payrollCode: "",
    source: "timesheet",
    approvalStatus: "approved",
    hours,
  };
}

function dataset(over: Partial<EnterpriseDataset>): EnterpriseDataset {
  return {
    orgId: "org",
    from: "2026-03-01",
    to: "2026-03-15",
    today: "2026-04-01",
    employees: [
      {
        userId: "u1",
        profileId: "p1",
        name: "Anna",
        email: "anna@example.dk",
        departmentId: null,
        departmentName: "",
        employmentType: "full_time",
        weeklyHours: 37,
        dailyNorm: 7.4,
        workingDays: ["1", "2", "3", "4", "5"],
        isActive: true,
        startDate: null,
        endDate: null,
        employeeNumber: "",
        externalPayrollId: "",
        employment: [],
      },
    ],
    calendar: calendar("2026-03-01", "2026-03-15"),
    time: [],
    absence: [],
    absencePeriods: [],
    flex: [],
    overtime: [],
    checkIns: [],
    vacationBalances: [],
    absenceTypes: [],
    activityTypes: [],
    breakPolicy: "none",
    payroll: { wageTypes: [], rules: [] },
    ...over,
  };
}

describe("aggregateDataset — compliance-mål (E11)", () => {
  it("dage over 13 t, uger over 48 t og uger uden fridag", () => {
    // Uge 10 (2/3–8/3): 7 dage à 7,5 t = 52,5 t, ingen fridag; tirsdag 14 t
    const week1 = [
      fact("2026-03-02", 7.5),
      fact("2026-03-03", 14),
      fact("2026-03-04", 7.5),
      fact("2026-03-05", 7.5),
      fact("2026-03-06", 7.5),
      fact("2026-03-07", 7.5),
      fact("2026-03-08", 7.5),
    ];
    // Uge 11: 3 dage à 7 t; to poster samme dag summeres til dagsum
    const week2 = [
      fact("2026-03-09", 4),
      fact("2026-03-09", 3),
      fact("2026-03-10", 7),
      fact("2026-03-11", 7),
    ];
    const r = aggregateDataset(dataset({ time: [...week1, ...week2] }), {
      dimensions: ["employee"],
      filters,
    });
    const v = r.rows[0].values;
    expect(v.workedDays).toBe(10);
    expect(v.maxDayHours).toBe(14);
    expect(v.longDays).toBe(1);
    expect(v.weeksOver48h).toBe(1);
    expect(v.fullWeeks).toBe(1);
    expect(v.avgWeeklyHours).toBe(40); // (59 + 21) / 2
    expect(r.totals.values.longDays).toBe(1);
  });

  it("hel fraværsdag giver hvile i ugen og er neutral i 48 t-nævneren", () => {
    const week1 = Array.from({ length: 7 }, (_, i) =>
      fact(`2026-03-0${2 + i}`, 7),
    );
    const r = aggregateDataset(
      dataset({
        time: week1,
        absence: [
          {
            userId: "u1",
            date: "2026-03-04",
            requestId: "r1",
            absenceTypeId: "t1",
            absenceTypeName: "Sygdom",
            category: "sickness",
            vacationPool: "vacation",
            deductsVacation: false,
            deductsOvertime: false,
            status: "approved",
            source: "manual",
            days: 1,
            hours: 7.4,
            isOpen: false,
          },
          // 1 sygedag af 5 arbejdsdage: 4/5 af ugen tæller i nævneren
          {
            userId: "u1",
            date: "2026-03-11",
            requestId: "r2",
            absenceTypeId: "t1",
            absenceTypeName: "Sygdom",
            category: "sickness",
            vacationPool: "vacation",
            deductsVacation: false,
            deductsOvertime: false,
            status: "approved",
            source: "manual",
            days: 1,
            hours: 7.4,
            isOpen: false,
          },
        ],
      }),
      { dimensions: ["employee"], filters },
    );
    const v = r.rows[0].values;
    expect(v.fullWeeks).toBe(0);
    expect(v.weeksOver48h).toBe(1); // 49 t
    expect(v.avgWeeklyHours).toBe(27.22); // 49 / (1 + 0,8) uger
  });

  it("ferieuge udvander ikke 48 t-gennemsnittet; afspadsering gør (#728)", () => {
    const work = Array.from({ length: 5 }, (_, i) =>
      fact(`2026-03-0${2 + i}`, 12),
    );
    const week2 = (deductsOvertime: boolean, name: string) =>
      Array.from({ length: 5 }, (_, i) => ({
        userId: "u1",
        date: `2026-03-${String(9 + i).padStart(2, "0")}`,
        requestId: "r1",
        absenceTypeId: "t1",
        absenceTypeName: name,
        category: deductsOvertime ? "other" : "vacation",
        vacationPool: "vacation",
        deductsVacation: !deductsOvertime,
        deductsOvertime,
        status: "approved",
        source: "manual",
        days: 1,
        hours: 7.4,
        isOpen: false,
      }));
    const run = (absence: EnterpriseDataset["absence"]) =>
      aggregateDataset(dataset({ time: work, absence }), {
        dimensions: ["employee"],
        filters,
      }).rows[0].values;
    expect(run(week2(false, "Ferie")).avgWeeklyHours).toBe(60);
    expect(run(week2(true, "Afspadsering")).avgWeeklyHours).toBe(30);

    // Helligdag torsdag i ferieugen: 4 fraværsdage af 4 arbejdsdage = hel uge
    const cal = calendar("2026-03-01", "2026-03-15").map((d) =>
      d.date === "2026-03-12" ? { ...d, isHoliday: true } : d,
    );
    const withHoliday = aggregateDataset(
      dataset({
        calendar: cal,
        time: work,
        absence: week2(false, "Ferie").filter((f) => f.date !== "2026-03-12"),
      }),
      { dimensions: ["employee"], filters },
    ).rows[0].values;
    expect(withHoliday.avgWeeklyHours).toBe(60);

    // Arbejde (8 t) på en feriedag: dagen er ikke neutral → 68 / (1 + 0,2)
    const workedOnVacation = aggregateDataset(
      dataset({
        time: [...work, fact("2026-03-11", 8)],
        absence: week2(false, "Ferie"),
      }),
      { dimensions: ["employee"], filters },
    ).rows[0].values;
    expect(workedOnVacation.avgWeeklyHours).toBe(56.67);
  });

  it("pr. uge-dimension: hver række er én uge", () => {
    const r = aggregateDataset(
      dataset({
        time: [fact("2026-03-02", 14), fact("2026-03-09", 7)],
      }),
      { dimensions: ["employee", "week"], filters },
    );
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].values.longDays).toBe(1);
    expect(r.rows[1].values.longDays).toBe(0);
    expect(r.rows[0].values.avgWeeklyHours).toBe(14);
  });

  it("compliance-rapporttypen har gyldig default-config", () => {
    const cfg = defaultConfigFor("compliance");
    expect(cfg.reportType).toBe("compliance");
    expect(cfg.dimensions).toEqual(["employee", "week"]);
    expect(cfg.columns).toContain("longDays");
  });
});
