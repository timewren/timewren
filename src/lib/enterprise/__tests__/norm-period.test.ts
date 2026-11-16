import { describe, expect, it } from "vitest";
import { addDaysToDateStr } from "@/lib/time/copenhagen";
import {
  applyCarryover,
  balanceStart,
  buildPeriodBalances,
  computeNormDay,
  countWorkdays,
  DEFAULT_FLEX_NORM_SETTINGS,
  type FlexNormSettings,
  formatPeriodLabel,
  type NormDay,
  type NormDayInput,
  normPeriodBounds,
  periodsInRange,
  sumNormDays,
} from "../norm-period";

const FULL = {
  dailyNorm: 7.4,
  workingDays: ["1", "2", "3", "4", "5"],
  grade: 1,
};

function day(date: string, extra: Partial<NormDayInput> = {}): NormDay {
  return computeNormDay({ date, employment: FULL, entryHours: 0, ...extra });
}

function range(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDaysToDateStr(d, 1)) out.push(d);
  return out;
}

describe("normPeriodBounds", () => {
  it("uge: mandag–søndag", () => {
    expect(normPeriodBounds("week", "calendar", "2026-10-01")).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
    });
  });

  it("måned", () => {
    expect(normPeriodBounds("month", "calendar", "2026-02-14")).toEqual({
      start: "2026-02-01",
      end: "2026-02-28",
    });
  });

  it("kvartal i kalenderår", () => {
    expect(normPeriodBounds("quarter", "calendar", "2026-11-15")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("kvartal i skoleår (aug–okt, nov–jan, …)", () => {
    expect(normPeriodBounds("quarter", "school", "2026-09-15")).toEqual({
      start: "2026-08-01",
      end: "2026-10-31",
    });
    expect(normPeriodBounds("quarter", "school", "2027-01-10")).toEqual({
      start: "2026-11-01",
      end: "2027-01-31",
    });
  });

  it("år: kalender- og skoleår", () => {
    expect(normPeriodBounds("year", "calendar", "2026-06-30")).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
    });
    expect(normPeriodBounds("year", "school", "2026-07-31")).toEqual({
      start: "2025-08-01",
      end: "2026-07-31",
    });
    expect(normPeriodBounds("year", "school", "2026-08-01")).toEqual({
      start: "2026-08-01",
      end: "2027-07-31",
    });
  });

  it("periodsInRange dækker intervallet uden huller", () => {
    const p = periodsInRange("month", "calendar", "2026-01-15", "2026-03-02");
    expect(p.map((b) => b.start)).toEqual([
      "2026-01-01",
      "2026-02-01",
      "2026-03-01",
    ]);
  });

  it("etiketter", () => {
    expect(
      formatPeriodLabel("week", "calendar", {
        start: "2025-12-29",
        end: "2026-01-04",
      }),
    ).toBe("uge 1 2026");
    expect(
      formatPeriodLabel("year", "school", {
        start: "2026-08-01",
        end: "2027-07-31",
      }),
    ).toBe("2026/27");
    expect(
      formatPeriodLabel("quarter", "calendar", {
        start: "2026-10-01",
        end: "2026-12-31",
      }),
    ).toBe("4. kvt. 2026");
  });
});

