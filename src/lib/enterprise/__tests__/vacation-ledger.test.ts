import { describe, expect, it } from "vitest";
import {
  accruedMonthsForIntervals,
  accruedMonthsInPeriod,
  applyBalanceDelta,
  applyConversionFactor,
  calculateConversionFactor,
  monthlyAccrualDays,
  nextVacationPeriod,
  periodLabelFor,
  planRollover,
  previousMonthKey,
  projectVacationBalance,
  proRataForPeriod,
  proRataVacationDays,
  vacationDeductionFactor,
  vacationPeriodFor,
  vacationYearOf,
} from "../vacation";

describe("vacationPeriodFor (#461)", () => {
  it("startmåned 1 = kalenderår (freelance-default, uændret)", () => {
    expect(vacationPeriodFor("2026-03-15", 1)).toEqual({
      start: "2026-01-01",
      end: "2026-12-31",
      year: 2026,
      label: "2026",
    });
    expect(vacationPeriodFor("2026-03-15")).toEqual(
      vacationPeriodFor("2026-03-15", 1),
    );
  });

  it("startmåned 9: 15/3-2026 → 1/9-2025..31/8-2026", () => {
    expect(vacationPeriodFor("2026-03-15", 9)).toEqual({
      start: "2025-09-01",
      end: "2026-08-31",
      year: 2025,
      label: "Ferieår 2025/26",
    });
  });

  it("startmåned 9: 1/9 og 31/8 ligger i hver sit ferieår", () => {
    expect(vacationPeriodFor("2026-09-01", 9).start).toBe("2026-09-01");
    expect(vacationPeriodFor("2026-08-31", 9).start).toBe("2025-09-01");
    expect(vacationPeriodFor("2026-08-31", 9).end).toBe("2026-08-31");
  });

  it("ugyldig startmåned falder tilbage til kalenderår", () => {
    expect(vacationPeriodFor("2026-06-01", 0).start).toBe("2026-01-01");
    expect(vacationPeriodFor("2026-06-01", 13).start).toBe("2026-01-01");
  });

  it("vacationYearOf er startåret", () => {
    expect(vacationYearOf("2026-03-15")).toBe(2026);
    expect(vacationYearOf("2026-03-15", 9)).toBe(2025);
    expect(vacationYearOf("2026-10-01", 9)).toBe(2026);
  });

  it("nextVacationPeriod følger lige efter", () => {
    const p = vacationPeriodFor("2026-03-15", 9);
    expect(nextVacationPeriod(p, 9)).toMatchObject({
      start: "2026-09-01",
      end: "2027-08-31",
      label: "Ferieår 2026/27",
    });
    expect(
      nextVacationPeriod(vacationPeriodFor("2026-05-01", 1), 1).start,
    ).toBe("2027-01-01");
  });

  it("periodLabelFor udleder label af startdatoen", () => {
    expect(periodLabelFor("2026-01-01")).toBe("2026");
    expect(periodLabelFor("2025-09-01")).toBe("Ferieår 2025/26");
  });
});

describe("proRataForPeriod (#461)", () => {
  const sept = { start: "2025-09-01", end: "2026-08-31" };

  it("start før perioden → fuld pulje; efter → 0", () => {
    expect(proRataForPeriod(25, "2020-01-01", sept)).toBe(25);
    expect(proRataForPeriod(25, null, sept)).toBe(25);
    expect(proRataForPeriod(25, "2026-09-01", sept)).toBe(0);
  });

  it("start 1/3-2026 i 1/9-ferieår → 6/12 = 12,5", () => {
    expect(proRataForPeriod(25, "2026-03-01", sept)).toBe(12.5);
  });

  it("start 15/3-2026 i 1/9-ferieår → 5/12 (apr–aug) = 10,5", () => {
    // 25 × 5/12 = 10,42 → 10,5
    expect(proRataForPeriod(25, "2026-03-15", sept)).toBe(10.5);
  });

  it("kalenderår-varianten er uændret for startMonth 1", () => {
    expect(proRataVacationDays(25, "2026-08-15", 2026)).toBe(8.5);
    expect(proRataVacationDays(25, "2026-08-01", 2026)).toBe(10.5);
    expect(proRataVacationDays(25, "2026-01-01", 2026)).toBe(25);
  });
});

