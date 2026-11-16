import { describe, expect, it } from "vitest";
import { parseStoredCalendarDate } from "./calendar-start";

describe("parseStoredCalendarDate", () => {
  it("læser en gemt dag som lokal dato", () => {
    const date = parseStoredCalendarDate("2026-10-12");
    expect(date?.getFullYear()).toBe(2026);
    expect(date?.getMonth()).toBe(9);
    expect(date?.getDate()).toBe(12);
  });

  it("ukendte værdier giver null", () => {
    expect(parseStoredCalendarDate(undefined)).toBeNull();
    expect(parseStoredCalendarDate("12. okt.")).toBeNull();
    expect(parseStoredCalendarDate(20261012)).toBeNull();
  });
});
