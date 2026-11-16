import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adjustRangeForEdit } from "../edit-range";

// Redigering sker i browseren (dansk lokaltid); tving dansk tid, så testen
// giver samme svar under TZ=UTC (CI) og TZ=Europe/Copenhagen.
const originalTz = process.env.TZ;
beforeAll(() => {
  process.env.TZ = "Europe/Copenhagen";
});
afterAll(() => {
  // Uden TZ skal nøglen fjernes; process.env.TZ = undefined giver "undefined"
  if (originalTz === undefined) delete process.env.TZ;
  else process.env.TZ = originalTz;
});

const iso = (d: Date | undefined) => d?.toISOString();

describe("adjustRangeForEdit", () => {
  it("flytter start og slut med til den nye dato og bevarer klokkeslættene", () => {
    // 09:00–11:00 dansk tid den 1/10 → 2/10
    const r = adjustRangeForEdit({
      startTime: new Date("2026-10-01T07:00:00Z"),
      endTime: new Date("2026-10-01T09:00:00Z"),
      oldDateStr: "2026-10-01",
      newDateStr: "2026-10-02",
      oldHours: 2,
      newHours: 2,
    });
    expect(iso(r?.startTime)).toBe("2026-10-02T07:00:00.000Z");
    expect(iso(r?.endTime)).toBe("2026-10-02T09:00:00.000Z");
  });

  it("klokkeslættene bevares hen over sommertidsskiftet", () => {
    // 09:00–11:00 den 24/10 (sommertid) → 26/10 (vintertid)
    const r = adjustRangeForEdit({
      startTime: new Date("2026-10-24T07:00:00Z"),
      endTime: new Date("2026-10-24T09:00:00Z"),
      oldDateStr: "2026-10-24",
      newDateStr: "2026-10-26",
      oldHours: 2,
      newHours: 2,
    });
    expect(iso(r?.startTime)).toBe("2026-10-26T08:00:00.000Z");
    expect(iso(r?.endTime)).toBe("2026-10-26T10:00:00.000Z");
  });

  it("ændrede timer: slut = start + timer", () => {
    const r = adjustRangeForEdit({
      startTime: new Date("2026-10-01T07:00:00Z"),
      endTime: new Date("2026-10-01T09:00:00Z"),
      oldDateStr: "2026-10-01",
      newDateStr: "2026-10-01",
      oldHours: 2,
      newHours: 3.25,
    });
    expect(iso(r?.startTime)).toBe("2026-10-01T07:00:00.000Z");
    expect(iso(r?.endTime)).toBe("2026-10-01T10:15:00.000Z");
  });

  it("dato og timer ændret samtidig", () => {
    const r = adjustRangeForEdit({
      startTime: new Date("2026-10-01T07:00:00Z"),
      endTime: new Date("2026-10-01T09:00:00Z"),
      oldDateStr: "2026-10-01",
      newDateStr: "2026-09-30",
      oldHours: 2,
      newHours: 1,
    });
    expect(iso(r?.startTime)).toBe("2026-09-30T07:00:00.000Z");
    expect(iso(r?.endTime)).toBe("2026-09-30T08:00:00.000Z");
  });

  it("uændrede timer på en post med pause: spændet bevares", () => {
    // Timer 13:45–15:01 med 0,51 t registreret; kun datoen flyttes
    const r = adjustRangeForEdit({
      startTime: new Date("2026-10-01T11:45:00Z"),
      endTime: new Date("2026-10-01T13:01:00Z"),
      oldDateStr: "2026-10-01",
      newDateStr: "2026-10-02",
      oldHours: 0.51,
      newHours: 0.51,
    });
    expect(iso(r?.startTime)).toBe("2026-10-02T11:45:00.000Z");
    expect(iso(r?.endTime)).toBe("2026-10-02T13:01:00.000Z");
  });

  it("intet ændret: null (intet sendes)", () => {
    expect(
      adjustRangeForEdit({
        startTime: new Date("2026-10-01T07:00:00Z"),
        endTime: new Date("2026-10-01T09:00:00Z"),
        oldDateStr: "2026-10-01",
        newDateStr: "2026-10-01",
        oldHours: 2,
        newHours: 2,
      }),
    ).toBeNull();
  });

  it("post uden tidsrum: null", () => {
    expect(
      adjustRangeForEdit({
        startTime: null,
        endTime: null,
        oldDateStr: "2026-10-01",
        newDateStr: "2026-10-02",
        oldHours: 2,
        newHours: 3,
      }),
    ).toBeNull();
  });
});
