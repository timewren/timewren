import { describe, expect, it } from "vitest";
import { forecastCompliance, forecastWindow } from "../compliance-forecast";
import {
  mergeRegisteredIntoEntries,
  planWallTime,
  registeredDay,
} from "../work-plan";

describe("compliance forecast (#513)", () => {
  it("preserves recorded extremes when the plan supplies more hours", () => {
    const date = "2026-11-09";
    const day = registeredDay({
      date,
      planned: {
        planId: "plan-test",
        weekIndex: 0,
        start: "08:00",
        end: "17:00",
        hours: 8,
        breakMinutes: 60,
      },
      dayOff: null,
      absence: false,
      deviation: null,
    });
    const merged = mergeRegisteredIntoEntries(
      [
        {
          date,
          hours: 4,
          startTime: planWallTime(date, "06:00"),
          endTime: planWallTime(date, "10:00"),
        },
        {
          date,
          hours: 1,
          startTime: planWallTime(date, "18:00"),
          endTime: planWallTime(date, "19:00"),
        },
      ],
      [day],
      "2026-11-16",
      planWallTime,
      true,
    );
    expect(merged).toHaveLength(1);
    expect(merged[0].hours).toBe(8);
    expect(merged[0].startTime).toEqual(planWallTime(date, "06:00"));
    expect(merged[0].endTime).toEqual(planWallTime(date, "19:00"));
    const result = forecastCompliance({
      weekStart: date,
      months: 4,
      entries: [
        {
          date: "2026-11-08",
          hours: 8,
          startTime: planWallTime("2026-11-08", "12:00"),
          endTime: planWallTime("2026-11-08", "20:00"),
        },
        ...merged,
      ],
    });
    expect(result.restWarnings[0].restHours).toBe(10);
  });
  it("uses rolling calendar months for both reference periods", () => {
    expect(forecastWindow("2026-11-09", 4)).toEqual({
      from: "2026-07-15",
      to: "2026-11-15",
    });
    expect(forecastWindow("2026-11-09", 12).from).toBe("2025-11-15");
    expect(forecastWindow("2030-06-24", 4).from).toBe("2030-02-28");
  });

  it("preserves planned end including breaks without double counting hours", () => {
    const day = registeredDay({
      date: "2026-11-09",
      planned: {
        planId: "plan-test",
        weekIndex: 0,
        start: "08:00",
        end: "17:00",
        hours: 8,
        breakMinutes: 60,
      },
      dayOff: null,
      absence: false,
      deviation: null,
    });
    const entries = mergeRegisteredIntoEntries(
      [{ date: day.date, hours: 2, endTime: null }],
      [day],
      "2026-11-16",
      planWallTime,
      true,
    );
    expect(entries).toHaveLength(1);
    expect(entries[0].hours).toBe(8);
    expect(entries[0].endTime).toEqual(planWallTime(day.date, "17:00"));
  });

  const entries = Array.from({ length: 18 }, (_, i) => {
    const date =
      i === 0
        ? "2026-07-15"
        : new Date(Date.UTC(2026, 6, 13 + i * 7)).toISOString().slice(0, 10);
    return { date, hours: 47 };
  });

  it("counts recorded and planned hours once and exposes remaining hours", () => {
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 4,
      entries,
    });
    expect(result.averageHoursPerWeek).toBe(47);
    expect(result.remainingHours).toBe(18);
    expect(result.findings).toHaveLength(1);
  });

  it("keeps absence neutral instead of diluting the average", () => {
    const neutral = [
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ];
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 4,
      entries: entries.filter((e) => e.date !== "2026-07-20"),
      neutralAbsenceDates: neutral,
    });
    expect(result.averageHoursPerWeek).toBe(47);
    expect(result.remainingHours).toBe(17);
  });

  it("checks rest across the week boundary using the actual planned end", () => {
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 4,
      entries: [
        {
          date: "2026-11-08",
          hours: 8,
          startTime: planWallTime("2026-11-08", "14:00"),
          endTime: planWallTime("2026-11-08", "23:00"),
        },
        {
          date: "2026-11-09",
          hours: 8,
          startTime: planWallTime("2026-11-09", "09:00"),
          endTime: planWallTime("2026-11-09", "17:00"),
        },
      ],
    });
    expect(result.restWarnings[0].restHours).toBe(10);
    expect(result.findings.some((f) => f.includes("10,0"))).toBe(true);
  });

  it("exempts self schedulers and respects disabled rules", () => {
    expect(
      forecastCompliance({
        weekStart: "2026-11-09",
        months: 4,
        entries,
        exempt: true,
      }).findings,
    ).toEqual([]);
    expect(
      forecastCompliance({
        weekStart: "2026-11-09",
        months: 4,
        entries,
        rule48h: "off",
      }).findings,
    ).toEqual([]);
  });

  it("does not dilute new employees with weeks before employment", () => {
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 12,
      entries: [{ date: "2026-11-09", hours: 49 }],
      employmentStart: "2026-11-09",
    });
    expect(result.averageHoursPerWeek).toBe(49);
    expect(result.remainingHours).toBe(-1);
  });

  it("time off in lieu stays in the denominator", () => {
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 4,
      entries: entries.filter((e) => e.date !== "2026-07-20"),
      neutralAbsenceDates: [],
    });
    expect(result.averageHoursPerWeek).toBe(44.39);
    expect(result.findings).toEqual([]);
  });

  it("detects a rolling breach early in the week even if old work expires before Sunday", () => {
    const earlyHours = Array.from({ length: 6 }, (_, i) => ({
      date: `2026-07-${String(9 + i).padStart(2, "0")}`,
      hours: 13,
    }));
    const result = forecastCompliance({
      weekStart: "2026-11-09",
      months: 4,
      entries: [...entries, ...earlyHours],
    });
    expect(result.status).toBe("violation");
    expect(result.remainingHours).toBeLessThan(0);
  });
});
