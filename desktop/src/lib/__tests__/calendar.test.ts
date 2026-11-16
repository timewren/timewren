import { describe, expect, it } from "vitest";
import {
  addMonths,
  formatShortDate,
  getDayName,
  getMonthName,
  getWeekNumber,
  getWeekStart,
  isSameDay,
  isToday,
} from "../calendar";
import i18n from "../i18n";

describe("getWeekStart", () => {
  it("returns Monday for a Wednesday", () => {
    // 2026-05-20 is a Wednesday
    const wed = new Date(2026, 4, 20, 10, 30, 0);
    const monday = getWeekStart(wed);
    expect(monday.getDay()).toBe(1); // Monday
    expect(monday.getDate()).toBe(18);
    expect(monday.getMonth()).toBe(4); // May
    expect(monday.getHours()).toBe(0);
    expect(monday.getMinutes()).toBe(0);
  });

  it("returns same day for a Monday", () => {
    // 2026-05-18 is a Monday
    const mon = new Date(2026, 4, 18, 15, 0, 0);
    const result = getWeekStart(mon);
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(18);
  });

  it("returns previous Monday for a Sunday", () => {
    // 2026-05-24 is a Sunday
    const sun = new Date(2026, 4, 24, 12, 0, 0);
    const monday = getWeekStart(sun);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(18);
  });

  it("handles month boundary (Sunday in next month)", () => {
    // 2026-06-01 is a Monday — but 2026-05-31 is a Sunday
    const sun = new Date(2026, 4, 31, 12, 0, 0); // May 31 = Sunday
    const monday = getWeekStart(sun);
    expect(monday.getDay()).toBe(1);
    expect(monday.getDate()).toBe(25);
    expect(monday.getMonth()).toBe(4); // Still May
  });

  it("handles year boundary", () => {
    // 2026-01-01 is a Thursday
    const jan1 = new Date(2026, 0, 1);
    const monday = getWeekStart(jan1);
    expect(monday.getDay()).toBe(1);
    expect(monday.getFullYear()).toBe(2025);
    expect(monday.getMonth()).toBe(11); // December
    expect(monday.getDate()).toBe(29);
  });

  it("does not mutate the input date", () => {
    const original = new Date(2026, 4, 20, 10, 30, 0);
    const originalTime = original.getTime();
    getWeekStart(original);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe("getWeekNumber", () => {
  it("returns week 1 for early January 2026", () => {
    // 2026-01-01 is a Thursday — ISO week 1
    const jan1 = new Date(2026, 0, 1);
    expect(getWeekNumber(jan1)).toBe(1);
  });

  it("returns week 53 for Dec 31 2026 (if applicable)", () => {
    // 2026-12-31 is a Thursday — ISO week 53
    const dec31 = new Date(2026, 11, 31);
    expect(getWeekNumber(dec31)).toBe(53);
  });

  it("returns correct week for mid-year", () => {
    // 2026-05-18 (Monday) should be week 21
    const may18 = new Date(2026, 4, 18);
    expect(getWeekNumber(may18)).toBe(21);
  });

  it("handles leap year correctly", () => {
    // 2024-02-29 is a Thursday — ISO week 9
    const feb29 = new Date(2024, 1, 29);
    expect(getWeekNumber(feb29)).toBe(9);
  });
});

describe("addMonths", () => {
  it("steps forward one month", () => {
    const result = addMonths(new Date(2026, 4, 15), 1); // May -> June
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5); // June
    expect(result.getDate()).toBe(1);
  });

  it("steps backward one month", () => {
    const result = addMonths(new Date(2026, 4, 15), -1); // May -> April
    expect(result.getMonth()).toBe(3); // April
  });

  it("does not skip a month when stepping from the 31st into a 30-day month", () => {
    // Aug 31 + 1 must land in September, not overflow into October
    const result = addMonths(new Date(2026, 7, 31), 1);
    expect(result.getMonth()).toBe(8); // September
    expect(result.getDate()).toBe(1);
  });

  it("does not skip a month when stepping from the 31st into February", () => {
    // Jan 31 + 1 must land in February, not overflow into March
    const result = addMonths(new Date(2026, 0, 31), 1);
    expect(result.getMonth()).toBe(1); // February
  });

  it("crosses year boundary forward", () => {
    const result = addMonths(new Date(2026, 11, 10), 1); // Dec -> Jan
    expect(result.getFullYear()).toBe(2027);
    expect(result.getMonth()).toBe(0); // January
  });

  it("crosses year boundary backward", () => {
    const result = addMonths(new Date(2026, 0, 10), -1); // Jan -> Dec
    expect(result.getFullYear()).toBe(2025);
    expect(result.getMonth()).toBe(11); // December
  });

  it("does not mutate the input date", () => {
    const original = new Date(2026, 4, 31, 10, 30, 0);
    const originalTime = original.getTime();
    addMonths(original, 1);
    expect(original.getTime()).toBe(originalTime);
  });
});

describe("isSameDay", () => {
  it("returns true for same day, different time", () => {
    const a = new Date(2026, 4, 20, 8, 0, 0);
    const b = new Date(2026, 4, 20, 22, 30, 0);
    expect(isSameDay(a, b)).toBe(true);
  });

  it("returns false for different days", () => {
    const a = new Date(2026, 4, 20);
    const b = new Date(2026, 4, 21);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("returns false for same day different month", () => {
    const a = new Date(2026, 4, 20);
    const b = new Date(2026, 5, 20);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("returns false for same day different year", () => {
    const a = new Date(2026, 4, 20);
    const b = new Date(2025, 4, 20);
    expect(isSameDay(a, b)).toBe(false);
  });

  it("handles midnight boundary", () => {
    const a = new Date(2026, 4, 20, 0, 0, 0);
    const b = new Date(2026, 4, 20, 23, 59, 59);
    expect(isSameDay(a, b)).toBe(true);
  });
});

describe("isToday", () => {
  it("returns true for today", () => {
    expect(isToday(new Date())).toBe(true);
  });

  it("returns false for yesterday", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    expect(isToday(yesterday)).toBe(false);
  });

  it("returns false for tomorrow", () => {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    expect(isToday(tomorrow)).toBe(false);
  });
});

describe("getDayName", () => {
  it("returns Man for Monday", () => {
    // 2026-05-18 is Monday
    expect(getDayName(new Date(2026, 4, 18))).toBe("Man");
  });

  it("returns Tir for Tuesday", () => {
    expect(getDayName(new Date(2026, 4, 19))).toBe("Tir");
  });

  it("returns Ons for Wednesday", () => {
    expect(getDayName(new Date(2026, 4, 20))).toBe("Ons");
  });

  it("returns Tor for Thursday", () => {
    expect(getDayName(new Date(2026, 4, 21))).toBe("Tor");
  });

  it("returns Fre for Friday", () => {
    expect(getDayName(new Date(2026, 4, 22))).toBe("Fre");
  });

  it("returns Lør for Saturday", () => {
    expect(getDayName(new Date(2026, 4, 23))).toBe("Lør");
  });

  it("returns Søn for Sunday", () => {
    expect(getDayName(new Date(2026, 4, 24))).toBe("Søn");
  });
});

describe("getMonthName", () => {
  it("returns Januar for January", () => {
    expect(getMonthName(new Date(2026, 0, 1))).toBe("Januar");
  });

  it("returns Maj for May", () => {
    expect(getMonthName(new Date(2026, 4, 1))).toBe("Maj");
  });

  it("returns December for December", () => {
    expect(getMonthName(new Date(2026, 11, 1))).toBe("December");
  });

  it("returns correct name for all 12 months", () => {
    const expected = [
      "Januar",
      "Februar",
      "Marts",
      "April",
      "Maj",
      "Juni",
      "Juli",
      "August",
      "September",
      "Oktober",
      "November",
      "December",
    ];
    for (let i = 0; i < 12; i++) {
      expect(getMonthName(new Date(2026, i, 15))).toBe(expected[i]);
    }
  });
});

describe("formatShortDate", () => {
  it("skriver dag med punktum på dansk og uden på spansk", async () => {
    const d = new Date(2026, 4, 23);
    try {
      await i18n.changeLanguage("da");
      expect(formatShortDate(d)).toMatch(/^23\. /);
      await i18n.changeLanguage("es");
      expect(formatShortDate(d)).toMatch(/^23 [a-z]/);
    } finally {
      await i18n.changeLanguage("da");
    }
  });
});
