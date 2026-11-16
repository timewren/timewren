import { describe, expect, it } from "vitest";
import type {
  AbsenceFact,
  CalendarDay,
  DatasetEmployee,
  TimeFact,
} from "../../reporting/types";
import {
  buildDayInfoLookup,
  dayConditionMatches,
  isWeekendDate,
  type MappingRule,
  mapFactsToWageLines,
  matchRules,
  type PayrollMappingConfig,
  sortRules,
  summarizeUnmapped,
  summarizeWageLines,
  type WageType,
  wageTypeLabel,
} from "../mapping";

const wt = (
  over: Partial<WageType> & { id: string; code: string },
): WageType => ({
  name: over.code,
  unit: "hours",
  kind: "time",
  isArchived: false,
  ...over,
});

const rule = (
  over: Partial<MappingRule> & { id: string; wageTypeId: string },
): MappingRule => ({
  source: "activity",
  activityTypeId: null,
  absenceTypeId: null,
  dayCondition: "any",
  priority: 100,
  isArchived: false,
  ...over,
});

const timeFact = (over: Partial<TimeFact> = {}): TimeFact => ({
  userId: "u1",
  date: "2026-03-02", // mandag
  projectId: "pr1",
  projectName: "Undervisning",
  activityTypeId: "a1",
  activityTypeName: "Undervisning",
  payrollCode: "",
  source: "timesheet",
  approvalStatus: "approved",
  hours: 7.4,
  ...over,
});

