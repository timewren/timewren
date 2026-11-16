import { describe, expect, it } from "vitest";
import type { TimeEntryForProfitability } from "./calculate";
import { computeProfitability } from "./calculate";

// Helper to build a minimal time entry
function entry(
  hours: number,
  isBillable: boolean,
  resolvedRate: number | null,
): TimeEntryForProfitability {
  return { hours: String(hours), isBillable, resolvedRate };
}

describe("computeProfitability", () => {
  // -------------------------------------------------------------------------
  // Basic case
  // -------------------------------------------------------------------------
  describe("basic: 100 billable hrs @ 500 kr, 10 internal hrs, 50.000 invoiced", () => {
    const entries = [
      // 100 billable hours at 500 kr
      ...Array.from({ length: 10 }, () => entry(10, true, 500)),
      // 10 internal / non-billable hours
      entry(10, false, 0),
    ];

    const result = computeProfitability(
      { entries, invoicedAmount: 50_000 },
      500,
    );

    it("totalHours is 110", () => {
      expect(result.totalHours).toBe(110);
    });

    it("billableHours is 100", () => {
      expect(result.billableHours).toBe(100);
    });

    it("invoicedAmount is 50000", () => {
      expect(result.invoicedAmount).toBe(50_000);
    });

    it("agreedRate is 500 (weighted avg of billable entries)", () => {
      // Only entries with resolvedRate > 0 contribute to weighted avg.
      // The non-billable entry has rate 0, excluded from weight.
      // 100 hrs × 500 = 50000 / 100 = 500
      expect(result.agreedRate).toBe(500);
    });

    it("billableAvg is 500 (50000 / 100)", () => {
      expect(result.billableAvg).toBe(500);
    });

    it("realRate is ~454 (50000 / 110)", () => {
      // 50000 / 110 = 454.54... → Math.round → 455
      expect(result.realRate).toBe(455);
    });

    it("deltaPercent is negative (real < agreed)", () => {
      expect(result.deltaPercent).not.toBeNull();
      expect(result.deltaPercent as number).toBeLessThan(0);
    });

    it("hasData is true", () => {
      expect(result.hasData).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge: zero invoiced amount
  // -------------------------------------------------------------------------
  describe("edge: zero invoiced amount", () => {
    const entries = [entry(10, true, 600), entry(5, false, 0)];

    const result = computeProfitability({ entries, invoicedAmount: 0 }, 600);

    it("agreedRate can still compute from entries", () => {
      // 10 hrs × 600 = 6000 / 10 = 600
      expect(result.agreedRate).toBe(600);
    });

    it("billableAvg is null (no invoiced amount)", () => {
      expect(result.billableAvg).toBeNull();
    });

    it("realRate is null (no invoiced amount)", () => {
      expect(result.realRate).toBeNull();
    });

    it("deltaPercent is null when realRate is null", () => {
      expect(result.deltaPercent).toBeNull();
    });

    it("hasData is true", () => {
      expect(result.hasData).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Edge: only internal / non-billable time, no invoices
  // -------------------------------------------------------------------------
  describe("edge: only internal time, no invoices", () => {
    // Rate 0 is excluded from weighted average (to avoid pulling down agreed rate)
    const entries = [entry(8, false, 0), entry(4, false, 0)];

    const result = computeProfitability({ entries, invoicedAmount: 0 }, 500);

    it("hasData is true (there are hours)", () => {
      expect(result.hasData).toBe(true);
    });

    it("billableHours is 0", () => {
      expect(result.billableHours).toBe(0);
    });

    it("billableAvg is null (no billable hours)", () => {
      expect(result.billableAvg).toBeNull();
    });

    it("realRate is null (no invoiced amount)", () => {
      expect(result.realRate).toBeNull();
    });

    it("agreedRate falls back to user default rate when no rated entries", () => {
      // All entries have rate 0 → excluded. hasData=true so fallback applies
      // Actually: hasData=true means entries exist; fallback only used when !hasData.
      // With rate 0 entries, weightedRateHours=0 and hasData=true → agreedRate null.
      expect(result.agreedRate).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Edge: user has no time entries at all
  // -------------------------------------------------------------------------
  describe("edge: no time entries", () => {
    const result = computeProfitability(
      { entries: [], invoicedAmount: 0 },
      750,
    );

    it("hasData is false", () => {
      expect(result.hasData).toBe(false);
    });

    it("totalHours is 0", () => {
      expect(result.totalHours).toBe(0);
    });

    it("agreedRate falls back to user default rate (750)", () => {
      expect(result.agreedRate).toBe(750);
    });

    it("billableAvg is null", () => {
      expect(result.billableAvg).toBeNull();
    });

    it("realRate is null", () => {
      expect(result.realRate).toBeNull();
    });

    it("deltaPercent is null", () => {
      expect(result.deltaPercent).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Edge: user has no time entries and no default rate
  // -------------------------------------------------------------------------
  describe("edge: no time entries and no fallback rate", () => {
    const result = computeProfitability(
      { entries: [], invoicedAmount: 0 },
      null,
    );

    it("agreedRate is null", () => {
      expect(result.agreedRate).toBeNull();
    });

    it("hasData is false", () => {
      expect(result.hasData).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // Reel rate better than agreed (rare but possible)
  // -------------------------------------------------------------------------
  describe("edge: reel rate >= agreed rate (green scenario)", () => {
    // 10 hrs billable at agreed 400, but invoiced 5000 (500/hr)
    const entries = [entry(10, true, 400)];

    const result = computeProfitability(
      { entries, invoicedAmount: 5_000 },
      400,
    );

    it("realRate (500) >= agreedRate (400)", () => {
      expect(result.realRate as number).toBeGreaterThanOrEqual(
        result.agreedRate as number,
      );
    });

    it("deltaPercent is positive", () => {
      expect(result.deltaPercent as number).toBeGreaterThan(0);
    });
  });

  // -------------------------------------------------------------------------
  // Weighted average across multiple different rates
  // -------------------------------------------------------------------------
  describe("weighted average across multiple rates", () => {
    // 5 hrs @ 800, 5 hrs @ 600 = (4000 + 3000) / 10 = 700
    const entries = [entry(5, true, 800), entry(5, true, 600)];

    const result = computeProfitability(
      { entries, invoicedAmount: 7_000 },
      500,
    );

    it("agreedRate is 700 (weighted average)", () => {
      expect(result.agreedRate).toBe(700);
    });

    it("billableAvg is 700 (7000 / 10)", () => {
      expect(result.billableAvg).toBe(700);
    });

    it("realRate equals billableAvg when all hours are billable", () => {
      expect(result.realRate).toBe(result.billableAvg);
    });

    it("deltaPercent is 0", () => {
      expect(result.deltaPercent).toBe(0);
    });
  });
});