describe("monthlyAccrualDays + vacationDeductionFactor (#461)", () => {
  it("optjening er flat 2,08 uanset timetal (saldoen er i dage)", () => {
    expect(monthlyAccrualDays()).toBe(2.08);
    expect(monthlyAccrualDays(2.5)).toBe(2.5);
  });

  it("monthly-org: 1 feriedag koster 1 dag — også for 22,5 t deltid", () => {
    expect(
      vacationDeductionFactor(
        { accrualMode: "monthly", defaultWeeklyHours: 37 },
        22.5,
      ),
    ).toBe(1);
    expect(
      applyConversionFactor(
        3,
        vacationDeductionFactor(
          { accrualMode: "monthly", defaultWeeklyHours: 37 },
          22.5,
        ),
      ),
    ).toBe(3);
  });

  it("upfront-org (freelance/legacy): FTE-konvertering uændret", () => {
    const factor = vacationDeductionFactor(
      { accrualMode: "upfront", defaultWeeklyHours: 37 },
      22.5,
    );
    expect(factor).toBeCloseTo(37 / 22.5, 6);
    expect(applyConversionFactor(1, factor)).toBe(1.64);
    expect(
      vacationDeductionFactor(
        { accrualMode: "upfront", defaultWeeklyHours: 37 },
        37,
      ),
    ).toBe(1);
  });

  it("fuldtidsnormen kommer fra org'en, ikke hardcoded 37", () => {
    expect(calculateConversionFactor(20, 40)).toBe(2);
    expect(calculateConversionFactor(20)).toBe(1.85);
    expect(
      vacationDeductionFactor(
        { accrualMode: "upfront", defaultWeeklyHours: 40 },
        20,
      ),
    ).toBe(2);
  });
});

describe("accruedMonthsInPeriod (#461)", () => {
  const sept = { start: "2025-09-01", end: "2026-08-31" };

  it("kun afsluttede måneder pr. asOf", () => {
    expect(accruedMonthsInPeriod(sept, "2026-03-15")).toEqual([
      "2025-09",
      "2025-10",
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
    ]);
  });

  it("d. 1. i måneden: forrige måned er afsluttet", () => {
    expect(accruedMonthsInPeriod(sept, "2025-10-01")).toEqual(["2025-09"]);
    expect(accruedMonthsInPeriod(sept, "2025-09-30")).toEqual([]);
  });

  it("ansat midt i en måned optjener fra næste måned; startdato d. 1. tæller med", () => {
    expect(accruedMonthsInPeriod(sept, "2026-01-01", "2025-11-15")).toEqual([
      "2025-12",
    ]);
    expect(accruedMonthsInPeriod(sept, "2026-01-01", "2025-11-01")).toEqual([
      "2025-11",
      "2025-12",
    ]);
  });

  it("fratrådt før månedens udgang optjener ikke måneden", () => {
    expect(
      accruedMonthsInPeriod(sept, "2026-03-01", null, "2025-11-20"),
    ).toEqual(["2025-09", "2025-10"]);
  });

  it("stopper ved periodens slut", () => {
    expect(accruedMonthsInPeriod(sept, "2027-06-01")).toHaveLength(12);
    expect(accruedMonthsInPeriod(sept, "2027-06-01").at(-1)).toBe("2026-08");
  });

  it("previousMonthKey", () => {
    expect(previousMonthKey("2026-01-01")).toBe("2025-12");
    expect(previousMonthKey("2026-03-01")).toBe("2026-02");
  });
});

