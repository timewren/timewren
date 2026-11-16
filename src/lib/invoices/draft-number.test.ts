import { describe, expect, it } from "vitest";
import {
  draftInvoiceNumber,
  formatInvoiceNumber,
  isDraftInvoiceNumber,
} from "./draft-number";

describe("draft-number (#196)", () => {
  it("genererer UDKAST-numre der genkendes som kladder", () => {
    const n = draftInvoiceNumber();
    expect(n.startsWith("UDKAST-")).toBe(true);
    expect(isDraftInvoiceNumber(n)).toBe(true);
  });

  it("genererer unikke numre", () => {
    const numbers = new Set(
      Array.from({ length: 200 }, () => draftInvoiceNumber()),
    );
    expect(numbers.size).toBe(200);
  });

  it("rigtige numre genkendes ikke som kladder", () => {
    expect(isDraftInvoiceNumber("INV-042")).toBe(false);
    expect(isDraftInvoiceNumber("2026-117")).toBe(false);
    expect(isDraftInvoiceNumber(null)).toBe(false);
    expect(isDraftInvoiceNumber(undefined)).toBe(false);
  });

  it("UDKAST-numre må ikke ende i noget der ligner et serienummer for MAX-beregningen", () => {
    // Serie-beregningen ekskluderer via NOT LIKE 'UDKAST-%' — dette låser
    // kontrakten: prefixet må aldrig ændres uden at SQL'en følger med.
    const n = draftInvoiceNumber();
    expect(n.toUpperCase().startsWith("UDKAST-")).toBe(true);
  });

  it("formatInvoiceNumber viser Kladde for UDKAST og null", () => {
    expect(formatInvoiceNumber(draftInvoiceNumber())).toBe("Kladde");
    expect(formatInvoiceNumber(null)).toBe("Kladde");
    expect(formatInvoiceNumber("INV-042")).toBe("INV-042");
  });
});