const absenceFact = (over: Partial<AbsenceFact> = {}): AbsenceFact => ({
  userId: "u1",
  date: "2026-03-03",
  requestId: "r1",
  absenceTypeId: "s1",
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

const calendar = (holidays: string[] = []): CalendarDay[] =>
  ["2026-03-02", "2026-03-03", "2026-03-07", "2026-04-03"].map((date) => ({
    date,
    isHoliday: holidays.includes(date),
    isPayrollHoliday: holidays.includes(date),
    isHalfHoliday: false,
    holidayName: null,
    isClosure: false,
  }));

const config = (
  over: Partial<PayrollMappingConfig> = {},
): PayrollMappingConfig => ({
  wageTypes: [
    wt({ id: "w-normal", code: "0100", name: "Normaltimer" }),
    wt({ id: "w-teach", code: "0110", name: "Undervisning" }),
    wt({
      id: "w-sick",
      code: "0300",
      name: "Sygdom",
      unit: "days",
      kind: "absence",
    }),
    wt({
      id: "w-weekend",
      code: "0500",
      name: "Weekendtillæg",
      kind: "supplement",
    }),
    wt({ id: "w-ot", code: "0200", name: "Overtid" }),
  ],
  rules: [],
  ...over,
});

const emptyInput = {
  calendar: calendar(),
  time: [] as TimeFact[],
  absence: [] as AbsenceFact[],
  overtime: [],
  flex: [],
  checkIns: [],
  absenceTypes: [] as Array<{ id: string; name: string; payrollCode: string }>,
};

describe("dag-betingelser", () => {
  it("kender weekend", () => {
    expect(isWeekendDate("2026-03-07")).toBe(true); // lørdag
    expect(isWeekendDate("2026-03-08")).toBe(true); // søndag
    expect(isWeekendDate("2026-03-02")).toBe(false);
  });
  it("matcher betingelser", () => {
    const wk = { isWeekend: true, isHoliday: false };
    const hol = { isWeekend: false, isHoliday: true };
    const plain = { isWeekend: false, isHoliday: false };
    expect(dayConditionMatches("any", plain)).toBe(true);
    expect(dayConditionMatches("weekend", wk)).toBe(true);
    expect(dayConditionMatches("weekend", hol)).toBe(false);
    expect(dayConditionMatches("holiday", hol)).toBe(true);
    expect(dayConditionMatches("weekend_or_holiday", wk)).toBe(true);
    expect(dayConditionMatches("weekend_or_holiday", hol)).toBe(true);
    expect(dayConditionMatches("weekend_or_holiday", plain)).toBe(false);
  });
});

describe("sortRules / matchRules — prioritering", () => {
  it("laveste prioritet vinder, derefter mest specifik", () => {
    const rules = [
      rule({ id: "wild", wageTypeId: "w-normal", priority: 100 }),
      rule({
        id: "spec",
        wageTypeId: "w-teach",
        priority: 100,
        activityTypeId: "a1",
      }),
      rule({
        id: "specDay",
        wageTypeId: "w-teach",
        priority: 100,
        activityTypeId: "a1",
        dayCondition: "weekend",
      }),
      rule({ id: "prio", wageTypeId: "w-normal", priority: 1 }),
    ];
    expect(sortRules(rules).map((r) => r.id)).toEqual([
      "prio",
      "specDay",
      "spec",
      "wild",
    ]);
  });

  it("specifik aktivitet slår wildcard ved samme prioritet", () => {
    const cfg = config({
      rules: [
        rule({ id: "wild", wageTypeId: "w-normal" }),
        rule({ id: "spec", wageTypeId: "w-teach", activityTypeId: "a1" }),
      ],
    });
    const day = { isWeekend: false, isHoliday: false };
    expect(
      matchRules(cfg, { source: "activity", activityTypeId: "a1", day }).primary
        ?.id,
    ).toBe("spec");
    expect(
      matchRules(cfg, { source: "activity", activityTypeId: "a2", day }).primary
        ?.id,
    ).toBe("wild");
  });

  it("ignorerer arkiverede regler og regler til arkiverede lønarter", () => {
    const cfg = config({
      wageTypes: [
        wt({ id: "w-normal", code: "0100" }),
        wt({ id: "w-old", code: "0999", isArchived: true }),
      ],
      rules: [
        rule({
          id: "arch",
          wageTypeId: "w-normal",
          priority: 1,
          isArchived: true,
        }),
        rule({ id: "oldwt", wageTypeId: "w-old", priority: 2 }),
        rule({ id: "ok", wageTypeId: "w-normal", priority: 3 }),
      ],
    });
    const day = { isWeekend: false, isHoliday: false };
    expect(matchRules(cfg, { source: "activity", day }).primary?.id).toBe("ok");
  });

  it("tillæg samles separat og dedupes pr. lønart", () => {
    const cfg = config({
      rules: [
        rule({ id: "base", wageTypeId: "w-normal" }),
        rule({
          id: "sup1",
          wageTypeId: "w-weekend",
          dayCondition: "weekend",
          priority: 5,
        }),
        rule({
          id: "sup2",
          wageTypeId: "w-weekend",
          dayCondition: "weekend_or_holiday",
          priority: 9,
        }),
      ],
    });
    const res = matchRules(cfg, {
      source: "activity",
      day: { isWeekend: true, isHoliday: false },
    });
    expect(res.primary?.id).toBe("base");
    expect(res.supplements.map((r) => r.id)).toEqual(["sup1"]);
  });
});

describe("mapFactsToWageLines — aktivitet", () => {
  it("mapper timer til lønart via regel", () => {
    const cfg = config({
      rules: [rule({ id: "r", wageTypeId: "w-teach", activityTypeId: "a1" })],
    });
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      time: [timeFact()],
    });
    expect(unmapped).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      code: "0110",
      unit: "hours",
      quantity: 7.4,
      supplement: false,
      wageTypeId: "w-teach",
    });
  });

  it("falder tilbage til aktivitetstypens payrollCode uden regel", () => {
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: config(),
      time: [timeFact({ payrollCode: "0777" })],
    });
    expect(unmapped).toEqual([]);
    expect(lines[0]).toMatchObject({
      code: "0777",
      wageTypeId: null,
      name: "Undervisning",
      unit: "hours",
    });
  });

  it("melder unmapped når hverken regel eller kode findes", () => {
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: config(),
      time: [timeFact()],
    });
    expect(lines).toEqual([]);
    expect(unmapped).toHaveLength(1);
    expect(unmapped[0]).toMatchObject({
      source: "activity",
      label: "Undervisning",
      quantity: 7.4,
      unit: "hours",
    });
  });

  it("weekendtillæg lægges oven på grundlønarten — ikke i stedet for", () => {
    const cfg = config({
      rules: [
        rule({ id: "base", wageTypeId: "w-normal" }),
        rule({ id: "sup", wageTypeId: "w-weekend", dayCondition: "weekend" }),
      ],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      time: [
        timeFact({ date: "2026-03-02", hours: 4 }),
        timeFact({ date: "2026-03-07", hours: 3 }),
      ],
    });
    expect(
      lines.map((l) => [l.date, l.code, l.quantity, l.supplement]),
    ).toEqual([
      ["2026-03-02", "0100", 4, false],
      ["2026-03-07", "0100", 3, false],
      ["2026-03-07", "0500", 3, true],
    ]);
  });

  it("helligdagsregel vinder over almindelig regel på helligdagen", () => {
    const cfg = config({
      rules: [
        rule({ id: "base", wageTypeId: "w-normal" }),
        rule({ id: "hol", wageTypeId: "w-ot", dayCondition: "holiday" }),
      ],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      calendar: calendar(["2026-04-03"]),
      config: cfg,
      time: [
        timeFact({ date: "2026-04-03", hours: 2 }),
        timeFact({ date: "2026-03-02", hours: 2 }),
      ],
    });
    expect(lines.map((l) => [l.date, l.code])).toEqual([
      ["2026-04-03", "0200"],
      ["2026-03-02", "0100"],
    ]);
  });

  it("springer 0-timers fakta over", () => {
    const cfg = config({ rules: [rule({ id: "r", wageTypeId: "w-normal" })] });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      time: [timeFact({ hours: 0 })],
    });
    expect(lines).toEqual([]);
  });
});

