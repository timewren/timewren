import { describe, expect, it } from "vitest";
import {
  calculate48hWeeklyAverage,
  findDailyRestViolations,
  findWeeklyRestViolations,
  getComplianceStatus,
} from "../compliance";

// ─── Helpers ─────────────────────────────────────────────────────────

/** Create a Date at a given hour on a given day offset from a base Monday. */
function makeDate(
  baseMonday: Date,
  dayOffset: number,
  hour: number,
  minute = 0,
): Date {
  const d = new Date(baseMonday.getTime());
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, minute, 0, 0);
  return d;
}

/** Generate a week of Mon-Fri entries with given daily hours. */
function makeWeekEntries(baseMonday: Date, dailyHours: number, startHour = 8) {
  return Array.from({ length: 5 }, (_, i) => {
    const start = makeDate(baseMonday, i, startHour);
    const end = new Date(start.getTime() + dailyHours * 60 * 60 * 1000);
    return { startTime: start, endTime: end };
  });
}

// Monday 2026-01-05 (a known Monday)
const WEEK1_MONDAY = new Date(2026, 0, 5, 0, 0, 0, 0);
const WEEK2_MONDAY = new Date(2026, 0, 12, 0, 0, 0, 0);
const WEEK3_MONDAY = new Date(2026, 0, 19, 0, 0, 0, 0);
const WEEK4_MONDAY = new Date(2026, 0, 26, 0, 0, 0, 0);

// ─── calculate48hWeeklyAverage ──────────────────────────────────────

describe("calculate48hWeeklyAverage", () => {
  it("returns ok for normal 37h weeks", () => {
    // 4 weeks × 5 days × 7.4h = 37h/week
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 7.4),
      ...makeWeekEntries(WEEK2_MONDAY, 7.4),
      ...makeWeekEntries(WEEK3_MONDAY, 7.4),
      ...makeWeekEntries(WEEK4_MONDAY, 7.4),
    ];

    const result = calculate48hWeeklyAverage(entries);

    expect(result.status).toBe("ok");
    expect(result.averageHoursPerWeek).toBe(37);
    expect(result.weeksInPeriod).toBe(4);
  });

  it("returns warning for 45-47h average", () => {
    // 5 days × 9.2h = 46h/week
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 9.2),
      ...makeWeekEntries(WEEK2_MONDAY, 9.2),
    ];

    const result = calculate48hWeeklyAverage(entries);

    expect(result.status).toBe("warning");
    expect(result.averageHoursPerWeek).toBe(46);
  });

  it("returns violation at 48h+", () => {
    // 5 days × 10h = 50h/week
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 10),
      ...makeWeekEntries(WEEK2_MONDAY, 10),
    ];

    const result = calculate48hWeeklyAverage(entries);

    expect(result.status).toBe("violation");
    expect(result.averageHoursPerWeek).toBe(50);
  });

  it("handles empty entries", () => {
    const result = calculate48hWeeklyAverage([]);

    expect(result.status).toBe("ok");
    expect(result.averageHoursPerWeek).toBe(0);
    expect(result.weeksInPeriod).toBe(0);
    expect(result.totalHours).toBe(0);
  });

  it("handles entries with only hours (no startTime/endTime)", () => {
    // Entries without any date are skipped
    const result = calculate48hWeeklyAverage([{ hours: 8 }, { hours: 8 }]);

    expect(result.averageHoursPerWeek).toBe(0);
    expect(result.weeksInPeriod).toBe(0);
  });
});

// ─── findDailyRestViolations ────────────────────────────────────────

describe("findDailyRestViolations", () => {
  it("finds violation when rest is only 8 hours", () => {
    const entries = [
      {
        startTime: makeDate(WEEK1_MONDAY, 0, 8),
        endTime: makeDate(WEEK1_MONDAY, 0, 18), // Mon 08-18
      },
      {
        startTime: makeDate(WEEK1_MONDAY, 1, 2), // Tue 02:00 — only 8h rest
        endTime: makeDate(WEEK1_MONDAY, 1, 10),
      },
    ];

    const violations = findDailyRestViolations(entries);

    expect(violations).toHaveLength(1);
    expect(violations[0].restHours).toBe(8);
    expect(violations[0].date).toBe("2026-01-06");
  });

  it("no violation when rest is 15 hours", () => {
    const entries = [
      {
        startTime: makeDate(WEEK1_MONDAY, 0, 8),
        endTime: makeDate(WEEK1_MONDAY, 0, 16), // Mon 08-16
      },
      {
        startTime: makeDate(WEEK1_MONDAY, 1, 7), // Tue 07:00 — 15h rest
        endTime: makeDate(WEEK1_MONDAY, 1, 15),
      },
    ];

    const violations = findDailyRestViolations(entries);

    expect(violations).toHaveLength(0);
  });

  it("skips entries without startTime or endTime", () => {
    const entries = [
      {
        startTime: makeDate(WEEK1_MONDAY, 0, 8),
        endTime: makeDate(WEEK1_MONDAY, 0, 18),
      },
      {
        startTime: makeDate(WEEK1_MONDAY, 1, 2),
        // missing endTime
      },
      {
        // missing startTime
        endTime: makeDate(WEEK1_MONDAY, 1, 10),
      },
      {
        hours: 8, // no times at all
      },
    ];

    // Only one valid entry, so no consecutive pair → no violations
    const violations = findDailyRestViolations(entries);
    expect(violations).toHaveLength(0);
  });

  it("returns empty for fewer than 2 valid entries", () => {
    const violations = findDailyRestViolations([
      {
        startTime: makeDate(WEEK1_MONDAY, 0, 8),
        endTime: makeDate(WEEK1_MONDAY, 0, 16),
      },
    ]);
    expect(violations).toHaveLength(0);
  });
});

