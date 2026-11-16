import { describe, expect, it } from "vitest";
import { resolveWorkSchedule, scheduleHoursFor } from "@/lib/coverage/coverage";
import { memberUtilization, workHoursInRange } from "./utilization";

describe("workHoursInRange", () => {
  const standard = scheduleHoursFor(resolveWorkSchedule(null, null));

  it("sums the default 37-hour schedule over whole weeks", () => {
    // man 2026-09-07 → søn 2026-09-20 = to uger
    expect(workHoursInRange("2026-09-07", "2026-09-20", standard)).toBe(74);
  });

  it("counts only the days inside the range, both ends inclusive", () => {
    // ons-fre = 3 arbejdsdage, lør = 0
    expect(workHoursInRange("2026-09-09", "2026-09-12", standard)).toBe(22.2);
  });

  it("uses a custom per-weekday schedule (users.work_schedule)", () => {
    const fourDays = scheduleHoursFor(
      resolveWorkSchedule(
        { "1": 8, "2": 8, "3": 8, "4": 8, "5": 0, "6": 0, "7": 0 },
        null,
      ),
    );
    expect(workHoursInRange("2026-09-07", "2026-09-13", fourDays)).toBe(32);
  });

  it("treats negative/invalid day hours as 0 and an empty range as 0", () => {
    expect(workHoursInRange("2026-09-07", "2026-09-08", () => -5)).toBe(0);
    expect(workHoursInRange("2026-09-08", "2026-09-07", standard)).toBe(0);
  });

  it("follows an HR-style resolver (0 outside employment)", () => {
    const hr = (date: string) => (date >= "2026-09-10" ? 7.4 : 0);
    expect(workHoursInRange("2026-09-07", "2026-09-11", hr)).toBe(14.8);
  });
});

describe("memberUtilization", () => {
  it("divides billable and logged time by work time", () => {
    const r = memberUtilization({
      loggedHours: 148,
      billableHours: 111,
      workHours: 148,
    });
    expect(r.utilizationPct).toBe(75);
    expect(r.coveragePct).toBe(100);
  });

  it("can exceed 100 % when more is logged than the work time", () => {
    const r = memberUtilization({
      loggedHours: 45,
      billableHours: 40,
      workHours: 37,
    });
    expect(r.coveragePct).toBeCloseTo(121.62, 2);
    expect(r.utilizationPct).toBeCloseTo(108.11, 2);
  });

  it("returns null without work time", () => {
    expect(
      memberUtilization({ loggedHours: 10, billableHours: 5, workHours: 0 }),
    ).toEqual({ utilizationPct: null, coveragePct: null });
  });
});