describe("løn-helligdag (#742)", () => {
  const day = (over: Partial<CalendarDay> & { date: string }): CalendarDay => ({
    isHoliday: false,
    isPayrollHoliday: false,
    isHalfHoliday: false,
    holidayName: null,
    isClosure: false,
    ...over,
  });

  it("en firmafridag (fri, men ikke helligdag) er ikke helligdag i lønnen", () => {
    const info = buildDayInfoLookup([
      day({ date: "2026-08-14", isHoliday: true, holidayName: "Sommerfest" }),
      day({ date: "2026-04-03", isHoliday: true, isPayrollHoliday: true }),
    ]);
    expect(info("2026-08-14").isHoliday).toBe(false);
    expect(info("2026-04-03").isHoliday).toBe(true);
  });

  it("medarbejderens egen (afdelings)kalender vinder over org'ens", () => {
    const info = buildDayInfoLookup(
      [
        day({ date: "2026-12-24" }),
        day({ date: "2026-04-03", isPayrollHoliday: true }),
      ],
      { u1: ["2026-12-24", "2026-04-03"], u2: [] },
    );
    expect(info("2026-12-24", "u1").isHoliday).toBe(true);
    expect(info("2026-12-24", "u2").isHoliday).toBe(false);
    expect(info("2026-04-03", "u2").isHoliday).toBe(false);
    // Ukendt bruger → den fælles kalender
    expect(info("2026-04-03", "u3").isHoliday).toBe(true);
  });

  it("helligdagsregel bruger medarbejderens kalender", () => {
    const cfg = config({
      rules: [
        rule({ id: "base", wageTypeId: "w-normal" }),
        rule({ id: "hol", wageTypeId: "w-ot", dayCondition: "holiday" }),
      ],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      payrollHolidaysByUser: { u1: ["2026-03-02"] },
      time: [timeFact({ date: "2026-03-02", hours: 2 })],
    });
    expect(lines.map((l) => [l.userId, l.code])).toEqual([["u1", "0200"]]);
  });
});

