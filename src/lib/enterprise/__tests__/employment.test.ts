import { describe, expect, it } from "vitest";
import {
  dailyNormAt,
  type EmploymentPeriodLike,
  employmentIntervals,
  isEmployedInRange,
  isEmployedOn,
  latestPeriod,
  makeDayResolver,
  normProfileAt,
  previousDay,
  resolveEmploymentAt,
  sortPeriods,
  validatePeriodDates,
} from "../employment";
import { aggregateDataset, employmentNormOn } from "../reporting/aggregate";
import { reportFiltersSchema } from "../reporting/config";
import type { DatasetEmployee, EnterpriseDataset } from "../reporting/types";
import { DEFAULT_ORG_WORK_SETTINGS } from "../timesheet";
import {
  accruedMonthsForIntervals,
  accruedMonthsInPeriod,
  monthlyAccrualDays,
} from "../vacation";

const WEEK = ["1", "2", "3", "4", "5"];

function period(over: Partial<EmploymentPeriodLike>): EmploymentPeriodLike {
  return {
    validFrom: null,
    validTo: null,
    weeklyHours: 37,
    workingDays: WEEK,
    dailyNormHours: null,
    breakMinutes: null,
    departmentId: null,
    employmentType: "full_time",
    ...over,
  };
}

const profile = {
  weeklyHours: "37.0",
  workingDays: WEEK,
  dailyNormHours: null,
  breakMinutes: null,
  departmentId: "dept-cache",
  employmentType: "full_time",
};

// 37 t → 30 t fra 15/3-2026; fratrådt 31/8-2026
const HISTORY: EmploymentPeriodLike[] = [
  period({ validFrom: "2024-08-01", validTo: "2026-03-14", weeklyHours: 37 }),
  period({
    validFrom: "2026-03-15",
    validTo: "2026-08-31",
    weeklyHours: 30,
    departmentId: "dept-b",
    endReason: "resigned",
  }),
];

describe("resolveEmploymentAt (#465) — dato-grænser", () => {
  it("dagen før skiftet hører til den gamle periode, skiftedagen til den nye", () => {
    expect(resolveEmploymentAt(HISTORY, "2026-03-14")?.weeklyHours).toBe(37);
    expect(resolveEmploymentAt(HISTORY, "2026-03-15")?.weeklyHours).toBe(30);
  });

  it("validFrom og validTo er begge inklusive", () => {
    expect(resolveEmploymentAt(HISTORY, "2024-08-01")?.weeklyHours).toBe(37);
    expect(resolveEmploymentAt(HISTORY, "2026-08-31")?.weeklyHours).toBe(30);
  });

  it("før tiltrædelse og efter fratrædelse = ikke ansat", () => {
    expect(resolveEmploymentAt(HISTORY, "2024-07-31")).toBeNull();
    expect(resolveEmploymentAt(HISTORY, "2026-09-01")).toBeNull();
  });

  it("validFrom NULL dækker alt bagud, validTo NULL alt fremad", () => {
    const open = [period({ validFrom: null, validTo: null, weeklyHours: 25 })];
    expect(resolveEmploymentAt(open, "1999-01-01")?.weeklyHours).toBe(25);
    expect(resolveEmploymentAt(open, "2099-12-31")?.weeklyHours).toBe(25);
  });

  it("er uafhængig af input-rækkefølgen", () => {
    const reversed = [...HISTORY].reverse();
    expect(resolveEmploymentAt(reversed, "2026-03-14")?.weeklyHours).toBe(37);
    expect(resolveEmploymentAt(reversed, "2026-03-15")?.weeklyHours).toBe(30);
  });

  it("hul mellem to ansættelser = ikke ansat i hullet", () => {
    const rehired = [
      ...HISTORY,
      period({ validFrom: "2027-01-01", validTo: null, weeklyHours: 37 }),
    ];
    expect(resolveEmploymentAt(rehired, "2026-10-01")).toBeNull();
    expect(resolveEmploymentAt(rehired, "2027-01-01")?.weeklyHours).toBe(37);
  });
});

describe("sortPeriods / latestPeriod", () => {
  it("NULL validFrom sorteres først, seneste sidst", () => {
    const sorted = sortPeriods([
      period({ validFrom: "2026-01-01" }),
      period({ validFrom: null }),
      period({ validFrom: "2025-06-01" }),
    ]);
    expect(sorted.map((p) => p.validFrom)).toEqual([
      null,
      "2025-06-01",
      "2026-01-01",
    ]);
    expect(latestPeriod(sorted)?.validFrom).toBe("2026-01-01");
    expect(latestPeriod([])).toBeNull();
  });
});

