import { describe, expect, it } from "vitest";
import {
  DEFAULT_ABSENCE_TYPES,
  planDefaultAbsenceTypes,
} from "../absence-defaults";
import {
  applyBalanceDelta,
  applyConversionFactor,
  calculateConversionFactor,
  countWorkingDays,
  evaluateVacationGuard,
  proRataVacationDays,
  remainingInPool,
  toVacationPool,
  vacationGuardMessage,
  vacationYearOf,
} from "../vacation";

describe("vacationYearOf", () => {
  it("bruger kalenderåret som ferieår", () => {
    expect(vacationYearOf("2026-01-01")).toBe(2026);
    expect(vacationYearOf("2026-09-01")).toBe(2026);
    expect(vacationYearOf("2026-12-31")).toBe(2026);
  });
});

describe("proRataVacationDays (#435)", () => {
  it("fuld pulje uden startdato eller start før året", () => {
    expect(proRataVacationDays(25, null, 2026)).toBe(25);
    expect(proRataVacationDays(25, undefined, 2026)).toBe(25);
    expect(proRataVacationDays(25, "2020-06-15", 2026)).toBe(25);
  });

  it("start 1/1 → fuld pulje (12/12)", () => {
    expect(proRataVacationDays(25, "2026-01-01", 2026)).toBe(25);
    expect(proRataVacationDays(5, "2026-01-01", 2026)).toBe(5);
  });

  it("start 15/8 → 4/12 (sep–dec), afrundet til halve dage", () => {
    // 25 × 4/12 = 8,33 → 8,5
    expect(proRataVacationDays(25, "2026-08-15", 2026)).toBe(8.5);
    // 5 × 4/12 = 1,67 → 1,5
    expect(proRataVacationDays(5, "2026-08-15", 2026)).toBe(1.5);
  });

  it("start 1/8 → 5/12 (august tæller med)", () => {
    // 25 × 5/12 = 10,42 → 10,5
    expect(proRataVacationDays(25, "2026-08-01", 2026)).toBe(10.5);
  });

  it("start 2/12 → 0 hele måneder tilbage", () => {
    expect(proRataVacationDays(25, "2026-12-02", 2026)).toBe(0);
  });

  it("start efter året → 0", () => {
    expect(proRataVacationDays(25, "2027-01-01", 2026)).toBe(0);
  });
});

describe("konverteringsfaktor for deltid/flexjob", () => {
  it("37/22,5 ≈ 1,644 — én arbejdsdag koster 1,64 feriedage", () => {
    const factor = calculateConversionFactor(22.5);
    expect(factor).toBeCloseTo(1.6444, 3);
    expect(applyConversionFactor(1, factor)).toBe(1.64);
    expect(applyConversionFactor(5, factor)).toBe(8.22);
  });

  it("fuldtid = faktor 1", () => {
    expect(calculateConversionFactor(37)).toBe(1);
    expect(applyConversionFactor(5, 1)).toBe(5);
  });
});

