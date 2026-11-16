import { describe, expect, it } from "vitest";
import {
  budgetAlertCrossing,
  budgetAlertLevel,
  budgetHealthStatus,
  monthBoundsCopenhagen,
  monthBoundsCopenhagenOffset,
  monthKeyCopenhagen,
  monthlyBudgetStatus,
} from "./budget";

describe("monthlyBudgetStatus", () => {
  it("regner procent, rest og farve ud fra 80/100-tærsklerne", () => {
    expect(monthlyBudgetStatus(50, 17)).toEqual({
      percentage: 34,
      remaining: 33,
      healthStatus: "green",
    });
    expect(monthlyBudgetStatus(10, 8)).toEqual({
      percentage: 80,
      remaining: 2,
      healthStatus: "yellow",
    });
    expect(monthlyBudgetStatus(10, 10)).toEqual({
      percentage: 100,
      remaining: 0,
      healthStatus: "red",
    });
    expect(monthlyBudgetStatus(10, 12.5)).toEqual({
      percentage: 125,
      remaining: -2.5,
      healthStatus: "red",
    });
  });

  it("er grøn lige under 80 og gul lige under 100", () => {
    expect(monthlyBudgetStatus(100, 79.9).healthStatus).toBe("green");
    expect(monthlyBudgetStatus(100, 80).healthStatus).toBe("yellow");
    expect(monthlyBudgetStatus(100, 99.9).healthStatus).toBe("yellow");
  });

  it("farven følger den uafrundede procent, ikke den viste", () => {
    // 99,6 % vises som 100 %, men budgettet er ikke brugt op endnu
    const s = monthlyBudgetStatus(100, 99.6);
    expect(s.percentage).toBe(100);
    expect(s.healthStatus).toBe("yellow");
  });

  it("intet budget giver 0 % og grøn", () => {
    expect(monthlyBudgetStatus(0, 12)).toEqual({
      percentage: 0,
      remaining: -12,
      healthStatus: "green",
    });
  });
});

describe("budgetHealthStatus", () => {
  it("mapper procent til farve", () => {
    expect(budgetHealthStatus(0)).toBe("green");
    expect(budgetHealthStatus(79.99)).toBe("green");
    expect(budgetHealthStatus(80)).toBe("yellow");
    expect(budgetHealthStatus(100)).toBe("red");
  });
});

describe("monthBoundsCopenhagen", () => {
  it("vintermåned starter kl. 23:00 UTC dagen før den 1.", () => {
    // Januar 2026: CET = UTC+1
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-01-15T12:00:00Z"),
    );
    expect(start.toISOString()).toBe("2025-12-31T23:00:00.000Z");
    expect(next.toISOString()).toBe("2026-01-31T23:00:00.000Z");
  });

  it("sommermåned starter kl. 22:00 UTC dagen før den 1.", () => {
    // Juli 2026: CEST = UTC+2
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-07-15T12:00:00Z"),
    );
    expect(start.toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(next.toISOString()).toBe("2026-07-31T22:00:00.000Z");
  });

  it("marts spænder over forårets DST-skift", () => {
    // 1. marts er CET (+1), 1. april er CEST (+2)
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-03-10T12:00:00Z"),
    );
    expect(start.toISOString()).toBe("2026-02-28T23:00:00.000Z");
    expect(next.toISOString()).toBe("2026-03-31T22:00:00.000Z");
  });

  it("oktober spænder over efterårets DST-skift", () => {
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-10-10T12:00:00Z"),
    );
    expect(start.toISOString()).toBe("2026-09-30T22:00:00.000Z");
    expect(next.toISOString()).toBe("2026-10-31T23:00:00.000Z");
  });

  it("23:30 dansk tid den 31. hører til måneden — 00:30 den 1. gør ikke", () => {
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-01-15T12:00:00Z"),
    );
    // 31. januar kl. 23:30 dansk = 22:30Z → stadig januar
    const lateJan = new Date("2026-01-31T22:30:00Z");
    expect(lateJan >= start && lateJan < next).toBe(true);
    // 1. februar kl. 00:30 dansk = 23:30Z den 31. → februar, ikke januar
    const earlyFeb = new Date("2026-01-31T23:30:00Z");
    expect(earlyFeb < next).toBe(false);
  });

  it("årsskifte ruller korrekt over", () => {
    const { start, next } = monthBoundsCopenhagen(
      new Date("2026-12-20T12:00:00Z"),
    );
    expect(start.toISOString()).toBe("2026-11-30T23:00:00.000Z");
    expect(next.toISOString()).toBe("2026-12-31T23:00:00.000Z");
  });

  it("et tidspunkt lige efter midnat dansk tid hører til den nye måned", () => {
    // 1. februar kl. 00:30 dansk = 31. januar 23:30Z
    const { start } = monthBoundsCopenhagen(new Date("2026-01-31T23:30:00Z"));
    expect(start.toISOString()).toBe("2026-01-31T23:00:00.000Z");
  });
});

describe("monthKeyCopenhagen", () => {
  it("bruger den danske kalender, ikke UTC", () => {
    expect(monthKeyCopenhagen(new Date("2026-01-31T23:30:00Z"))).toBe(
      "2026-02",
    );
    expect(monthKeyCopenhagen(new Date("2026-01-31T22:30:00Z"))).toBe(
      "2026-01",
    );
  });
});

describe("monthBoundsCopenhagenOffset", () => {
  it("går baglæns over årsskiftet", () => {
    const { start } = monthBoundsCopenhagenOffset(
      new Date("2026-02-10T12:00:00Z"),
      -3,
    );
    expect(start.toISOString()).toBe("2025-10-31T23:00:00.000Z");
  });

  it("offset 0 er samme måned", () => {
    const a = monthBoundsCopenhagen(new Date("2026-07-15T12:00:00Z"));
    const b = monthBoundsCopenhagenOffset(new Date("2026-07-15T12:00:00Z"), 0);
    expect(b.start.toISOString()).toBe(a.start.toISOString());
    expect(b.next.toISOString()).toBe(a.next.toISOString());
  });
});

describe("budgetAlertLevel / budgetAlertCrossing", () => {
  it("finder det højeste nåede niveau", () => {
    expect(budgetAlertLevel(12)).toBe(0);
    expect(budgetAlertLevel(79.9)).toBe(0);
    expect(budgetAlertLevel(80)).toBe(80);
    expect(budgetAlertLevel(99)).toBe(80);
    expect(budgetAlertLevel(100)).toBe(100);
    expect(budgetAlertLevel(180)).toBe(100);
  });

  it("advarer én gang pr. niveau", () => {
    expect(budgetAlertCrossing(85, 0)).toBe(80);
    expect(budgetAlertCrossing(85, 80)).toBeNull();
    expect(budgetAlertCrossing(101, 80)).toBe(100);
    expect(budgetAlertCrossing(101, 100)).toBeNull();
  });

  it("springer 80 over når forbruget ryger direkte forbi 100", () => {
    expect(budgetAlertCrossing(140, 0)).toBe(100);
  });

  it("advarer ikke igen når forbruget falder", () => {
    expect(budgetAlertCrossing(70, 100)).toBeNull();
    expect(budgetAlertCrossing(85, 100)).toBeNull();
    expect(budgetAlertCrossing(10, 0)).toBeNull();
  });
});