describe("mapFactsToWageLines — fravær", () => {
  it("bruger lønartens enhed (dage vs. timer)", () => {
    const cfg = config({
      wageTypes: [
        wt({ id: "w-sick-d", code: "0300", unit: "days", kind: "absence" }),
        wt({ id: "w-sick-h", code: "0301", unit: "hours", kind: "absence" }),
      ],
      rules: [
        rule({
          id: "d",
          wageTypeId: "w-sick-d",
          source: "absence",
          absenceTypeId: "s1",
        }),
        rule({
          id: "h",
          wageTypeId: "w-sick-h",
          source: "absence",
          absenceTypeId: "s2",
        }),
      ],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      absence: [
        absenceFact({ days: 0.5, hours: 3.7 }),
        absenceFact({ absenceTypeId: "s2", days: 0.5, hours: 3.7 }),
      ],
    });
    expect(lines.map((l) => [l.code, l.unit, l.quantity])).toEqual([
      ["0300", "days", 0.5],
      ["0301", "hours", 3.7],
    ]);
  });

  it("falder tilbage til fraværstypens payrollCode i dage", () => {
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: config(),
      absence: [absenceFact()],
      absenceTypes: [{ id: "s1", name: "Sygdom", payrollCode: "0390" }],
    });
    expect(unmapped).toEqual([]);
    expect(lines[0]).toMatchObject({
      code: "0390",
      unit: "days",
      quantity: 1,
      wageTypeId: null,
    });
  });

  it("unmapped fravær uden regel og kode", () => {
    const { unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: config(),
      absence: [absenceFact()],
    });
    expect(unmapped[0]).toMatchObject({
      source: "absence",
      label: "Sygdom",
      unit: "days",
      quantity: 1,
    });
  });

  it("wildcard-fraværsregel fanger alle typer", () => {
    const cfg = config({
      rules: [rule({ id: "all", wageTypeId: "w-sick", source: "absence" })],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      absence: [
        absenceFact(),
        absenceFact({
          absenceTypeId: "v1",
          absenceTypeName: "Ferie",
          category: "vacation",
        }),
      ],
    });
    expect(lines).toHaveLength(2);
    expect(lines.every((l) => l.code === "0300")).toBe(true);
  });
});

describe("mapFactsToWageLines — overtid, flex, pause", () => {
  it("overtid mappes pr. type og er unmapped uden regel", () => {
    const cfg = config({
      rules: [
        rule({ id: "ot", wageTypeId: "w-ot", source: "overtime_paid_out" }),
      ],
    });
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      overtime: [
        { userId: "u1", date: "2026-03-02", type: "paid_out", hours: -5 },
        { userId: "u1", date: "2026-03-02", type: "earned", hours: 2 },
        { userId: "u1", date: "2026-03-02", type: "adjustment", hours: 1 },
      ],
    });
    expect(lines).toEqual([
      expect.objectContaining({
        code: "0200",
        quantity: 5,
        source: "overtime_paid_out",
      }),
    ]);
    expect(unmapped).toEqual([
      expect.objectContaining({ source: "overtime_earned", quantity: 2 }),
    ]);
  });

  it("flex og pausefradrag eksporteres kun med regel — aldrig unmapped", () => {
    const { lines, unmapped } = mapFactsToWageLines({
      ...emptyInput,
      config: config(),
      flex: [
        {
          userId: "u1",
          date: "2026-03-02",
          expectedHours: 7.4,
          actualHours: 9,
          delta: 1.6,
        },
      ],
      checkIns: [
        { userId: "u1", date: "2026-03-02", hours: 8, breakDeductedHours: 0.5 },
      ],
    });
    expect(lines).toEqual([]);
    expect(unmapped).toEqual([]);

    const cfg = config({
      rules: [
        rule({ id: "fp", wageTypeId: "w-ot", source: "flex_positive" }),
        rule({ id: "fn", wageTypeId: "w-normal", source: "flex_negative" }),
        rule({ id: "br", wageTypeId: "w-normal", source: "break_deduction" }),
      ],
    });
    const res = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      flex: [
        {
          userId: "u1",
          date: "2026-03-02",
          expectedHours: 7.4,
          actualHours: 9,
          delta: 1.6,
        },
        {
          userId: "u1",
          date: "2026-03-03",
          expectedHours: 7.4,
          actualHours: 6,
          delta: -1.4,
        },
      ],
      checkIns: [
        { userId: "u1", date: "2026-03-02", hours: 8, breakDeductedHours: 0.5 },
      ],
    });
    expect(res.lines.map((l) => [l.source, l.code, l.quantity])).toEqual([
      ["flex_positive", "0200", 1.6],
      ["flex_negative", "0100", 1.4],
      ["break_deduction", "0100", 0.5],
    ]);
  });
});

const employees: Array<
  Pick<
    DatasetEmployee,
    | "userId"
    | "name"
    | "employeeNumber"
    | "externalPayrollId"
    | "departmentName"
  >