// ─── findWeeklyRestViolations ───────────────────────────────────────

describe("findWeeklyRestViolations", () => {
  it("no violations for standard Mon-Fri 8-16 schedule", () => {
    // Mon-Fri 8h days → weekends provide >24h rest
    const entries = makeWeekEntries(WEEK1_MONDAY, 8);

    const violations = findWeeklyRestViolations(entries);

    expect(violations).toHaveLength(0);
  });

  it("violation for 7 consecutive 16h days", () => {
    // 7 days × 16h (06:00-22:00) → max gap is 8h (22:00-06:00)
    const entries = Array.from({ length: 7 }, (_, i) => ({
      startTime: makeDate(WEEK1_MONDAY, i, 6),
      endTime: makeDate(WEEK1_MONDAY, i, 22),
    }));

    const violations = findWeeklyRestViolations(entries);

    expect(violations).toHaveLength(1);
    expect(violations[0].maxConsecutiveRestHours).toBe(8);
    expect(violations[0].weekStart).toBe("2026-01-05");
  });

  it("returns empty for no entries", () => {
    expect(findWeeklyRestViolations([])).toHaveLength(0);
  });
});

// ─── getComplianceStatus ────────────────────────────────────────────

describe("getComplianceStatus", () => {
  it("returns exempt=true for self-schedulers", () => {
    const entries = makeWeekEntries(WEEK1_MONDAY, 12); // extreme hours

    const result = getComplianceStatus({ isSelfScheduler: true }, entries);

    expect(result.exempt).toBe(true);
    expect(result.overallStatus).toBe("ok");
    expect(result.dailyRestViolations).toHaveLength(0);
    expect(result.weeklyRestViolations).toHaveLength(0);
  });

  it("returns overall violation when 48h average exceeded", () => {
    // 5 days × 10h = 50h/week → violation
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 10),
      ...makeWeekEntries(WEEK2_MONDAY, 10),
    ];

    const result = getComplianceStatus({ isSelfScheduler: false }, entries);

    expect(result.exempt).toBe(false);
    expect(result.overallStatus).toBe("violation");
    expect(result.weeklyAverage.status).toBe("violation");
  });

  it("returns ok when all checks pass", () => {
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 7.4),
      ...makeWeekEntries(WEEK2_MONDAY, 7.4),
    ];

    const result = getComplianceStatus({}, entries);

    expect(result.exempt).toBe(false);
    expect(result.overallStatus).toBe("ok");
    expect(result.dailyRestViolations).toHaveLength(0);
    expect(result.weeklyRestViolations).toHaveLength(0);
  });

  it("returns violation when daily rest violated", () => {
    const entries = [
      {
        startTime: makeDate(WEEK1_MONDAY, 0, 8),
        endTime: makeDate(WEEK1_MONDAY, 0, 18),
      },
      {
        startTime: makeDate(WEEK1_MONDAY, 1, 2), // 8h rest
        endTime: makeDate(WEEK1_MONDAY, 1, 10),
      },
    ];

    const result = getComplianceStatus({}, entries);

    expect(result.overallStatus).toBe("violation");
    expect(result.dailyRestViolations).toHaveLength(1);
  });
});

// ─── boundary values ──────────────────────────────────────────────

describe("boundary values", () => {
  it("exactly 11h rest is not a violation", () => {
    const violations = findDailyRestViolations([
      {
        startTime: new Date(2026, 3, 21, 8, 0),
        endTime: new Date(2026, 3, 21, 20, 0),
      },
      {
        startTime: new Date(2026, 3, 22, 7, 0),
        endTime: new Date(2026, 3, 22, 16, 0),
      },
    ]);
    expect(violations).toHaveLength(0);
  });

  it("exactly 24h weekly rest is not a violation", () => {
    // Work Mon-Sat 8-16, Sunday off = 40h gap from Sat 16:00 to Mon 8:00 — no violation
    const entries = [
      {
        startTime: new Date(2026, 3, 20, 8, 0),
        endTime: new Date(2026, 3, 20, 16, 0),
      },
      {
        startTime: new Date(2026, 3, 21, 8, 0),
        endTime: new Date(2026, 3, 21, 16, 0),
      },
      {
        startTime: new Date(2026, 3, 22, 8, 0),
        endTime: new Date(2026, 3, 22, 16, 0),
      },
      {
        startTime: new Date(2026, 3, 23, 8, 0),
        endTime: new Date(2026, 3, 23, 16, 0),
      },
      {
        startTime: new Date(2026, 3, 24, 8, 0),
        endTime: new Date(2026, 3, 24, 16, 0),
      },
      {
        startTime: new Date(2026, 3, 25, 8, 0),
        endTime: new Date(2026, 3, 25, 16, 0),
      },
    ];
    const violations = findWeeklyRestViolations(entries);
    expect(violations).toHaveLength(0);
  });

  it("exactly 48h weekly average is a violation", () => {
    // 5 days × 9.6h = 48h/week
    const entries = [
      ...makeWeekEntries(WEEK1_MONDAY, 9.6),
      ...makeWeekEntries(WEEK2_MONDAY, 9.6),
      ...makeWeekEntries(WEEK3_MONDAY, 9.6),
      ...makeWeekEntries(WEEK4_MONDAY, 9.6),
    ];

    const result = calculate48hWeeklyAverage(entries);

    expect(result.status).toBe("violation");
    expect(result.averageHoursPerWeek).toBe(48);
  });
});
