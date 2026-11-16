import { describe, expect, it } from "vitest";
import { isUniqueViolation } from "./pg-errors";

describe("isUniqueViolation", () => {
  it("genkender postgres-js-fejl med code direkte", () => {
    expect(isUniqueViolation({ code: "23505" })).toBe(true);
    expect(isUniqueViolation({ code: "23503" })).toBe(false);
  });

  it("genkender Drizzle-indpakket fejl via cause", () => {
    const err = new Error("Failed query");
    (err as Error & { cause?: unknown }).cause = { code: "23505" };
    expect(isUniqueViolation(err)).toBe(true);
  });

  it("er robust over for alt andet", () => {
    expect(isUniqueViolation(null)).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation("23505")).toBe(false);
    expect(isUniqueViolation(new Error("x"))).toBe(false);
  });
});
