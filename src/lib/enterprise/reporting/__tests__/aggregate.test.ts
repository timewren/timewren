import { describe, expect, it } from "vitest";
import {
  aggregateDataset,
  filterEmployees,
  isoWeekKey,
  NO_ACTIVITY_LABEL,
  timeFactPasses,
  vacationYearFor,
  vacationYearLabel,
  vacationYearRange,
} from "../aggregate";
import { reportFiltersSchema } from "../config";
import { expandAbsenceRequest } from "../dataset";
import type { DatasetEmployee, EnterpriseDataset } from "../types";

const filters = (
  over: Partial<ReturnType<typeof reportFiltersSchema.parse>> = {},
) => reportFiltersSchema.parse(over);

function employee(over: Partial<DatasetEmployee> = {}): DatasetEmployee {
  return {
    userId: "u1",
    profileId: "p1",
    name: "Anna",
    email: "anna@example.dk",
    departmentId: "d1",
    departmentName: "Produktion",
    employmentType: "full_time",
    weeklyHours: 37,
    dailyNorm: 7.4,
    workingDays: ["1", "2", "3", "4", "5"],
    isActive: true,
    startDate: null,
    endDate: null,
    employeeNumber: "1001",
    externalPayrollId: "",
    employment: [],
    ...over,
  };
}

function calendar(from: string, to: string, holidays: string[] = []) {
  const out = [];
  const cur = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, "0");
    const d = String(cur.getDate()).padStart(2, "0");
    const date = `${y}-${m}-${d}`;
    out.push({
      date,
      isHoliday: holidays.includes(date),
      isPayrollHoliday: holidays.includes(date),
      isHalfHoliday: false,
      holidayName: null,
      isClosure: false,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return out;
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

const timeFact = (over: Partial<EnterpriseDataset["time"][number]> = {}) => ({
  userId: "u1",
  date: "2026-03-02",
  projectId: "pr1",
  projectName: "Undervisning",
  activityTypeId: "a1",
  activityTypeName: "Undervisning",
  payrollCode: "100",
  source: "timesheet",
  approvalStatus: "approved",
  hours: 7.4,
  ...over,
});

const sickFact = (
  over: Partial<EnterpriseDataset["absence"][number]> = {},
) => ({
  userId: "u1",
  date: "2026-03-03",
  requestId: "r1",
  absenceTypeId: "t-sick",
  absenceTypeName: "Sygdom",
  category: "sickness",
  vacationPool: "vacation",
  deductsVacation: false,
  status: "approved",
  source: "manual",
  days: 1,
  hours: 7.4,
  isOpen: false,
  ...over,
});

describe("aggregateDataset — normtid og arbejdsdage", () => {
  it("tæller arbejdsdage uden helligdage og ganger med dagsnormen", () => {
    // Marts 2026: 22 hverdage; 1 helligdag fjernet → 21
    const ds = dataset({
      calendar: calendar("2026-03-01", "2026-03-31", ["2026-03-06"]),
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].values.workDays).toBe(21);
    expect(r.rows[0].values.normHours).toBe(155.4);
    expect(r.rows[0].labels.employee).toBe("Anna");
    expect(r.rows[0].attributes.email).toBe("anna@example.dk");
  });

  it("medarbejderens egen fridagskalender vinder over den fælles (#526)", () => {
    // Fælles kalender: 6/3 hel fridag. Annas afdeling: 6/3 arbejdsdag,
    // 9/3 hel og 10/3 halv fridag → 22 - 1 - 0,5 = 20,5 dage
    const ds = dataset({
      calendar: calendar("2026-03-01", "2026-03-31", ["2026-03-06"]),
      daysOffByUser: { u1: { "2026-03-09": false, "2026-03-10": true } },
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(r.rows[0].values.workDays).toBe(20.5);
    expect(r.rows[0].values.normHours).toBe(151.7);
  });

  it("respekterer ansættelsesperiode og inaktive medarbejdere", () => {
    const ds = dataset({
      employees: [
        employee({ startDate: "2026-03-30" }),
        employee({
          userId: "u2",
          profileId: "p2",
          name: "Bo",
          isActive: false,
        }),
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(r.rows.map((x) => x.labels.employee)).toEqual(["Anna"]);
    expect(r.rows[0].values.workDays).toBe(2); // 30/3 + 31/3
    const withInactive = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ includeInactive: true }),
    });
    expect(withInactive.rows).toHaveLength(2);
  });
});

describe("aggregateDataset — timer, filtre og pivot", () => {
  it("ekskluderer afviste timer som default og kan begrænses til godkendte", () => {
    const ds = dataset({
      time: [
        timeFact({ hours: 5 }),
        timeFact({ hours: 2, approvalStatus: "rejected" }),
        timeFact({
          hours: 3,
          approvalStatus: "pending",
          activityTypeId: null,
          activityTypeName: "",
        }),
      ],
    });
    const def = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(def.totals.values.hours).toBe(8);
    const all = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ includeRejected: true }),
    });
    expect(all.totals.values.hours).toBe(10);
    const approved = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ onlyApproved: true }),
    });
    expect(approved.totals.values.hours).toBe(5);
  });

  it("pivoterer timer pr. aktivitet med '(uden aktivitet)' sidst", () => {
    const ds = dataset({
      time: [
        timeFact({ hours: 4 }),
        timeFact({
          hours: 2,
          activityTypeId: "a2",
          activityTypeName: "Forberedelse",
          payrollCode: "200",
        }),
        timeFact({ hours: 1, activityTypeId: null, activityTypeName: "" }),
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(r.pivotNames.activities).toEqual([
      "Forberedelse",
      "Undervisning",
      NO_ACTIVITY_LABEL,
    ]);
    expect(r.rows[0].pivots.hoursByActivity).toEqual({
      Undervisning: 4,
      Forberedelse: 2,
      [NO_ACTIVITY_LABEL]: 1,
    });
  });

  it("grupperer på projekt × aktivitet og udfylder lønart når entydig", () => {
    const ds = dataset({
      time: [
        timeFact({ hours: 4 }),
        timeFact({ hours: 2, projectId: "pr2", projectName: "Værksted" }),
        timeFact({
          hours: 1,
          activityTypeId: "a2",
          activityTypeName: "Forberedelse",
          payrollCode: "200",
        }),
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["project", "activityType"],
      filters: filters(),
    });
    const withHours = r.rows.filter((x) => (x.values.hours as number) > 0);
    expect(
      withHours.map((x) => [
        x.labels.project,
        x.labels.activityType,
        x.values.hours,
        x.attributes.payrollCode,
      ]),
    ).toEqual([
      ["Undervisning", "Forberedelse", 1, "200"],
      ["Undervisning", "Undervisning", 4, "100"],
      ["Værksted", "Undervisning", 2, "100"],
    ]);
  });

  it("filtrerer på afdeling og projekt", () => {
    const D2 = "11111111-1111-4111-8111-111111111111";
    const PR1 = "22222222-2222-4222-8222-222222222222";
    const ds = dataset({
      employees: [
        employee(),
        employee({
          userId: "u2",
          profileId: "p2",
          name: "Bo",
          departmentId: D2,
          departmentName: "Køkken",
        }),
      ],
      time: [
        timeFact({ hours: 4, projectId: PR1 }),
        timeFact({
          userId: "u2",
          hours: 6,
          projectId: "pr2",
          projectName: "Køkken",
        }),
      ],
    });
    const dept = aggregateDataset(ds, {
      dimensions: ["department"],
      filters: filters({ departmentIds: [D2] }),
    });
    expect(dept.rows.map((x) => x.labels.department)).toEqual(["Køkken"]);
    expect(dept.totals.values.hours).toBe(6);
    const proj = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ projectIds: [PR1] }),
    });
    expect(proj.totals.values.hours).toBe(4);
  });
});

