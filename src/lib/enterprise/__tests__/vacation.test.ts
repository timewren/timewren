import { describe, expect, it } from "vitest";
import {
  applyConversionFactor,
  calculateConversionFactor,
  calculateVacationDays,
} from "../vacation";

describe("calculateVacationDays", () => {
  const noHolidays = new Set<string>();

  it("counts 5 days for a full Mon-Fri week", () => {
    const result = calculateVacationDays(
      "2026-03-23", // Monday
      "2026-03-27", // Friday
      false,
      false,
      noHolidays,
    );
    expect(result).toBe(5);
  });

  it("excludes weekends", () => {
    const result = calculateVacationDays(
      "2026-03-21", // Saturday
      "2026-03-22", // Sunday
      false,
      false,
      noHolidays,
    );
    expect(result).toBe(0);
  });

  it("excludes holidays", () => {
    const holidays = new Set([
      "2026-04-02", // Skaertorsdag
      "2026-04-03", // Langfredag
      "2026-04-06", // 2. paaskedag
    ]);
    const result = calculateVacationDays(
      "2026-04-01", // Wednesday
      "2026-04-06", // Monday
      false,
      false,
      holidays,
    );
    // Wed Apr 1 = working, Thu-Fri = holidays, Sat-Sun = weekend, Mon = holiday
    expect(result).toBe(1);
  });

  it("handles half day at start (single day)", () => {
    const result = calculateVacationDays(
      "2026-03-23",
      "2026-03-23",
      true,
      false,
      noHolidays,
    );
    expect(result).toBe(0.5);
  });

  it("handles half day at end (single day)", () => {
    const result = calculateVacationDays(
      "2026-03-23",
      "2026-03-23",
      false,
      true,
      noHolidays,
    );
    expect(result).toBe(0.5);
  });

  it("handles half day at end of multi-day range", () => {
    const result = calculateVacationDays(
      "2026-03-23", // Monday
      "2026-03-24", // Tuesday
      false,
      true,
      noHolidays,
    );
    expect(result).toBe(1.5);
  });

  it("handles half day at start of multi-day range", () => {
    const result = calculateVacationDays(
      "2026-03-23", // Monday
      "2026-03-24", // Tuesday
      true,
      false,
      noHolidays,
    );
    expect(result).toBe(1.5);
  });

  it("handles both half days on same single day", () => {
    const result = calculateVacationDays(
      "2026-03-23",
      "2026-03-23",
      true,
      true,
      noHolidays,
    );
    expect(result).toBe(0.5);
  });

  it("counts a full two-week period correctly", () => {
    const result = calculateVacationDays(
      "2026-03-16", // Monday
      "2026-03-27", // Friday
      false,
      false,
      noHolidays,
    );
    expect(result).toBe(10);
  });
});

describe("calculateConversionFactor", () => {
  it("returns 1.0 for full-time (37 hours)", () => {
    expect(calculateConversionFactor(37)).toBeCloseTo(1.0);
  });

  it("returns 1.233 for 30 hours/week", () => {
    expect(calculateConversionFactor(30)).toBeCloseTo(1.233, 2);
  });

  it("returns 1.644 for flexjob 22.5 hours", () => {
    expect(calculateConversionFactor(22.5)).toBeCloseTo(1.644, 2);
  });

  it("returns 1 for invalid input (0 or negative)", () => {
    expect(calculateConversionFactor(0)).toBe(1);
    expect(calculateConversionFactor(-5)).toBe(1);
  });
});

describe("applyConversionFactor", () => {
  it("deducts 5 days for full-time 5-day vacation", () => {
    expect(applyConversionFactor(5, 1.0)).toBe(5);
  });

  it("deducts 6.58 days for flexjob 4-day vacation (Maria example)", () => {
    expect(applyConversionFactor(4, 1.644)).toBeCloseTo(6.58, 1);
  });

  it("deducts 6.17 for part-time 30h 5-day vacation", () => {
    expect(applyConversionFactor(5, 37 / 30)).toBeCloseTo(6.17, 1);
  });
});
