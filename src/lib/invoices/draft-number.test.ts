import { describe, expect, it } from "vitest";
import {
  DRAFT_NUMBER_PREFIXES,
  draftInvoiceNumber,
  draftNumberPrefix,
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
    expect(isDraftInvoiceNumber("17")).toBe(false);
    expect(isDraftInvoiceNumber(null)).toBe(false);
    expect(isDraftInvoiceNumber(undefined)).toBe(false);
  });

  it("UDKAST-numre må ikke ende i noget der ligner et serienummer for MAX-beregningen", () => {
    // Serie-beregningen ekskluderer via NOT LIKE '<præfiks>%' for hvert
    // præfiks i DRAFT_NUMBER_PREFIXES — dette låser kontrakten.
    for (const lang of ["da", "en", "de", "es", "fr"]) {
      const n = draftInvoiceNumber(lang);
      expect(DRAFT_NUMBER_PREFIXES.some((p) => n.startsWith(p))).toBe(true);
    }
  });

  it("formatInvoiceNumber viser Kladde for UDKAST og null", () => {
    expect(formatInvoiceNumber(draftInvoiceNumber())).toBe("Kladde");
    expect(formatInvoiceNumber(null)).toBe("Kladde");
    expect(formatInvoiceNumber("INV-042")).toBe("INV-042");
  });
});

describe("kladdepræfiks efter sprog (fund 18)", () => {
  it("følger organisationens sprog", () => {
    expect(draftNumberPrefix("da")).toBe("UDKAST-");
    expect(draftNumberPrefix("en")).toBe("DRAFT-");
    expect(draftNumberPrefix("de")).toBe("ENTWURF-");
    expect(draftNumberPrefix("es")).toBe("BORRADOR-");
    expect(draftNumberPrefix("en-US")).toBe("DRAFT-");
  });

  it("er dansk uden sprog og engelsk for andre sprog", () => {
    expect(draftNumberPrefix(undefined)).toBe("UDKAST-");
    expect(draftNumberPrefix("fr")).toBe("DRAFT-");
  });

  it("genkender kladder på alle sprog, også eksisterende UDKAST-numre", () => {
    expect(isDraftInvoiceNumber(draftInvoiceNumber("en"))).toBe(true);
    expect(isDraftInvoiceNumber(draftInvoiceNumber("de"))).toBe(true);
    expect(isDraftInvoiceNumber(draftInvoiceNumber("es"))).toBe(true);
    expect(isDraftInvoiceNumber("UDKAST-MWRVUI7L01US")).toBe(true);
    expect(formatInvoiceNumber("DRAFT-MWRVUI7L01US", "Draft")).toBe("Draft");
  });
});
