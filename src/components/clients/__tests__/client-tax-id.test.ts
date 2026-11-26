import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checkClientTaxId, normalizeClientTaxId } from "../client-tax-id";

const schema = (stored?: string) =>
  z
    .object({
      country: z.string().optional(),
      cvrNumber: z.string().optional(),
    })
    .superRefine((data, ctx) =>
      checkClientTaxId(
        data,
        ctx,
        { vatInvalid: "ugyldigt", tooLong: "for langt" },
        stored,
      ),
    );

const issue = (country: string, cvrNumber: string) =>
  schema().safeParse({ country, cvrNumber }).error?.issues[0];

describe("checkClientTaxId (fund 19)", () => {
  it("lader et dansk CVR-nummer være som før", () => {
    expect(issue("Danmark", "12345678")).toBeUndefined();
    expect(issue("DK", "12 34 56 78")).toBeUndefined();
  });

  it("kræver EU-form i et EU-land", () => {
    expect(issue("Germany", "DE123456789")).toBeUndefined();
    expect(issue("Tyskland", "de 123 456 789")).toBeUndefined();
    const bad = issue("Germany", "123");
    expect(bad?.message).toBe("ugyldigt");
    expect(bad?.path).toEqual(["cvrNumber"]);
    expect(issue("Deutschland", "12345")?.message).toBe("ugyldigt");
    expect(issue("FR", "12345")?.message).toBe("ugyldigt");
    expect(issue("Österreich", "12345")?.message).toBe("ugyldigt");
  });

  it("tager andre landes skattenumre, fx et amerikansk EIN", () => {
    expect(issue("USA", "12-3456789")).toBeUndefined();
    expect(issue("United States", "12-3456789")).toBeUndefined();
    expect(issue("Norge", "123 456 789 MVA")).toBeUndefined();
    expect(issue("Schweiz", "CHE-123.456.789")).toBeUndefined();
    expect(issue("", "12-3456789")).toBeUndefined();
  });

  it("afviser mere end 20 tegn i alle lande", () => {
    expect(issue("USA", "1".repeat(21))?.message).toBe("for langt");
    expect(issue("USA", ` ${"1".repeat(20)} `)).toBeUndefined();
  });

  it("afviser ikke en eksisterende kundes gemte nummer", () => {
    expect(
      schema("556677-8899").safeParse({
        country: "Sverige",
        cvrNumber: "556677-8899",
      }).success,
    ).toBe(true);
  });

  it("er tilfreds uden nummer", () => {
    expect(issue("", "")).toBeUndefined();
    expect(issue("Germany", "   ")).toBeUndefined();
  });
});

describe("normalizeClientTaxId", () => {
  it("normaliserer EU-momsnumre", () => {
    expect(normalizeClientTaxId("Germany", "de 123 456 789")).toBe(
      "DE123456789",
    );
  });

  it("gemmer andre numre som skrevet", () => {
    expect(normalizeClientTaxId("Danmark", " 12345678 ")).toBe("12345678");
    expect(normalizeClientTaxId("Sverige", "556677-8899")).toBe("556677-8899");
    expect(normalizeClientTaxId("USA", " 12-3456789 ")).toBe("12-3456789");
    expect(normalizeClientTaxId("Schweiz", "CHE-123.456.789")).toBe(
      "CHE-123.456.789",
    );
    expect(normalizeClientTaxId("", "de 123 456 789")).toBe("de 123 456 789");
  });

  it("giver undefined uden nummer", () => {
    expect(normalizeClientTaxId("Germany", "  ")).toBeUndefined();
  });
});
