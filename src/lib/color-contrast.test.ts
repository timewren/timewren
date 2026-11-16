import { describe, expect, it } from "vitest";
import {
  accessibleTextColor,
  getContrastRatio,
  mixHex,
} from "./color-contrast";

describe("getContrastRatio", () => {
  it("sort på hvidt giver maksimal kontrast (21:1)", () => {
    expect(getContrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 1);
  });

  it("samme farve giver ingen kontrast (1:1)", () => {
    expect(getContrastRatio("#1e5b47", "#1e5b47")).toBeCloseTo(1, 5);
  });

  it("er symmetrisk uanset argumentrækkefølge", () => {
    expect(getContrastRatio("#1e5b47", "#ffffff")).toBeCloseTo(
      getContrastRatio("#ffffff", "#1e5b47"),
      5,
    );
  });
});

describe("mixHex", () => {
  it("blander sort og hvidt 50/50 til grå", () => {
    expect(mixHex("#000000", "#ffffff", 0.5)).toBe("#808080");
  });

  it("alpha 0 giver baggrundsfarven uændret", () => {
    expect(mixHex("#ff0000", "#1f2937", 0)).toBe("#1f2937");
  });

  it("alpha 1 giver forgrundsfarven uændret", () => {
    expect(mixHex("#ff0000", "#1f2937", 1)).toBe("#ff0000");
  });
});

describe("accessibleTextColor", () => {
  it("lader farven stå, når den allerede opfylder 4,5:1", () => {
    // Granskov mod hvid har 7,95:1 (docs/BRAND.md)
    expect(accessibleTextColor("#1e5b47", "#ffffff")).toBe("#1e5b47");
  });

  it("mørkner en lys kundefarve, så den bliver læsbar på en lys badge", () => {
    const bg = "#fdf1dc"; // let gul optoning
    const result = accessibleTextColor("#f59e0b", bg);
    expect(getContrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("lysner en mørk kundefarve, så den bliver læsbar på en mørk badge", () => {
    const bg = "#2a2117"; // mørk optoning
    const result = accessibleTextColor("#7c3f00", bg);
    expect(getContrastRatio(result, bg)).toBeGreaterThanOrEqual(4.5);
  });

  it("holder sig under 50 forsøg for ekstreme farver uden at hænge", () => {
    const bg = "#808080";
    const result = accessibleTextColor("#808080", bg);
    // Kan ikke nå 4,5:1 fra midtergråt mod midtergråt uden at ramme sort/hvid
    expect(["#000000", "#ffffff"]).toContain(result);
  });
});