describe("accruedMonthsForIntervals — bounded catch-up ved modelskift (#532)", () => {
  const sept = { start: "2025-09-01", end: "2026-08-31" };
  const always = [{ start: null, end: null }];

  it("uden grænse indhentes hele det forgangne ferieår (den gamle adfærd)", () => {
    expect(accruedMonthsForIntervals(sept, "2026-09-01", always)).toHaveLength(
      12,
    );
  });

  it("skift 1/9-2026 → intet fra ferieåret 2025/26 indhentes", () => {
    expect(
      accruedMonthsForIntervals(sept, "2026-09-01", always, "2026-09-01"),
    ).toEqual([]);
    // Det nye ferieår: september tæller med når skiftet er d. 1.
    const next = { start: "2026-09-01", end: "2027-08-31" };
    expect(
      accruedMonthsForIntervals(next, "2026-10-01", always, "2026-09-01"),
    ).toEqual(["2026-09"]);
  });

  it("skift midt i en måned: skiftemåneden tæller ikke (resten ligger i opening)", () => {
    const next = { start: "2026-09-01", end: "2027-08-31" };
    expect(
      accruedMonthsForIntervals(next, "2026-11-01", always, "2026-09-15"),
    ).toEqual(["2026-10"]);
  });

  it("grænsen er max(periodestart, skift, ansættelsesstart)", () => {
    // Skift 1/3-2026 midt i ferieåret, ansat 1/5 → kun maj–aug
    expect(
      accruedMonthsForIntervals(
        sept,
        "2026-09-01",
        [{ start: "2026-05-01", end: null }],
        "2026-03-01",
      ),
    ).toEqual(["2026-05", "2026-06", "2026-07", "2026-08"]);
    // Skift før perioden → ingen effekt
    expect(
      accruedMonthsForIntervals(sept, "2026-01-01", always, "2024-01-01"),
    ).toEqual(accruedMonthsForIntervals(sept, "2026-01-01", always));
  });
});

describe("planRollover (#461)", () => {
  it("rest 7, loft 5 → 5 overført + 2 fortabt", () => {
    expect(planRollover(7, 5, false)).toEqual({
      carry: 5,
      forfeited: 2,
      paidOut: 0,
    });
  });

  it("udbetal-rest-flag → 2 udbetalt i stedet for fortabt", () => {
    expect(planRollover(7, 5, true)).toEqual({
      carry: 5,
      forfeited: 0,
      paidOut: 2,
    });
  });

  it("rest under loftet overføres helt", () => {
    expect(planRollover(3.5, 5, false)).toEqual({
      carry: 3.5,
      forfeited: 0,
      paidOut: 0,
    });
  });

  it("negativ rest (overtræk) følger med som negativ overførsel", () => {
    expect(planRollover(-1.5, 5, false)).toEqual({
      carry: -1.5,
      forfeited: 0,
      paidOut: 0,
    });
    expect(planRollover(0, 5, true)).toEqual({
      carry: 0,
      forfeited: 0,
      paidOut: 0,
    });
  });

  it("loft 0 (feriefridage) → alt fortabes", () => {
    expect(planRollover(4, 0, false)).toEqual({
      carry: 0,
      forfeited: 4,
      paidOut: 0,
    });
  });
});

