import { describe, expect, it } from "vitest";
import { mergeCompanySettings } from "./company-settings";

const user = {
  companyType: "sole_prop",
  vatPeriod: "quarterly",
  fiscalYearEnd: "06-30",
  hasEmployees: true,
};

describe("mergeCompanySettings", () => {
  it("uses the company profile when one exists", () => {
    expect(
      mergeCompanySettings(user, {
        companyType: "aps",
        vatPeriod: "monthly",
        fiscalYearEnd: "12-31",
        hasEmployees: false,
      }),
    ).toEqual({
      companyType: "aps",
      vatPeriod: "monthly",
      fiscalYearEnd: "12-31",
      hasEmployees: false,
    });
  });

  it("uses the user's row without a company profile", () => {
    expect(mergeCompanySettings(user, undefined)).toEqual(user);
  });

  it("falls back to the user's value for an empty profile field", () => {
    expect(
      mergeCompanySettings(user, {
        companyType: null,
        vatPeriod: null,
        fiscalYearEnd: null,
        hasEmployees: false,
      }),
    ).toEqual({ ...user, hasEmployees: false });
  });

  it("keeps the user's employees when the profile never saved them", () => {
    // A profile created before the user's choice was copied over (#1276).
    expect(
      mergeCompanySettings(user, {
        companyType: "aps",
        vatPeriod: null,
        fiscalYearEnd: null,
        hasEmployees: null,
      }),
    ).toEqual({ ...user, companyType: "aps", hasEmployees: true });
  });

  it("respects an employee setting saved on the profile", () => {
    expect(
      mergeCompanySettings(
        { ...user, hasEmployees: false },
        { ...user, hasEmployees: true },
      ).hasEmployees,
    ).toBe(true);
    expect(
      mergeCompanySettings(user, { ...user, hasEmployees: false }).hasEmployees,
    ).toBe(false);
  });

  it("returns empty settings when neither exists", () => {
    expect(mergeCompanySettings(undefined, undefined)).toEqual({
      companyType: null,
      vatPeriod: null,
      fiscalYearEnd: null,
      hasEmployees: false,
    });
  });
});
