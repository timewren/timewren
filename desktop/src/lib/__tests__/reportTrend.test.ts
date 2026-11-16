import { describe, expect, it } from "vitest";
import { linearTrend, summarizeTrend, withTrend } from "@/lib/reportTrend";

describe("linearTrend", () => {
  it("returns nothing for an empty series", () => {
    expect(linearTrend([])).toEqual([]);
  });

  it("returns the single value when there is no slope to find", () => {
    expect(linearTrend([7.5])).toEqual([7.5]);
  });

  it("fits a flat line through a constant series", () => {
    expect(linearTrend([4, 4, 4, 4])).toEqual([4, 4, 4, 4]);
  });

  it("passes exactly through a straight line", () => {
    expect(linearTrend([1, 3, 5, 7])).toEqual([1, 3, 5, 7]);
  });

  it("keeps the same length as the input", () => {
    expect(linearTrend([2, 9, 3, 7, 1, 4])).toHaveLength(6);
  });

  it("rises when the later days are longer than the earlier ones", () => {
    const fit = linearTrend([2, 2, 8, 8]);
    expect(fit[fit.length - 1]).toBeGreaterThan(fit[0]);
  });

  it("falls when the later days are shorter than the earlier ones", () => {
    const fit = linearTrend([8, 8, 2, 2]);
    expect(fit[fit.length - 1]).toBeLessThan(fit[0]);
  });

  it("is not dragged to the extreme by a single outlier", () => {
    // Least squares, not a line through first and last. A 20-hour day in the
    // middle of an otherwise flat 4-hour series fits a slope of 3.2 h/day,
    // where a line through the endpoints would claim 4 h/day from one day.
    const fit = linearTrend([4, 4, 4, 4, 20]);
    const endpointSlope = (20 - 4) / 4;
    expect(fit[fit.length - 1] - fit[0]).toBeLessThan(endpointSlope * 4);
  });

  it("does not invent a slope from an outlier in the middle of the series", () => {
    // The spike sits on the mean x, so it raises the line without tilting it.
    const fit = linearTrend([4, 4, 20, 4, 4]);
    expect(fit[fit.length - 1]).toBeCloseTo(fit[0], 6);
    expect(fit[2]).toBeGreaterThan(4);
  });

  it("handles fractional hours", () => {
    const fit = linearTrend([0.5, 1.5, 2.5]);
    expect(fit[0]).toBeCloseTo(0.5, 6);
    expect(fit[2]).toBeCloseTo(2.5, 6);
  });
});

describe("summarizeTrend", () => {
  it("has nothing to say about an empty series", () => {
    expect(summarizeTrend([])).toBeNull();
  });

  it("calls a constant series flat", () => {
    const summary = summarizeTrend([6, 6, 6, 6]);
    expect(summary?.direction).toBe("flat");
    expect(summary?.changeHours).toBe(0);
  });

  it("calls a rising series up, with the change in hours per day", () => {
    const summary = summarizeTrend([2, 4, 6, 8]);
    expect(summary?.direction).toBe("up");
    expect(summary?.changeHours).toBeCloseTo(6, 6);
    expect(summary?.firstHours).toBeCloseTo(2, 6);
    expect(summary?.lastHours).toBeCloseTo(8, 6);
  });

  it("calls a falling series down, with a negative change", () => {
    const summary = summarizeTrend([8, 6, 4, 2]);
    expect(summary?.direction).toBe("down");
    expect(summary?.changeHours).toBeCloseTo(-6, 6);
  });

  it("calls a one-day series flat instead of pretending it trends", () => {
    expect(summarizeTrend([7])?.direction).toBe("flat");
  });

  it("treats a small drift as flat", () => {
    // +0.5 h over the whole period is noise, not a change of habits.
    const summary = summarizeTrend([6, 6.25, 6.5]);
    expect(summary?.direction).toBe("flat");
  });

  it("honours a custom flat threshold", () => {
    const summary = summarizeTrend([6, 6.25, 6.5], 0.25);
    expect(summary).not.toBeNull();
    expect(summary?.direction).toBe("up");
  });
});

describe("withTrend", () => {
  it("keeps the original fields", () => {
    const rows = withTrend([{ label: "man", total: 3 }], (d) => d.total);
    expect(rows[0].label).toBe("man");
    expect(rows[0].total).toBe(3);
  });

  it("rounds the trend to hundredths so the axis reads cleanly", () => {
    const rows = withTrend([1, 2, 4], (v) => v);
    for (const row of rows) {
      expect(row.trend).toBe(Number(row.trend.toFixed(2)));
    }
  });

  it("adds a trend to every row, so bars and line share one series", () => {
    const rows = withTrend([2, 4, 6, 8], (v) => v);
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.trend)).toEqual([2, 4, 6, 8]);
  });

  it("returns an empty array untouched", () => {
    expect(withTrend([], (v: number) => v)).toEqual([]);
  });
});