describe("projectVacationBalance (#461)", () => {
  it("upfront: earned 25, used 3 → total 25, used 3, rest 22 (som før)", () => {
    const p = projectVacationBalance([
      { pool: "vacation", entryType: "earned", days: "25.00" },
      { pool: "vacation", entryType: "used", days: "3.00" },
      { pool: "extra", entryType: "earned", days: 5 },
    ]);
    expect(p.vacation).toMatchObject({
      earned: 25,
      used: 3,
      total: 25,
      remaining: 22,
    });
    expect(p.extra).toMatchObject({
      earned: 5,
      used: 0,
      total: 5,
      remaining: 5,
    });
    // Samme tal som den gamle direkte UPDATE (applyBalanceDelta)
    expect(applyBalanceDelta(0, 25, 3)).toEqual({ used: 3, remaining: 22 });
  });

  it("reversed trækker fra used; used klippes ved 0", () => {
    const p = projectVacationBalance([
      { pool: "vacation", entryType: "earned", days: 25 },
      { pool: "vacation", entryType: "used", days: 2 },
      { pool: "vacation", entryType: "reversed", days: 2 },
      { pool: "vacation", entryType: "reversed", days: 1 },
    ]);
    expect(p.vacation.used).toBe(0);
    expect(p.vacation.remaining).toBe(25);
  });

  it("månedsoptjening summeres som earned (optjent til dato)", () => {
    const entries = ["2025-09", "2025-10", "2025-11"].map(() => ({
      pool: "vacation",
      entryType: "earned",
      days: 2.08,
    }));
    const p = projectVacationBalance(entries);
    expect(p.vacation.earned).toBe(6.24);
    expect(p.vacation.total).toBe(6.24);
  });

  it("årsskifte: gammelt år går i 0, nyt år får overførslen", () => {
    const old = projectVacationBalance([
      { pool: "vacation", entryType: "earned", days: 25 },
      { pool: "vacation", entryType: "used", days: 18 },
      {
        pool: "vacation",
        entryType: "carried_over",
        days: -5,
        atPeriodStart: false,
      },
      { pool: "vacation", entryType: "forfeited", days: 2 },
    ]);
    expect(old.vacation).toMatchObject({
      carriedOut: 5,
      forfeited: 2,
      total: 18,
      used: 18,
      remaining: 0,
    });
    const next = projectVacationBalance([
      {
        pool: "vacation",
        entryType: "carried_over",
        days: 5,
        atPeriodStart: true,
      },
      { pool: "vacation", entryType: "earned", days: 2.08 },
    ]);
    expect(next.vacation).toMatchObject({
      carriedIn: 5,
      earned: 2.08,
      total: 7.08,
      remaining: 7.08,
    });
  });

  it("negativ overførsel (overtræk) følger med og vises som ud/ind — ikke efter fortegn", () => {
    const old = projectVacationBalance([
      { pool: "vacation", entryType: "earned", days: 25 },
      { pool: "vacation", entryType: "used", days: 26.5 },
      {
        pool: "vacation",
        entryType: "carried_over",
        days: 1.5,
        atPeriodStart: false,
      },
    ]);
    expect(old.vacation).toMatchObject({
      carriedIn: 0,
      carriedOut: -1.5,
      total: 26.5,
      remaining: 0,
    });
    const next = projectVacationBalance([
      {
        pool: "vacation",
        entryType: "carried_over",
        days: -1.5,
        atPeriodStart: true,
      },
    ]);
    expect(next.vacation).toMatchObject({
      carriedIn: -1.5,
      carriedOut: 0,
      total: -1.5,
      remaining: -1.5,
    });
  });

  it("opening (#532) tæller som optjent — rest fra gammel periode flyttes med", () => {
    const p = projectVacationBalance([
      { pool: "vacation", entryType: "opening", days: "17.50" },
      { pool: "extra", entryType: "opening", days: "3.00" },
      { pool: "vacation", entryType: "earned", days: "2.08" },
      { pool: "vacation", entryType: "used", days: "1" },
    ]);
    expect(p.vacation.earned).toBe(19.58);
    expect(p.vacation.total).toBe(19.58);
    expect(p.vacation.remaining).toBe(18.58);
    expect(p.extra.total).toBe(3);
  });

  it("manuel justering er signeret og indgår i total", () => {
    const p = projectVacationBalance([
      { pool: "vacation", entryType: "earned", days: 25 },
      { pool: "vacation", entryType: "adjustment", days: -1.5 },
      { pool: "extra", entryType: "adjustment", days: 1 },
    ]);
    expect(p.vacation.total).toBe(23.5);
    expect(p.vacation.adjustments).toBe(-1.5);
    expect(p.extra.total).toBe(1);
  });

  it("ukendt pulje behandles som ferie", () => {
    const p = projectVacationBalance([
      { pool: null, entryType: "earned", days: 2 },
    ]);
    expect(p.vacation.earned).toBe(2);
  });
});
