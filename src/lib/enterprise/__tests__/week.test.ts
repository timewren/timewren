import { describe, expect, it } from "vitest";
import {
  isoWeekNumber,
  parseISOWeekString,
  startOfISOWeek,
  toDateStr,
  toISOWeekString,
} from "../week";

describe("startOfISOWeek", () => {
  it("returns monday for a wednesday", () => {
    expect(toDateStr(startOfISOWeek(new Date(2026, 7, 26)))).toBe("2026-08-24");
  });

  it("returns previous monday for a sunday", () => {
    expect(toDateStr(startOfISOWeek(new Date(2026, 7, 30)))).toBe("2026-08-24");
  });

  it("returns same day for a monday", () => {
    expect(toDateStr(startOfISOWeek(new Date(2026, 7, 24)))).toBe("2026-08-24");
  });
});

describe("ISO week strings", () => {
  it("formats week number with ISO week-year", () => {
    expect(toISOWeekString(new Date(2026, 7, 27))).toBe("2026-W35");
    // 1. januar 2027 ligger i uge 53 af 2026
    expect(toISOWeekString(new Date(2027, 0, 1))).toBe("2026-W53");
  });

  it("round-trips through parseISOWeekString", () => {
    const monday = parseISOWeekString("2026-W35");
    expect(monday && toDateStr(monday)).toBe("2026-08-24");
    expect(isoWeekNumber(monday as Date)).toBe(35);
  });

  it("rejects invalid input", () => {
    expect(parseISOWeekString(null)).toBeNull();
    expect(parseISOWeekString("2026-08-24")).toBeNull();
    expect(parseISOWeekString("2026-W00")).toBeNull();
    // 2025 har ingen uge 53
    expect(parseISOWeekString("2025-W53")).toBeNull();
  });
});