describe("isEmployedOn / isEmployedInRange", () => {
  it("uden historik er man altid ansat (bagudkompatibelt)", () => {
    expect(isEmployedOn([], "2026-01-01")).toBe(true);
    expect(isEmployedInRange([], "2026-01-01", "2026-01-07")).toBe(true);
  });

  it("uge der overlapper fratrædelsen tæller som ansat; ugen efter ikke", () => {
    expect(isEmployedInRange(HISTORY, "2026-08-31", "2026-09-06")).toBe(true);
    expect(isEmployedInRange(HISTORY, "2026-09-07", "2026-09-13")).toBe(false);
    expect(isEmployedOn(HISTORY, "2026-09-01")).toBe(false);
  });
});

describe("normProfileAt / dailyNormAt — normtid pr. dato", () => {
  it("uden historik bruges profilens egne felter", () => {
    expect(normProfileAt([], profile, "2026-01-01")).toBe(profile);
    expect(
      dailyNormAt([], profile, "2026-01-01", DEFAULT_ORG_WORK_SETTINGS),
    ).toBe(7.4);
  });

  it("periodens ugetimer og afdeling lægges over profil-cachen", () => {
    const eff = normProfileAt(HISTORY, profile, "2026-04-01");
    expect(eff?.weeklyHours).toBe(30);
    expect(eff?.departmentId).toBe("dept-b");
    expect(
      dailyNormAt(HISTORY, profile, "2026-04-01", DEFAULT_ORG_WORK_SETTINGS),
    ).toBe(6);
    expect(
      dailyNormAt(HISTORY, profile, "2026-03-01", DEFAULT_ORG_WORK_SETTINGS),
    ).toBe(7.4);
  });

  it("ikke ansat på datoen → null / norm 0", () => {
    expect(normProfileAt(HISTORY, profile, "2026-09-15")).toBeNull();
    expect(
      dailyNormAt(HISTORY, profile, "2026-09-15", DEFAULT_ORG_WORK_SETTINGS),
    ).toBe(0);
  });

  it("periodens dagsnorm-override og arbejdsdage vinder over profilen", () => {
    const periods = [
      period({
        validFrom: "2026-01-01",
        weeklyHours: 32,
        workingDays: ["1", "2", "3", "4"],
        dailyNormHours: "8.0",
      }),
    ];
    const resolve = makeDayResolver(
      periods,
      profile,
      DEFAULT_ORG_WORK_SETTINGS,
    );
    expect(resolve("2026-02-02")).toEqual({
      dailyNorm: 8,
      workingDays: ["1", "2", "3", "4"],
    });
    expect(resolve("2025-12-31")).toBeNull();
  });
});

describe("flex/normtid med skift midt i måneden", () => {
  it("marts 2026: 10 arbejdsdage à 7,4 + 12 à 6,0 (skift 15/3)", () => {
    const resolve = makeDayResolver(
      HISTORY,
      profile,
      DEFAULT_ORG_WORK_SETTINGS,
    );
    let norm = 0;
    let days = 0;
    for (let d = 1; d <= 31; d++) {
      const date = `2026-03-${String(d).padStart(2, "0")}`;
      const dt = new Date(`${date}T00:00:00`);
      const iso = dt.getDay() === 0 ? "7" : String(dt.getDay());
      const day = resolve(date);
      if (!day?.workingDays.includes(iso)) continue;
      norm += day.dailyNorm;
      days++;
    }
    expect(days).toBe(22);
    // 1/3-14/3: 10 arbejdsdage (2.-6., 9.-13.) à 7,4; 15/3-31/3: 12 à 6,0
    expect(norm).toBeCloseTo(10 * 7.4 + 12 * 6, 5);
  });

  it("kun én periode: identisk med profilens norm (ingen adfærdsændring)", () => {
    const single = [period({ validFrom: "2020-01-01", weeklyHours: 37 })];
    const resolve = makeDayResolver(single, profile, DEFAULT_ORG_WORK_SETTINGS);
    expect(resolve("2026-03-10")?.dailyNorm).toBe(7.4);
    expect(
      dailyNormAt([], profile, "2026-03-10", DEFAULT_ORG_WORK_SETTINGS),
    ).toBe(7.4);
  });
});

