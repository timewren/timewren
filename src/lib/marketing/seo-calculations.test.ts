import { describe, expect, it } from "vitest";
import { calculations } from "./seo-calculations";

describe("marketing calculators", () => {
  it("pays base rate plus supplement on overtime only", () => {
    expect(calculations.overtime([42, 37, 200, 50])).toEqual([5, 1500]);
    expect(calculations.overtime([35, 37, 200, 50])).toEqual([0, 0]);
  });

  it("includes eligible supplements in gross holiday pay", () => {
    expect(calculations.holiday([80, 180, 400])).toEqual([14800, 1850]);
  });

  it("preserves a negative balance and deducts time off", () => {
    expect(calculations.flex([-2, 40, 37, 5])).toEqual([3, -4]);
  });

  it("rounds a single entry upwards and preserves an exact boundary", () => {
    expect(calculations.rounding([1, 7, 15])).toEqual([75, 8]);
    expect(calculations.rounding([1, 15, 15])).toEqual([75, 0]);
  });

  it("projects a project overrun based on remaining work", () => {
    expect(calculations.budget([40, 28, 18])).toEqual([12, 46, -6]);
  });

  it("uses all hours and returns no rate for a zero denominator", () => {
    expect(calculations.effective([12000, 2000, 25, 5])).toEqual([
      10000,
      10000 / 30,
    ]);
    expect(calculations.effective([0, 2000, 0, 0])).toEqual([-2000, null]);
  });
  it("returns no rate when the quotient overflows", () => {
    expect(calculations.effective([100, 0, 1e-310, 0])).toEqual([100, null]);
    expect(calculations.effective([0, 100, 0, 1e-310])).toEqual([-100, null]);
  });
});
