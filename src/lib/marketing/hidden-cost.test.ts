import { describe, expect, it } from "vitest";
import { calculateYearlyHiddenCost } from "./hidden-cost";

describe("calculateYearlyHiddenCost", () => {
  it("beregner default-case korrekt (600 kr/t × 3 t/uge × 52 uger)", () => {
    expect(calculateYearlyHiddenCost(600, 3)).toBe(93600);
  });

  it("returnerer 0 når ufakturerede timer er 0", () => {
    expect(calculateYearlyHiddenCost(800, 0)).toBe(0);
  });

  it("håndterer halve timer korrekt (step=0.5)", () => {
    // 400 × 2.5 × 52 = 52000
    expect(calculateYearlyHiddenCost(400, 2.5)).toBe(52000);
  });

  it("afrunder til heltal", () => {
    // 333 × 1.5 × 52 = 25974 (allerede heltal, men test runder)
    expect(calculateYearlyHiddenCost(333, 1.5)).toBe(25974);
  });

  it("håndterer grænseværdier (min/max sliders)", () => {
    // Min: 100 kr × 0 t = 0
    expect(calculateYearlyHiddenCost(100, 0)).toBe(0);
    // Max: 2000 kr × 15 t × 52 = 1.560.000
    expect(calculateYearlyHiddenCost(2000, 15)).toBe(1_560_000);
  });
});