> = [
  {
    userId: "u1",
    name: "Bo",
    employeeNumber: "1001",
    externalPayrollId: "",
    departmentName: "A",
  },
  {
    userId: "u2",
    name: "Anna",
    employeeNumber: "",
    externalPayrollId: "",
    departmentName: "B",
  },
];

describe("summarizeWageLines — summering og afrunding", () => {
  it("afrunder først efter summering (0,333 × 3 = 1,00)", () => {
    const cfg = config({ rules: [rule({ id: "r", wageTypeId: "w-normal" })] });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      time: [
        timeFact({ hours: 0.333 }),
        timeFact({ hours: 0.333, date: "2026-03-03" }),
        timeFact({ hours: 0.334, date: "2026-03-07" }),
      ],
    });
    const totals = summarizeWageLines(lines, employees);
    expect(totals).toHaveLength(1);
    expect(totals[0].quantity).toBe(1);
  });

  it("grupperer pr. medarbejder × lønart × enhed, sorteret på navn og kode", () => {
    const cfg = config({
      rules: [
        rule({ id: "r", wageTypeId: "w-normal" }),
        rule({ id: "s", wageTypeId: "w-sick", source: "absence" }),
      ],
    });
    const { lines } = mapFactsToWageLines({
      ...emptyInput,
      config: cfg,
      time: [
        timeFact({ hours: 2 }),
        timeFact({ hours: 3, date: "2026-03-03" }),
        timeFact({ userId: "u2", hours: 1 }),
      ],
      absence: [absenceFact({ userId: "u2" })],
    });
    const totals = summarizeWageLines(lines, employees);
    expect(
      totals.map((t) => [
        t.employeeName,
        t.employeeNumber,
        t.code,
        t.unit,
        t.quantity,
      ]),
    ).toEqual([
      ["Anna", "", "0100", "hours", 1],
      ["Anna", "", "0300", "days", 1],
      ["Bo", "1001", "0100", "hours", 5],
    ]);
  });

  it("fjerner nul-totaler og afrunder til 2 decimaler", () => {
    const totals = summarizeWageLines(
      [
        {
          userId: "u1",
          date: "2026-03-02",
          source: "activity",
          wageTypeId: null,
          code: "X",
          name: "X",
          unit: "hours",
          quantity: 1.006,
          supplement: false,
          projectId: null,
          projectName: "",
          activityTypeId: null,
          activityTypeName: "",
          absenceTypeId: null,
          absenceTypeName: "",
        },
        {
          userId: "u1",
          date: "2026-03-02",
          source: "activity",
          wageTypeId: null,
          code: "Y",
          name: "Y",
          unit: "hours",
          quantity: 0.001,
          supplement: false,
          projectId: null,
          projectName: "",
          activityTypeId: null,
          activityTypeName: "",
          absenceTypeId: null,
          absenceTypeName: "",
        },
      ],
      employees,
    );
    expect(totals.map((t) => [t.code, t.quantity])).toEqual([["X", 1.01]]);
  });
});

describe("summarizeUnmapped / wageTypeLabel", () => {
  it("summerer unmapped pr. kilde og label med medarbejdertal", () => {
    const res = summarizeUnmapped([
      {
        userId: "u1",
        date: "d",
        source: "activity",
        label: "Møde",
        unit: "hours",
        quantity: 1,
      },
      {
        userId: "u2",
        date: "d",
        source: "activity",
        label: "Møde",
        unit: "hours",
        quantity: 2.5,
      },
      {
        userId: "u1",
        date: "d",
        source: "absence",
        label: "Ferie",
        unit: "days",
        quantity: 1,
      },
    ]);
    expect(res).toEqual([
      {
        source: "activity",
        label: "Møde",
        unit: "hours",
        quantity: 3.5,
        employeeCount: 2,
      },
      {
        source: "absence",
        label: "Ferie",
        unit: "days",
        quantity: 1,
        employeeCount: 1,
      },
    ]);
  });
  it("laver pivot-labels med kode, navn og enhed", () => {
    expect(
      wageTypeLabel({ code: "0100", name: "Normaltimer", unit: "hours" }),
    ).toBe("0100 Normaltimer (timer)");
    expect(wageTypeLabel({ code: "0300", name: "0300", unit: "days" })).toBe(
      "0300 (dage)",
    );
  });
});
