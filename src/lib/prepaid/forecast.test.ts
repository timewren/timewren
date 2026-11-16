import { describe, expect, it } from "vitest";
import { forecastPrepaid } from "./forecast";

const now = new Date("2026-11-02T12:00:00Z");
const base = { createdAt: new Date("2026-09-01"), remainingHours: 20, now };
const usage = (hoursUsed: string, date: string) => ({
  hoursUsed,
  createdAt: new Date(date),
});

describe("forecastPrepaid", () => {
  it("uses all 30 calendar days including idle days and existing balance", () => {
    const result = forecastPrepaid({
      ...base,
      usage: [usage("30", "2026-10-04")],
    });
    expect(result.hoursPerWeek).toBe(7);
    expect(result.daysRemaining).toBe(20);
    expect(result.exhaustionDate).toBe("2026-11-22");
    expect(result.dailyUsage).toHaveLength(30);
    expect(result.dailyUsage[0].hours).toBe(30);
  });
  it("uses work dates for imports, manual deduction dates, and Danish day boundaries", () => {
    const result = forecastPrepaid({
      ...base,
      usage: [
        {
          ...usage("100", "2026-11-01"),
          timeEntry: { date: new Date("2026-09-01") },
        },
        usage("2", "2026-10-03T22:30:00Z"),
        usage("3", "2026-11-02"),
        usage("99", "2026-11-03"),
      ],
    });
    expect(result.consumedHours).toBe(5);
    expect(result.dailyUsage[0].hours).toBe(2);
  });
  it("does not invent a forecast without recent consumption", () => {
    expect(forecastPrepaid({ ...base, usage: [] }).exhaustionDate).toBeNull();
  });
  it("requires seven observed days and shortens the window for new cards", () => {
    const result = forecastPrepaid({
      ...base,
      createdAt: new Date("2026-10-31"),
      usage: [usage("3", "2026-11-01")],
    });
    expect(result.observedDays).toBe(3);
    expect(result.hoursPerWeek).toBe(7);
    expect(result.exhaustionDate).toBeNull();
  });
  it("does not project inactive, expired or exhausted cards", () => {
    for (const extra of [
      { isActive: false },
      { expiryDate: new Date("2026-11-01") },
      { remainingHours: 0 },
      { remainingHours: -2 },
    ]) {
      expect(
        forecastPrepaid({
          ...base,
          ...extra,
          usage: [usage("30", "2026-11-01")],
        }).exhaustionDate,
      ).toBeNull();
    }
  });
  it("distinguishes expiry from projected exhaustion and keeps expiry day valid", () => {
    const result = forecastPrepaid({
      ...base,
      expiryDate: new Date("2026-11-02"),
      usage: [usage("30", "2026-11-01")],
    });
    expect(result.exhaustionDate).toBe("2026-11-22");
    expect(result.expiresBeforeExhaustion).toBe(true);
  });
});