describe("pulje-routing", () => {
  it("toVacationPool: kun 'extra' er feriefridage, alt andet er ferie", () => {
    expect(toVacationPool("extra")).toBe("extra");
    expect(toVacationPool("vacation")).toBe("vacation");
    expect(toVacationPool(null)).toBe("vacation");
    expect(toVacationPool(undefined)).toBe("vacation");
    expect(toVacationPool("noget-andet")).toBe("vacation");
  });

  it("remainingInPool læser den rigtige pulje", () => {
    const balance = {
      id: "b",
      year: 2026,
      periodStart: "2026-01-01",
      periodEnd: "2026-12-31",
      periodLabel: "2026",
      rolledOverAt: null,
      totalDays: 25,
      usedDays: 3,
      remainingDays: 22,
      extraTotalDays: 5,
      extraUsedDays: 1,
      extraRemainingDays: 4,
    };
    expect(remainingInPool(balance, "vacation")).toBe(22);
    expect(remainingInPool(balance, "extra")).toBe(4);
  });

  it("standardtyper: Ferie og Feriefridage trækker fra hver sin pulje", () => {
    const byName = new Map(DEFAULT_ABSENCE_TYPES.map((t) => [t.name, t]));
    expect(byName.get("Ferie")).toMatchObject({
      deductsVacation: true,
      vacationPool: "vacation",
      requiresApproval: true,
      isDefault: true,
    });
    expect(byName.get("Feriefridage")).toMatchObject({
      deductsVacation: true,
      vacationPool: "extra",
      requiresApproval: true,
    });
    expect(byName.get("Sygdom")).toMatchObject({
      deductsVacation: false,
      requiresApproval: false,
    });
    expect(byName.get("Afspadsering")).toMatchObject({
      deductsOvertime: true,
      requiresApproval: false,
    });
    // Kun én isDefault (bruges som "første række" i ugegrid'et)
    expect(DEFAULT_ABSENCE_TYPES.filter((t) => t.isDefault)).toHaveLength(1);
    // Navne er unikke case-insensitivt (idempotens-nøgle)
    const lower = DEFAULT_ABSENCE_TYPES.map((t) => t.name.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });
});

describe("applyBalanceDelta (semantik for den atomiske UPDATE)", () => {
  it("trækker fra og lader remaining blive negativ (overtræk)", () => {
    expect(applyBalanceDelta(20, 25, 5)).toEqual({ used: 25, remaining: 0 });
    expect(applyBalanceDelta(24, 25, 2.5)).toEqual({
      used: 26.5,
      remaining: -1.5,
    });
  });

  it("tilbageførsel klipper used ved 0 — remaining kan ikke overstige total", () => {
    expect(applyBalanceDelta(1, 25, -3)).toEqual({ used: 0, remaining: 25 });
  });

  it("afrunder til 2 decimaler", () => {
    expect(applyBalanceDelta(0, 25, 1.644)).toEqual({
      used: 1.64,
      remaining: 23.36,
    });
  });
});

describe("planDefaultAbsenceTypes", () => {
  it("tom org: alle 8 typer, Ferie er default", () => {
    const plan = planDefaultAbsenceTypes([]);
    expect(plan).toHaveLength(DEFAULT_ABSENCE_TYPES.length);
    expect(plan.find((t) => t.name === "Ferie")?.isDefault).toBe(true);
  });

  it("matcher på navn case-insensitivt, også arkiverede", () => {
    const plan = planDefaultAbsenceTypes([
      { name: "ferie", isDefault: false },
      { name: " SYGDOM ", isDefault: false },
    ]);
    expect(plan.map((t) => t.name)).not.toContain("Ferie");
    expect(plan.map((t) => t.name)).not.toContain("Sygdom");
    expect(plan).toHaveLength(DEFAULT_ABSENCE_TYPES.length - 2);
  });

  it("sætter IKKE isDefault når org'en allerede har en default-type", () => {
    const plan = planDefaultAbsenceTypes([
      { name: "Lærerudviklingstid", isDefault: true },
    ]);
    expect(plan.find((t) => t.name === "Ferie")?.isDefault).toBe(false);
    expect(plan.every((t) => !t.isDefault)).toBe(true);
  });
});

describe("evaluateVacationGuard (#437)", () => {
  it("tillader når saldoen rækker", () => {
    expect(evaluateVacationGuard(5, 5, 0)).toEqual({
      allowed: true,
      warning: false,
      resulting: 0,
    });
  });

  it("afviser overtræk uden tolerance", () => {
    expect(evaluateVacationGuard(2, 3, 0).allowed).toBe(false);
  });

  it("tillader med advarsel inden for tolerancen", () => {
    expect(evaluateVacationGuard(2, 3.5, 2)).toEqual({
      allowed: true,
      warning: true,
      resulting: -1.5,
    });
  });

  it("afviser ud over tolerancen", () => {
    expect(evaluateVacationGuard(2, 5, 2).allowed).toBe(false);
  });

  it("besked nævner pulje, saldo og tolerance på dansk", () => {
    const msg = vacationGuardMessage("extra", 1, 2.5, 1);
    expect(msg).toContain("Feriefridage");
    expect(msg).toContain("1,0 dage tilbage");
    expect(msg).toContain("2,5 dage");
    expect(msg).toContain("tilladt overtræk: 1,0 dage");
    expect(vacationGuardMessage("vacation", 0, 1, 0)).toContain(
      "overtræk er ikke tilladt",
    );
  });
});

describe("countWorkingDays (delt helper)", () => {
  it("tæller man–fre ekskl. helligdage", () => {
    // Uge 42 2026: 12/10 (man) – 18/10 (søn)
    expect(
      countWorkingDays(
        "2026-10-12",
        "2026-10-18",
        ["1", "2", "3", "4", "5"],
        [],
        "full",
        "full",
      ),
    ).toBe(5);
    expect(
      countWorkingDays(
        "2026-10-12",
        "2026-10-18",
        ["1", "2", "3", "4", "5"],
        ["2026-10-14"],
        "full",
        "full",
      ),
    ).toBe(4);
  });

  it("respekterer profilens arbejdsdage og halve dage", () => {
    expect(
      countWorkingDays(
        "2026-10-12",
        "2026-10-16",
        ["1", "3", "5"],
        [],
        "morning",
        "full",
      ),
    ).toBe(2.5);
  });
});

describe("countWorkingDays med halve fridage (#763)", () => {
  const week = ["1", "2", "3", "4", "5"];
  it("trækker kun den resterende halve arbejdsdag fra ferien", () => {
    expect(
      countWorkingDays("2026-12-23", "2026-12-24", week, [], "full", "full", [
        "2026-12-24",
      ]),
    ).toBe(1.5);
  });
  it("halv ferie på en halv fridag tæller en halv dag, ikke en kvart", () => {
    expect(
      countWorkingDays(
        "2026-12-24",
        "2026-12-24",
        week,
        [],
        "morning",
        "full",
        ["2026-12-24"],
      ),
    ).toBe(0.5);
  });
  it("giver ingen ferie på hele fridage eller arbejdsfri ugedage", () => {
    expect(
      countWorkingDays(
        "2026-12-24",
        "2026-12-27",
        week,
        ["2026-12-25"],
        "full",
        "full",
        ["2026-12-24", "2026-12-26"],
      ),
    ).toBe(0.5);
  });
});
