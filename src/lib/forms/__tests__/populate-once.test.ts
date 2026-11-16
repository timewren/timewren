import { describe, expect, it } from "vitest";
import { shouldPopulateForm } from "../populate-once";

describe("shouldPopulateForm (TimeEntryEditModal, review #774 P2-1)", () => {
  it("udfylder når posten indlæses første gang", () => {
    expect(shouldPopulateForm(null, "e1")).toBe(true);
  });

  it("udfylder IKKE igen når samme post hentes på ny (refetch udefra)", () => {
    expect(shouldPopulateForm("e1", "e1")).toBe(false);
  });

  it("udfylder når modalen skifter til en anden post", () => {
    expect(shouldPopulateForm("e1", "e2")).toBe(true);
  });

  it("udfylder ikke uden data", () => {
    expect(shouldPopulateForm(null, undefined)).toBe(false);
  });
});