describe("computeNormDay", () => {
  it("arbejdsdag: norm = dagsnorm, registreret = tidsposter", () => {
    const d = day("2026-10-01", { entryHours: 8 });
    expect(d).toMatchObject({ gross: 7.4, net: 7.4, registered: 8 });
  });

  it("weekend og ikke ansat giver ingen norm", () => {
    expect(day("2026-10-03").net).toBe(0);
    expect(
      computeNormDay({ date: "2026-10-01", employment: null, entryHours: 3 }),
    ).toMatchObject({ gross: 0, net: 0, registered: 3, employed: false });
  });

  it("hel og halv fridag trækkes fra", () => {
    expect(day("2026-12-24", { dayOff: { isHalfDay: false } })).toMatchObject({
      gross: 7.4,
      daysOff: 7.4,
      net: 0,
    });
    expect(day("2026-12-31", { dayOff: { isHalfDay: true } })).toMatchObject({
      daysOff: 3.7,
      net: 3.7,
    });
  });

  it("ferie og andet fravær dækker normen efter fridage", () => {
    expect(day("2026-10-01", { absence: "vacation" })).toMatchObject({
      vacation: 7.4,
      otherAbsence: 0,
      net: 0,
    });
    expect(day("2026-10-01", { absence: "other" })).toMatchObject({
      otherAbsence: 7.4,
      net: 0,
    });
    expect(
      day("2026-10-01", {
        absence: "vacation",
        dayOff: { isHalfDay: true },
      }),
    ).toMatchObject({ vacation: 3.7, daysOff: 3.7, net: 0 });
  });

  it("arbejdsplan: planens timer er normen; afvigelse er faktisk tid", () => {
    // Lørdag i planen — normen følger planen, ikke arbejdsdagene
    const planned = day("2026-10-03", { plan: { onPlan: true, hours: 6 } });
    expect(planned).toMatchObject({ gross: 6, net: 6, registered: 6 });
    const deviated = day("2026-10-03", {
      plan: { onPlan: true, hours: 6 },
      deviationHours: 4,
      entryHours: 9,
    });
    expect(deviated.registered).toBe(4);
    const free = day("2026-10-01", { plan: { onPlan: true, hours: null } });
    expect(free.net).toBe(0);
  });

  it("årsnorm fordeles på arbejdsdagene × beskæftigelsesgrad", () => {
    const d = day("2026-10-01", {
      employment: { ...FULL, grade: 0.5 },
      annualGrossPerWorkday: 7.5,
    });
    expect(d.gross).toBeCloseTo(3.75);
    expect(day("2026-10-03", { annualGrossPerWorkday: 7.5 }).gross).toBe(0);
  });

  it("årsnorm: fridage og fravær trækker den fordelte dagsandel fra", () => {
    // 1800 t / 261 dage ≈ 6,9 t — under dagsnormen på 7,4
    const perDay = 1800 / 261;
    const holiday = day("2026-12-25", {
      dayOff: { isHalfDay: false },
      annualGrossPerWorkday: perDay,
    });
    expect(holiday.net).toBe(0);
    expect(holiday.daysOff).toBeCloseTo(perDay);
    const half = day("2026-12-31", {
      dayOff: { isHalfDay: true },
      annualGrossPerWorkday: perDay,
    });
    expect(half.net).toBeCloseTo(perDay / 2);
    const vacation = day("2026-10-01", {
      absence: "vacation",
      annualGrossPerWorkday: perDay,
    });
    expect(vacation).toMatchObject({ net: 0 });
    expect(vacation.vacation).toBeCloseTo(perDay);
  });
});

describe("skift i beskæftigelsesgrad midt i en periode", () => {
  it("dagsnorm: hver dag bruger den grad der gjaldt på dagen", () => {
    // Fuld tid t.o.m. 15/10, derefter 30 t/uge (6,0 pr. dag)
    const days = range("2026-10-01", "2026-10-31").map((date) =>
      day(date, {
        employment:
          date <= "2026-10-15"
            ? FULL
            : { dailyNorm: 6, workingDays: FULL.workingDays, grade: 30 / 37 },
      }),
    );
    const t = sumNormDays(days, { from: "2026-10-01", to: "2026-10-31" });
    // 11 hverdage à 7,4 + 11 hverdage à 6,0
    expect(t.gross).toBe(147.4);
    expect(t.net).toBe(147.4);
    expect(t.flex).toBe(-147.4);
    expect(t.grade).toBe(0.9);
  });

  it("årsnorm 1924 t: et helt skoleår på fuld tid giver 1924 t", () => {
    const year = normPeriodBounds("year", "school", "2026-09-01");
    const n = countWorkdays(year.start, year.end, FULL.workingDays);
    const days = range(year.start, year.end).map((date) =>
      day(date, { annualGrossPerWorkday: 1924 / n }),
    );
    expect(
      sumNormDays(days, { from: year.start, to: year.end }).gross,
    ).toBeCloseTo(1924, 1);
  });

  it("årsnorm: halv tid fra 1/2 giver forholdsmæssig bruttonorm", () => {
    const year = normPeriodBounds("year", "school", "2026-09-01");
    const n = countWorkdays(year.start, year.end, FULL.workingDays);
    const days = range(year.start, year.end).map((date) =>
      day(date, {
        employment: date < "2027-02-01" ? FULL : { ...FULL, grade: 0.5 },
        annualGrossPerWorkday: 1924 / n,
      }),
    );
    const first = countWorkdays(year.start, "2027-01-31", FULL.workingDays);
    const expected = (1924 / n) * first + (1924 / n) * 0.5 * (n - first);
    expect(
      sumNormDays(days, { from: year.start, to: year.end }).gross,
    ).toBeCloseTo(expected, 1);
  });
});

