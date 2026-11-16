import { describe, expect, it } from "vitest";
import { calculateFlexDelta } from "../flex";

describe("calculateFlexDelta", () => {
  it("returns positive delta when working overtime", () => {
    expect(calculateFlexDelta(7.4, 8.5)).toBeCloseTo(1.1);
  });

  it("returns negative delta when working less", () => {
    expect(calculateFlexDelta(7.4, 6.0)).toBeCloseTo(-1.4);
  });

  it("returns 0 on absence day (both 0)", () => {
    expect(calculateFlexDelta(0, 0)).toBe(0);
  });

  it("returns exact hours when no expected (weekend work)", () => {
    expect(calculateFlexDelta(0, 4.0)).toBe(4.0);
  });

  it("handles standard full-time day with exact hours", () => {
    expect(calculateFlexDelta(7.4, 7.4)).toBe(0);
  });

  it("handles large overtime", () => {
    expect(calculateFlexDelta(7.4, 12.0)).toBeCloseTo(4.6);
  });

  it("handles fractional hours precisely", () => {
    expect(calculateFlexDelta(5.625, 6.25)).toBeCloseTo(0.63, 1);
  });
});
