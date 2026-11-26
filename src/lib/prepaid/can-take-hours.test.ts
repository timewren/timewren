import { describe, expect, it } from "vitest";
import { canTakePrepaidHours } from "./can-take-hours";

describe("canTakePrepaidHours (#1319)", () => {
  it("block: kræver saldo", () => {
    expect(canTakePrepaidHours({ remainingHours: 2 })).toBe(true);
    expect(canTakePrepaidHours({ remainingHours: 0 })).toBe(false);
    expect(canTakePrepaidHours({ remainingHours: "0.00" })).toBe(false);
    expect(
      canTakePrepaidHours({ remainingHours: "3", overdraftPolicy: "block" }),
    ).toBe(true);
  });

  it("block med timer: saldoen skal dække trækket", () => {
    expect(canTakePrepaidHours({ remainingHours: 2 }, 2)).toBe(true);
    expect(canTakePrepaidHours({ remainingHours: 2 }, 2.5)).toBe(false);
  });

  it("allow og invoice: et tomt kort tager stadig imod", () => {
    for (const overdraftPolicy of ["allow", "invoice"]) {
      expect(canTakePrepaidHours({ remainingHours: 0, overdraftPolicy })).toBe(
        true,
      );
      expect(
        canTakePrepaidHours({ remainingHours: "0", overdraftPolicy }, 5),
      ).toBe(true);
    }
  });

  it("ukendt eller manglende saldo tæller som tom", () => {
    expect(canTakePrepaidHours({ remainingHours: null })).toBe(false);
    expect(canTakePrepaidHours({ remainingHours: undefined })).toBe(false);
    expect(canTakePrepaidHours({ remainingHours: "abc" })).toBe(false);
  });
});
