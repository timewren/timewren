import { describe, expect, it } from "vitest";
import { segmentShiftMs } from "../segment-shift";

const H = 3_600_000;

describe("segmentShiftMs — segmenter følger med, når en post flyttes", () => {
  it("uændret dato: ingen forskydning (heller ikke ved ny starttid)", () => {
    expect(
      segmentShiftMs({
        oldDate: new Date("2026-10-01T00:00:00Z"),
        newDateStr: "2026-10-01",
        oldStart: new Date("2026-10-01T07:00:00Z"),
        newStart: "2026-10-01T08:00:00.000Z",
      }),
    ).toBe(0);
  });

  it("ny dato med start: forskydningen er start-flytningen", () => {
    // Over sommertidsskiftet: 09:00 dansk 24/10 → 09:00 dansk 26/10 = 49 t
    expect(
      segmentShiftMs({
        oldDate: new Date("2026-10-24T00:00:00Z"),
        newDateStr: "2026-10-26",
        oldStart: new Date("2026-10-24T07:00:00Z"),
        newStart: "2026-10-26T08:00:00.000Z",
      }),
    ).toBe(49 * H);
  });

  it("ny dato uden start: hele dage", () => {
    expect(
      segmentShiftMs({
        oldDate: new Date("2026-10-02T00:00:00Z"),
        newDateStr: "2026-10-01",
        oldStart: null,
        newStart: undefined,
      }),
    ).toBe(-24 * H);
  });
});