describe("sumNormDays", () => {
  it("i dag tæller kun den arbejdede del af normen", () => {
    const days = [
      day("2026-09-30", { entryHours: 7.4 }),
      day("2026-10-01", { entryHours: 2 }),
      day("2026-10-02", { entryHours: 0 }),
    ];
    const t = sumNormDays(days, {
      from: "2026-09-28",
      to: "2026-10-04",
      today: "2026-10-01",
    });
    expect(t.net).toBe(9.4);
    expect(t.flex).toBe(0);
    const full = sumNormDays(days, {
      from: "2026-09-28",
      to: "2026-10-04",
      today: "2026-10-01",
      partialToday: false,
    });
    expect(full.flex).toBe(-5.4);
  });

  it("optjent overtid trækkes fra flex", () => {
    const t = sumNormDays([day("2026-10-01", { entryHours: 10 })], {
      from: "2026-10-01",
      to: "2026-10-01",
      earnedOvertimeByDate: new Map([["2026-10-01", 1.6]]),
    });
    expect(t.flex).toBe(1);
  });

  it("tæller fraværsdage", () => {
    const t = sumNormDays(
      [
        day("2026-10-01", { absence: "vacation" }),
        day("2026-10-02", { absence: "other" }),
      ],
      { from: "2026-10-01", to: "2026-10-02" },
    );
    expect(t).toMatchObject({ vacationDays: 1, otherAbsenceDays: 1, net: 0 });
  });
});

describe("overførsel", () => {
  it("loft for plus og minus skærer af", () => {
    const s = { carryoverMaxHours: 10, carryoverMaxDeficitHours: 5 };
    expect(applyCarryover(12.5, s)).toEqual({ carryOut: 10, cutOff: 2.5 });
    expect(applyCarryover(-8, s)).toEqual({ carryOut: -5, cutOff: -3 });
    expect(applyCarryover(3, s)).toEqual({ carryOut: 3, cutOff: 0 });
    expect(
      applyCarryover(40, {
        carryoverMaxHours: null,
        carryoverMaxDeficitHours: null,
      }),
    ).toEqual({ carryOut: 40, cutOff: 0 });
    expect(
      applyCarryover(4, { carryoverMaxHours: 0, carryoverMaxDeficitHours: 0 }),
    ).toEqual({ carryOut: 0, cutOff: 4 });
  });

  it("løbende saldo over ugeperioder med loft", () => {
    const settings: FlexNormSettings = {
      ...DEFAULT_FLEX_NORM_SETTINGS,
      period: "week",
      carryoverMaxHours: 5,
      startDate: "2026-09-14",
    };
    // Uge 38: +2 t pr. hverdag (+10), uge 39: præcis norm, uge 40: −1 mandag
    const days = range("2026-09-14", "2026-10-04").map((date) => {
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      const workday = weekday >= 1 && weekday <= 5;
      let entry = 0;
      if (workday && date < "2026-09-21") entry = 9.4;
      else if (workday && date < "2026-09-28") entry = 7.4;
      else if (date === "2026-09-28") entry = 6.4;
      return day(date, { entryHours: entry });
    });
    const balances = buildPeriodBalances(days, settings, "2026-09-28");
    expect(balances.map((b) => b.start)).toEqual([
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(balances[0]).toMatchObject({
      closed: true,
      balance: 10,
      carryOut: 5,
      cutOff: 5,
    });
    expect(balances[1]).toMatchObject({ carryIn: 5, balance: 5, carryOut: 5 });
    // Indeværende uge til og med i dag (mandag 6,4 af 7,4 — tæller fuldt
    // kun når der er arbejdet mere end normen; under normen tæller i dag 0)
    expect(balances[2]).toMatchObject({ carryIn: 5, closed: false });
    expect(balances[2].totals.flex).toBe(0);
    expect(balances[2].periodNet).toBe(37);
  });

  it("uden startdato starter saldoen i indeværende periode", () => {
    expect(balanceStart(DEFAULT_FLEX_NORM_SETTINGS, "2026-10-01")).toBe(
      "2026-09-28",
    );
    expect(
      balanceStart(
        { ...DEFAULT_FLEX_NORM_SETTINGS, startDate: "2027-01-01" },
        "2026-10-01",
      ),
    ).toBe("2026-09-28");
  });
});
