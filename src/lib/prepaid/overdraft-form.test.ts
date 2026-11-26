import { describe, expect, it } from "vitest";
import { overdraftUpdateFromForm, toOverdraftPolicy } from "./overdraft-form";

describe("toOverdraftPolicy", () => {
  it("bevarer de tre kendte politikker", () => {
    expect(toOverdraftPolicy("block")).toBe("block");
    expect(toOverdraftPolicy("allow")).toBe("allow");
    expect(toOverdraftPolicy("invoice")).toBe("invoice");
  });

  it("læser ukendt eller manglende værdi som block", () => {
    expect(toOverdraftPolicy(null)).toBe("block");
    expect(toOverdraftPolicy(undefined)).toBe("block");
    expect(toOverdraftPolicy("")).toBe("block");
    expect(toOverdraftPolicy("andet")).toBe("block");
  });
});

describe("overdraftUpdateFromForm (#1319)", () => {
  it("et blokerende kort kan skiftes til at tillade overtræk", () => {
    expect(overdraftUpdateFromForm("allow", "")).toEqual({
      overdraftPolicy: "allow",
    });
  });

  it("sender satsen ved invoice", () => {
    expect(overdraftUpdateFromForm("invoice", "950")).toEqual({
      overdraftPolicy: "invoice",
      overdraftRate: 950,
    });
  });

  it("lader en gemt sats være, når politikken ikke er invoice", () => {
    // Udeladt felt = serveren rører ikke kolonnen (prepaid.update)
    expect("overdraftRate" in overdraftUpdateFromForm("allow", "950")).toBe(
      false,
    );
    expect("overdraftRate" in overdraftUpdateFromForm("block", "")).toBe(false);
  });

  it("en tom, nul eller ugyldig sats betyder postens egen sats", () => {
    expect(overdraftUpdateFromForm("invoice", "").overdraftRate).toBeNull();
    expect(overdraftUpdateFromForm("invoice", "0").overdraftRate).toBeNull();
    expect(overdraftUpdateFromForm("invoice", "abc").overdraftRate).toBeNull();
    expect(overdraftUpdateFromForm("invoice", undefined).overdraftRate).toBe(
      null,
    );
  });

  it("manglende politik bliver block", () => {
    expect(overdraftUpdateFromForm(undefined, "").overdraftPolicy).toBe(
      "block",
    );
  });
});
