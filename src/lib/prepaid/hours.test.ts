import { describe, expect, it } from "vitest";
import {
  ceilPrepaidHours,
  normalizePrepaidDeductionHours,
  remainingAfterTotalChange,
  roundPrepaidHours,
} from "./hours";

describe("roundPrepaidHours — db-skalaen er 2 decimaler", () => {
  it("runder til nærmeste 0,01 time", () => {
    expect(roundPrepaidHours(2.855)).toBe(2.86);
    expect(roundPrepaidHours(2.854)).toBe(2.85);
    expect(roundPrepaidHours(17.25)).toBe(17.25);
  });

  it("runder halve decimaler op trods binær repræsentation", () => {
    // 1.005 * 100 er 100.49999… i float; uden EPSILON gav det 1,00.
    expect(roundPrepaidHours(1.005)).toBe(1.01);
  });
});

describe("ceilPrepaidHours — klip rundes altid op", () => {
  it("runder op til næste 0,01 time", () => {
    expect(ceilPrepaidHours(0.081)).toBe(0.09);
    expect(ceilPrepaidHours(0.0801)).toBe(0.09);
  });

  it("lader et tal der allerede ligger på skalaen stå", () => {
    // Uden EPSILON ville 0.07 * 100 = 7.000000000000001 give 0,08.
    expect(ceilPrepaidHours(0.07)).toBe(0.07);
    expect(ceilPrepaidHours(0.29)).toBe(0.29);
    expect(ceilPrepaidHours(1)).toBe(1);
  });
});

describe("normalizePrepaidDeductionHours — timerne der faktisk trækkes", () => {
  it("runder et frit træk til db-skalaen", () => {
    expect(normalizePrepaidDeductionHours(2.855)).toBe(2.86);
    expect(normalizePrepaidDeductionHours(1.005)).toBe(1.01);
  });

  it("gør et mikrotræk til 0, så det ikke koster en klip", () => {
    expect(normalizePrepaidDeductionHours(0.001)).toBe(0);
    expect(normalizePrepaidDeductionHours(1e-7)).toBe(0);
  });

  it("runder op til hele klip når kortet har en klipstørrelse", () => {
    // 5-minutters klip: 0,01 t er stadig ét klip = 5 min = 0,08333… t,
    // afrundet op til 0,09 t, fordi kolonnen kun har 2 decimaler.
    expect(normalizePrepaidDeductionHours(0.01, 5)).toBe(0.09);
    // Lige over ét klip koster to.
    expect(normalizePrepaidDeductionHours(0.1, 5)).toBe(0.17);
    // 15-minutters klip: en halv time er præcis to klip.
    expect(normalizePrepaidDeductionHours(0.5, 15)).toBe(0.5);
    expect(normalizePrepaidDeductionHours(0.51, 15)).toBe(0.75);
  });

  it("ignorerer en klipstørrelse på 0 eller null", () => {
    expect(normalizePrepaidDeductionHours(2.855, 0)).toBe(2.86);
    expect(normalizePrepaidDeductionHours(2.855, null)).toBe(2.86);
  });
});

describe("remainingAfterTotalChange (A1 P2-7)", () => {
  it("total over brugt: resten er forskellen, afrundet til 2 decimaler", () => {
    expect(remainingAfterTotalChange(40, 22.75)).toBe(17.25);
    expect(remainingAfterTotalChange(10, 3.333)).toBe(6.67);
  });

  it("total lig brugt: 0 tilbage", () => {
    expect(remainingAfterTotalChange(22.75, 22.75)).toBe(0);
  });

  it("total under brugt afvises (prod-constrainten kræver used + remaining = total)", () => {
    expect(remainingAfterTotalChange(20, 22.75)).toBeNull();
  });

  it("afrundingsstøj under 0,01 t tæller ikke som under brugt", () => {
    expect(remainingAfterTotalChange(22.75, 22.754)).toBe(0);
  });
});