describe("aggregateDataset — sygefravær", () => {
  it("beregner sygedage, perioder og sygefraværs-% pr. afdeling × måned", () => {
    const ds = dataset({
      employees: [
        employee(),
        employee({ userId: "u2", profileId: "p2", name: "Bo" }),
      ],
      absence: [
        sickFact(),
        sickFact({ date: "2026-03-04" }),
        sickFact({
          userId: "u2",
          requestId: "r2",
          date: "2026-03-10",
          days: 0.5,
          hours: 3.7,
        }),
        // Ferie tæller ikke som sygdom
        sickFact({
          requestId: "r3",
          date: "2026-03-20",
          absenceTypeId: "t-vac",
          absenceTypeName: "Ferie",
          category: "vacation",
          deductsVacation: true,
        }),
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["department", "month"],
      filters: filters(),
    });
    expect(r.rows).toHaveLength(1);
    const row = r.rows[0];
    expect(row.labels.department).toBe("Produktion");
    expect(row.labels.month).toBe("2026-03");
    expect(row.values.workDays).toBe(44); // 22 hverdage × 2
    expect(row.values.sickDays).toBe(2.5);
    expect(row.values.sickPeriods).toBe(2);
    expect(row.values.sickPct).toBe(5.7); // 2,5 / 44
    expect(row.values.absenceDays).toBe(3.5);
    expect(row.values.vacationDaysInPeriod).toBe(1);
    expect(row.values.employeeCount).toBe(2);
    expect(row.pivots.absenceDaysByType).toEqual({ Sygdom: 2.5, Ferie: 1 });
  });

  it("flagger langtidssygdom ved sammenhængende periode over 30 dage", () => {
    const ds = dataset({
      absencePeriods: [
        {
          requestId: "r-long",
          userId: "u1",
          absenceTypeId: "t-sick",
          absenceTypeName: "Sygdom",
          category: "sickness",
          status: "approved",
          startDate: "2026-02-10",
          effectiveEndDate: "2026-03-20",
          calendarDays: 39,
          isOpen: false,
        },
        {
          requestId: "r-short",
          userId: "u1",
          absenceTypeId: "t-sick",
          absenceTypeName: "Sygdom",
          category: "sickness",
          status: "approved",
          startDate: "2026-03-25",
          effectiveEndDate: "2026-03-27",
          calendarDays: 3,
          isOpen: false,
        },
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(r.rows[0].values.longTermSick).toBe(true);
    expect(r.totals.values.longTermSickCount).toBe(1);
    // Eksakt 30 dage er ikke langtidssygdom
    const exact = aggregateDataset(
      dataset({
        absencePeriods: [{ ...ds.absencePeriods[0], calendarDays: 30 }],
      }),
      { dimensions: ["employee"], filters: filters() },
    );
    expect(exact.rows[0].values.longTermSick).toBe(false);
  });

  it("filtrerer fravær på status, type og kategori uden at røre timer", () => {
    const ds = dataset({
      time: [timeFact({ hours: 3 })],
      absence: [
        sickFact(),
        sickFact({ requestId: "r2", date: "2026-03-05", status: "pending" }),
      ],
    });
    const approvedOnly = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters(),
    });
    expect(approvedOnly.totals.values.sickDays).toBe(1);
    expect(approvedOnly.totals.values.hours).toBe(3);
    const both = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ absenceStatuses: ["approved", "pending"] }),
    });
    expect(both.totals.values.sickDays).toBe(2);
    const vacationOnly = aggregateDataset(ds, {
      dimensions: ["employee"],
      filters: filters({ absenceCategories: ["vacation"] }),
    });
    expect(vacationOnly.totals.values.sickDays).toBe(0);
    expect(vacationOnly.totals.values.hours).toBe(3);
  });
});

