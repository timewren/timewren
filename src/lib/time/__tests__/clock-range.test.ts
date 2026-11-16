import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { clockRangeHours, clockRangeToInstants } from "../clock-range";

// Klokkeslæt fra formularerne tolkes i browserens lokaltid (dansk). Testen
// tvinger dansk tid, så sommertidsnætterne kan afprøves uanset om testen
// køres med TZ=UTC (CI) eller TZ=Europe/Copenhagen.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Copenhagen";
});
afterAll(() => {
  // Uden TZ skal nøglen fjernes; process.env.TZ = undefined giver "undefined"
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

describe("clockRangeHours — varighed fra reelle tidspunkter", () => {
  it("almindelig dag", () => {
    expect(clockRangeHours("2026-10-02", "09:00", "11:30")).toBe(2.5);
  });

  it("25/10 (vintertid): 01:00–04:00 er 4 reelle timer", () => {
    expect(clockRangeHours("2026-10-25", "01:00", "04:00")).toBe(4);
  });

  it("25/10: 02:00–03:00 er 2 reelle timer (den dobbelte time)", () => {
    // 02:00 sommertid (00:00Z) → 03:00 vintertid (02:00Z)
    expect(clockRangeHours("2026-10-25", "02:00", "03:00")).toBe(2);
  });

  it("29/3 (sommertid): 01:00–04:00 er 2 reelle timer", () => {
    expect(clockRangeHours("2027-03-28", "01:00", "04:00")).toBe(2);
  });

  it("hen over midnat: slut næste dag", () => {
    expect(clockRangeHours("2026-10-02", "23:00", "01:00")).toBe(2);
  });

  it("samme start og slut giver 0", () => {
    expect(clockRangeHours("2026-10-02", "09:00", "09:00")).toBe(0);
  });
});

describe("clockRangeToInstants", () => {
  it("bygger tidspunkter i lokaltid og lægger en dag til slut over midnat", () => {
    const { start, end } = clockRangeToInstants("2026-10-02", "23:00", "01:00");
    expect(start.toISOString()).toBe("2026-10-02T21:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-02T23:00:00.000Z");
  });

  it("25/10 01:00–04:00 → 23:00Z–03:00Z", () => {
    const { start, end } = clockRangeToInstants("2026-10-25", "01:00", "04:00");
    expect(start.toISOString()).toBe("2026-10-24T23:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-25T03:00:00.000Z");
  });
});
