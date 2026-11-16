import { describe, expect, it } from "vitest";
import {
  averageMonthlyHours,
  officialHolidays,
  workdaysByMonth,
  yearSummary,
} from "./workdays";

describe("officialHolidays", () => {
  it("giver de officielle helligdage for 2026 (påske 5. april)", () => {
    expect(officialHolidays(2026).map((h) => h.date)).toEqual([
      "2026-01-01",
      "2026-04-02",
      "2026-04-03",
      "2026-04-05",
      "2026-04-06",
      "2026-05-14",
      "2026-05-24",
      "2026-05-25",
      "2026-12-25",
      "2026-12-26",
    ]);
  });

  it("tager ikke grundlovsdag, juleaften eller store bededag med", () => {
    const names = officialHolidays(2026).map((h) => h.name);
    expect(names).not.toContain("Grundlovsdag");
    expect(names).not.toContain("Juleaftensdag");
    expect(names.some((n) => n.includes("bededag"))).toBe(false);
  });
});

describe("workdaysByMonth", () => {
  it("tæller 254 arbejdsdage i 2026 og 255 i 2027", () => {
    const sum = (y: number) =>
      workdaysByMonth(y).reduce((s, m) => s + m.workdays, 0);
    expect(sum(2026)).toBe(254);
    expect(sum(2027)).toBe(255);
  });

  it("trækker helligdage på hverdage fra i den rigtige måned", () => {
    const april = workdaysByMonth(2026)[3];
    // 22 hverdage i april 2026 minus skærtorsdag, langfredag og 2. påskedag
    expect(april.weekdays).toBe(22);
    expect(april.workdays).toBe(19);
  });

  it("regner timer ud fra en 37-timers uge som standard", () => {
    const jan = workdaysByMonth(2026)[0];
    // januar 2026: 22 hverdage minus nytårsdag = 21 dage × 7,4 t
    expect(jan.workdays).toBe(21);
    expect(jan.hours).toBeCloseTo(155.4, 5);
  });

  it("markerer de almindelige fridage, der falder på hverdage", () => {
    const months = workdaysByMonth(2026);
    // 5. juni 2026 er en fredag; 24. og 31. december er torsdage
    expect(months[5].commonDaysOff).toBe(1);
    expect(months[11].commonDaysOff).toBe(2);
  });
});

describe("averageMonthlyHours og yearSummary", () => {
  it("giver 160,33 timer i en gennemsnitsmåned ved 37 timer", () => {
    expect(averageMonthlyHours(37)).toBeCloseTo(160.333, 2);
    expect(averageMonthlyHours(32)).toBeCloseTo(138.667, 2);
  });

  it("opsummerer året med og uden 5 ugers ferie", () => {
    const y = yearSummary(2026, 37);
    expect(y.workdays).toBe(254);
    expect(y.hours).toBeCloseTo(1879.6, 5);
    expect(y.hoursAfterVacation).toBeCloseTo(1879.6 - 25 * 7.4, 5);
  });
});