describe("aggregateDataset — flex, overtid, check-ind, ferieregnskab", () => {
  it("summerer flex og overtid pr. uge og beregner netto", () => {
    const ds = dataset({
      flex: [
        {
          userId: "u1",
          date: "2026-03-02",
          expectedHours: 7.4,
          actualHours: 8.4,
          delta: 1,
        },
        {
          userId: "u1",
          date: "2026-03-09",
          expectedHours: 7.4,
          actualHours: 6.9,
          delta: -0.5,
        },
      ],
      overtime: [
        { userId: "u1", date: "2026-03-02", type: "earned", hours: 4 },
        { userId: "u1", date: "2026-03-02", type: "used", hours: -1.5 },
        { userId: "u1", date: "2026-03-09", type: "paid_out", hours: -1 },
      ],
      checkIns: [
        { userId: "u1", date: "2026-03-02", hours: 8, breakDeductedHours: 0.5 },
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["week"],
      filters: filters(),
    });
    const w10 = r.rows.find((x) => x.labels.week === "2026-W10");
    const w11 = r.rows.find((x) => x.labels.week === "2026-W11");
    expect(w10?.values.flexDelta).toBe(1);
    expect(w10?.values.overtimeEarned).toBe(4);
    expect(w10?.values.overtimeUsed).toBe(1.5);
    expect(w10?.values.overtimeNet).toBe(2.5);
    expect(w10?.values.checkInHours).toBe(8);
    expect(w10?.values.breakDeductedHours).toBe(0.5);
    expect(w11?.values.overtimePaidOut).toBe(1);
    expect(r.totals.values.flexDelta).toBe(0.5);
    expect(r.totals.values.overtimeNet).toBe(1.5);
  });

  it("lægger feriesaldi på ferieår-dimensionen", () => {
    const ds = dataset({
      vacationBalances: [
        {
          userId: "u1",
          year: 2026,
          totalDays: 25,
          usedDays: 5,
          remainingDays: 20,
          extraTotalDays: 5,
          extraUsedDays: 1,
          extraRemainingDays: 4,
        },
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["employee", "vacationYear"],
      filters: filters(),
    });
    const row = r.rows.find((x) => x.labels.vacationYear === "2026");
    expect(row?.values.vacationAllotted).toBe(25);
    expect(row?.values.vacationRemaining).toBe(20);
    expect(row?.values.extraVacationUsed).toBe(1);
  });
});

describe("ferieår-bucketing", () => {
  it("kalenderår som default", () => {
    expect(vacationYearFor("2026-08-31")).toBe(2026);
    expect(vacationYearLabel(2026)).toBe("2026");
    expect(vacationYearRange(2026)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
  });

  it("ferieår 1/9–31/8 når startmåned er 9", () => {
    expect(vacationYearFor("2026-08-31", 9)).toBe(2025);
    expect(vacationYearFor("2026-09-01", 9)).toBe(2026);
    expect(vacationYearLabel(2025, 9)).toBe("2025/26");
    expect(vacationYearRange(2025, 9)).toEqual({
      from: "2025-09-01",
      to: "2026-08-31",
    });
  });

  it("bucketer fakta i ferieår efter startmåned", () => {
    const ds = dataset({
      from: "2026-08-01",
      to: "2026-09-30",
      calendar: calendar("2026-08-01", "2026-09-30"),
      time: [
        timeFact({ date: "2026-08-28", hours: 2 }),
        timeFact({ date: "2026-09-02", hours: 3 }),
      ],
    });
    const r = aggregateDataset(ds, {
      dimensions: ["vacationYear"],
      filters: filters(),
      vacationYearStartMonth: 9,
    });
    expect(r.rows.map((x) => [x.labels.vacationYear, x.values.hours])).toEqual([
      ["2025/26", 2],
      ["2026/27", 3],
    ]);
  });

  it("isoWeekKey følger ISO 8601 (1/1-2027 er uge 53 i 2026)", () => {
    expect(isoWeekKey("2026-03-02")).toBe("2026-W10");
    expect(isoWeekKey("2027-01-01")).toBe("2026-W53");
  });
});

describe("hjælpere", () => {
  it("filterEmployees og timeFactPasses er rene", () => {
    expect(
      filterEmployees(
        [employee(), employee({ userId: "u2", isActive: false })],
        filters(),
      ),
    ).toHaveLength(1);
    expect(
      timeFactPasses(
        { approvalStatus: "rejected", projectId: null, activityTypeId: null },
        filters(),
      ),
    ).toBe(false);
    expect(
      timeFactPasses(
        {
          approvalStatus: "not_required",
          projectId: null,
          activityTypeId: null,
        },
        filters(),
      ),
    ).toBe(true);
  });

  it("expandAbsenceRequest udfolder kun arbejdsdage, håndterer halve og delvise dage og åbne perioder", () => {
    const base = {
      id: "r1",
      userId: "u1",
      absenceTypeId: "t",
      halfDayStart: false,
      halfDayEnd: false,
      hoursPerDay: null,
      status: "approved",
      source: "manual",
    };
    const type = {
      name: "Sygdom",
      category: "sickness",
      vacationPool: "vacation",
      deductsVacation: false,
    };
    const emp = { dailyNorm: 7.4, workingDays: ["1", "2", "3", "4", "5"] };
    const common = {
      type,
      employee: emp,
      from: "2026-03-01",
      to: "2026-03-31",
      today: "2026-03-12",
    };

    // Fre 6/3 – tir 10/3: fre, man, tir = 3 dage; helligdag 9/3 fjernes
    const days = expandAbsenceRequest({
      ...common,
      request: {
        ...base,
        startDate: "2026-03-06",
        endDate: "2026-03-10",
        halfDayEnd: true,
      },
      fullDayHolidays: new Set(["2026-03-09"]),
    });
    expect(days.map((d) => [d.date, d.days, d.hours])).toEqual([
      ["2026-03-06", 1, 7.4],
      ["2026-03-10", 0.5, 3.7],
    ]);

    // Delvis sygdom 3,7 t/dag = halv dag
    const partial = expandAbsenceRequest({
      ...common,
      request: {
        ...base,
        startDate: "2026-03-02",
        endDate: "2026-03-02",
        hoursPerDay: "3.7",
      },
      fullDayHolidays: new Set(),
    });
    expect(partial[0].days).toBe(0.5);
    expect(partial[0].hours).toBe(3.7);

    // Åben periode fra tor 5/3 tæller til og med i dag (tor 12/3) → 6 arbejdsdage
    const open = expandAbsenceRequest({
      ...common,
      request: { ...base, startDate: "2026-03-05", endDate: null },
      fullDayHolidays: new Set(),
    });
    expect(open).toHaveLength(6);
    expect(open.every((d) => d.isOpen)).toBe(true);
  });
});