describe("employmentIntervals — sammenhængende ansættelse", () => {
  it("vilkårsskift uden hul smeltes til ét interval", () => {
    expect(employmentIntervals(HISTORY)).toEqual([
      { start: "2024-08-01", end: "2026-08-31" },
    ]);
  });

  it("genansættelse efter hul giver to intervaller", () => {
    const rehired = [
      ...HISTORY,
      period({ validFrom: "2027-01-01", validTo: null }),
    ];
    expect(employmentIntervals(rehired)).toEqual([
      { start: "2024-08-01", end: "2026-08-31" },
      { start: "2027-01-01", end: null },
    ]);
  });

  it("uden historik bruges profilens start/slut", () => {
    expect(
      employmentIntervals([], { startDate: "2025-01-01", endDate: null }),
    ).toEqual([{ start: "2025-01-01", end: null }]);
    expect(employmentIntervals([])).toEqual([{ start: null, end: null }]);
  });

  it("åben periode først: alt efter er dækket", () => {
    expect(
      employmentIntervals([
        period({ validFrom: null, validTo: null }),
        period({ validFrom: "2026-01-01", validTo: null }),
      ]),
    ).toEqual([{ start: null, end: null }]);
  });
});

describe("ferie-optjening med FTE-skift (monthly = flat 2,08)", () => {
  const year = { start: "2025-09-01", end: "2026-08-31" };

  it("FTE-skift midt i marts påvirker IKKE hvilke måneder der optjenes", () => {
    const withShift = accruedMonthsForIntervals(
      year,
      "2026-09-01",
      employmentIntervals(HISTORY),
    );
    const noShift = accruedMonthsInPeriod(
      year,
      "2026-09-01",
      "2024-08-01",
      "2026-08-31",
    );
    expect(withShift).toEqual(noShift);
    expect(withShift).toHaveLength(12);
    expect(withShift).toContain("2026-03");
  });

  it("optjeningen pr. måned er flat 2,08 uanset ugetimer", () => {
    expect(monthlyAccrualDays()).toBeCloseTo(2.08, 2);
  });

  it("fratrædelse 31/8 giver august med; fratrædelse 30/8 gør ikke", () => {
    const early = [period({ validFrom: "2024-08-01", validTo: "2026-08-30" })];
    expect(
      accruedMonthsForIntervals(year, "2026-09-01", employmentIntervals(early)),
    ).not.toContain("2026-08");
    expect(
      accruedMonthsForIntervals(
        year,
        "2026-09-01",
        employmentIntervals(HISTORY),
      ),
    ).toContain("2026-08");
  });

  it("hul mellem to ansættelser fjerner kun hullets måneder", () => {
    const rehired = [
      period({ validFrom: "2025-09-01", validTo: "2025-11-20" }),
      period({ validFrom: "2026-02-01", validTo: null }),
    ];
    const months = accruedMonthsForIntervals(
      year,
      "2026-09-01",
      employmentIntervals(rehired),
    );
    expect(months).toEqual([
      "2025-09",
      "2025-10",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
  });
});

// ─── Rapport-batch ──────────────────────────────────────────────────────────

function calendar(from: string, to: string) {
  const out = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    out.push({
      date: `${y}-${m}-${d}`,
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

function employee(over: Partial<DatasetEmployee> = {}): DatasetEmployee {
  return {
    userId: "u1",
    profileId: "p1",
    name: "Anna",
    email: "anna@example.dk",
    departmentId: "d1",
    departmentName: "Produktion",
    employmentType: "part_time",
    weeklyHours: 30,
    dailyNorm: 6,
    workingDays: WEEK,
    isActive: true,
    startDate: null,
    endDate: null,
    employeeNumber: "",
    externalPayrollId: "",
    employment: [],
    ...over,
  };
}

function dataset(over: Partial<EnterpriseDataset> = {}): EnterpriseDataset {
  return {
    orgId: "org",
    from: "2026-03-01",
    to: "2026-03-31",
    today: "2026-04-15",
    employees: [employee()],
    calendar: calendar("2026-03-01", "2026-03-31"),
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

describe("rapport-batch: normtid pr. periode (#465)", () => {
  const employmentNorms = [
    {
      validFrom: "2024-08-01",
      validTo: "2026-03-14",
      weeklyHours: 37,
      dailyNorm: 7.4,
      workingDays: WEEK,
      departmentId: "d1",
    },
    {
      validFrom: "2026-03-15",
      validTo: "2026-08-31",
      weeklyHours: 30,
      dailyNorm: 6,
      workingDays: WEEK,
      departmentId: "d1",
    },
  ];

  it("employmentNormOn: uden historik = nuværende; ellers periodens", () => {
    expect(employmentNormOn(employee(), "2026-03-01")).toEqual({
      dailyNorm: 6,
      workingDays: WEEK,
    });
    const e = employee({ employment: employmentNorms });
    expect(employmentNormOn(e, "2026-03-14")?.dailyNorm).toBe(7.4);
    expect(employmentNormOn(e, "2026-03-15")?.dailyNorm).toBe(6);
    expect(employmentNormOn(e, "2026-09-01")).toBeNull();
  });

  it("marts-normen i rapporten = 10 × 7,4 + 12 × 6,0 med skift 15/3", () => {
    const result = aggregateDataset(
      dataset({ employees: [employee({ employment: employmentNorms })] }),
      { dimensions: ["employee"], filters: reportFiltersSchema.parse({}) },
    );
    expect(result.totals.values.normHours).toBeCloseTo(10 * 7.4 + 12 * 6, 5);
    expect(result.totals.values.workDays).toBe(22);
  });

  it("kun én periode giver samme norm som uden historik", () => {
    const single = aggregateDataset(
      dataset({
        employees: [
          employee({
            employment: [{ ...employmentNorms[1], validFrom: "2020-01-01" }],
          }),
        ],
      }),
      { dimensions: ["employee"], filters: reportFiltersSchema.parse({}) },
    );
    const none = aggregateDataset(dataset(), {
      dimensions: ["employee"],
      filters: reportFiltersSchema.parse({}),
    });
    expect(single.totals.values.normHours).toBeCloseTo(
      Number(none.totals.values.normHours),
      5,
    );
    expect(none.totals.values.normHours).toBeCloseTo(22 * 6, 5);
  });

  it("fratrådt midt i måneden: dage efter fratrædelsen tæller ikke", () => {
    const result = aggregateDataset(
      dataset({
        employees: [
          employee({
            employment: [{ ...employmentNorms[0], validTo: "2026-03-13" }],
          }),
        ],
      }),
      { dimensions: ["employee"], filters: reportFiltersSchema.parse({}) },
    );
    // 2.-6. + 9.-13. marts = 10 arbejdsdage
    expect(result.totals.values.workDays).toBe(10);
    expect(result.totals.values.normHours).toBeCloseTo(74, 5);
  });
});

// ─── Datovalidering ved rettelse af periode ─────────────────────────────────

describe("validatePeriodDates (#465) — nabo-perioder", () => {
  const ended = {
    validFrom: "2024-08-01",
    validTo: "2026-08-31",
    endReason: "resigned",
  };
  const replaced = {
    validFrom: "2024-08-01",
    validTo: "2026-03-14",
    endReason: null,
  };

  it("previousDay håndterer måneds- og årsskift", () => {
    expect(previousDay("2026-03-01")).toBe("2026-02-28");
    expect(previousDay("2026-01-01")).toBe("2025-12-31");
  });

  it("genansættelse må ikke overlappe den afsluttede ansættelse", () => {
    expect(
      validatePeriodDates({
        validFrom: "2026-08-31",
        validTo: null,
        endReason: null,
        prev: ended,
        next: null,
      }),
    ).toMatch(/efter den forrige ansættelses ophør \(2026-08-31\)/);
    expect(
      validatePeriodDates({
        validFrom: "2026-09-01",
        validTo: null,
        endReason: null,
        prev: ended,
        next: null,
      }),
    ).toBeNull();
  });

  it("start skal ligge efter forrige periodes start; kun første må have ukendt start", () => {
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: null,
        endReason: null,
        prev: replaced,
        next: null,
      }),
    ).toMatch(/efter forrige periodes start/);
    expect(
      validatePeriodDates({
        validFrom: null,
        validTo: null,
        endReason: null,
        prev: replaced,
        next: null,
      }),
    ).toMatch(/Kun den første periode/);
  });

  it("afløst periode skal støde op til næste — ingen tavse huller", () => {
    const next = { validFrom: "2026-03-15" };
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: "2026-03-10",
        endReason: null,
        prev: null,
        next,
      }),
    ).toMatch(/dagen før næste periodes start \(2026-03-14\)/);
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: "2026-03-14",
        endReason: null,
        prev: null,
        next,
      }),
    ).toBeNull();
  });

  it("fratrædelse før en genansættelse må have hul, men ikke overlap", () => {
    const next = { validFrom: "2027-01-01" };
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: "2026-08-31",
        endReason: "resigned",
        prev: null,
        next,
      }),
    ).toBeNull();
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: "2027-01-01",
        endReason: "resigned",
        prev: null,
        next,
      }),
    ).toMatch(/før næste periodes start/);
    expect(
      validatePeriodDates({
        validFrom: "2024-08-01",
        validTo: null,
        endReason: null,
        prev: null,
        next,
      }),
    ).toMatch(/før næste periodes start/);
  });

  it("slut før start afvises", () => {
    expect(
      validatePeriodDates({
        validFrom: "2026-03-15",
        validTo: "2026-03-14",
        endReason: null,
        prev: null,
        next: null,
      }),
    ).toMatch(/Slutdatoen kan ikke ligge før startdatoen/);
  });
});
