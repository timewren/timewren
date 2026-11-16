import { describe, expect, it } from "vitest";
import {
  formatShortDate,
  getPeriodPreset,
  isValidDateString,
  periodLengthDays,
  validatePeriod,
} from "../period";

const now = new Date(2026, 7, 27); // 27. august 2026

describe("getPeriodPreset", () => {
  it("this_month", () => {
    expect(getPeriodPreset("this_month", now)).toEqual({
      from: "2026-08-01",
      to: "2026-08-31",
    });
  });

  it("last_month crosses year boundary", () => {
    expect(getPeriodPreset("last_month", new Date(2026, 0, 15))).toEqual({
      from: "2025-12-01",
      to: "2025-12-31",
    });
  });

  it("this_quarter", () => {
    expect(getPeriodPreset("this_quarter", now)).toEqual({
      from: "2026-07-01",
      to: "2026-09-30",
    });
  });

  it("this_year / last_year", () => {
    expect(getPeriodPreset("this_year", now)).toEqual({
      from: "2026-01-01",
      to: "2026-12-31",
    });
    expect(getPeriodPreset("last_year", now)).toEqual({
      from: "2025-01-01",
      to: "2025-12-31",
    });
  });
});

describe("validatePeriod", () => {
  it("accepts a normal month", () => {
    expect(validatePeriod("2026-08-01", "2026-08-31")).toBeNull();
    expect(periodLengthDays("2026-08-01", "2026-08-31")).toBe(31);
  });

  it("accepts a full year including leap-year length", () => {
    expect(validatePeriod("2024-01-01", "2024-12-31")).toBeNull();
    expect(periodLengthDays("2024-01-01", "2024-12-31")).toBe(366);
  });

  it("rejects from > to", () => {
    expect(validatePeriod("2026-09-01", "2026-08-01")).toMatch(/Fra-dato/);
  });

  it("rejects more than 366 days", () => {
    expect(validatePeriod("2025-01-01", "2026-01-02")).toMatch(/366 dage/);
  });

  it("rejects malformed input", () => {
    expect(validatePeriod("", "2026-08-01")).not.toBeNull();
    expect(validatePeriod("2026-8-1", "2026-08-01")).not.toBeNull();
  });

  it("rejects non-existent calendar dates", () => {
    expect(validatePeriod("2026-02-31", "2026-03-31")).toMatch(/dato/);
    expect(validatePeriod("2026-01-01", "2026-13-01")).toMatch(/dato/);
    expect(validatePeriod("2026-04-00", "2026-04-30")).toMatch(/dato/);
    // 29. februar findes i skudår, ikke i 2026
    expect(validatePeriod("2024-02-29", "2024-03-01")).toBeNull();
    expect(validatePeriod("2026-02-29", "2026-03-01")).toMatch(/dato/);
  });
});

describe("isValidDateString", () => {
  it("requires exact round-trip", () => {
    expect(isValidDateString("2026-08-27")).toBe(true);
    expect(isValidDateString("2026-02-31")).toBe(false);
    expect(isValidDateString("2026-00-10")).toBe(false);
    expect(isValidDateString("26-08-27")).toBe(false);
  });
});

describe("formatShortDate", () => {
  it("formats dd.mm", () => {
    expect(formatShortDate("2026-08-03")).toBe("03.08");
  });
});
