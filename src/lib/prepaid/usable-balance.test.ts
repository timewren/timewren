import { describe, expect, it } from "vitest";
import { sumUsablePrepaidHours } from "./usable-balance";

const now = new Date("2026-10-02T10:00:00Z");

describe("sumUsablePrepaidHours (A1 P2-5)", () => {
  it("tæller kun aktive, ikke-arkiverede og ikke-udløbne kort", () => {
    // kunde As hovedklient: 25,75 + 27,60 aktive, 57,59 deaktiveret
    const total = sumUsablePrepaidHours(
      [
        { remainingHours: "25.75", isActive: true, expiryDate: null },
        { remainingHours: "27.60", isActive: true, expiryDate: null },
        { remainingHours: "57.59", isActive: false, expiryDate: null },
        {
          remainingHours: "10.00",
          isActive: true,
          expiryDate: new Date("2026-09-30T00:00:00Z"),
        },
        {
          remainingHours: "5.00",
          isActive: true,
          isArchived: true,
          expiryDate: null,
        },
        {
          remainingHours: "2.00",
          isActive: true,
          expiryDate: new Date("2026-12-31T00:00:00Z"),
        },
      ],
      now,
    );
    expect(total).toBeCloseTo(55.35, 2);
  });

  it("ingen kort: 0", () => {
    expect(sumUsablePrepaidHours(undefined, now)).toBe(0);
  });
});
