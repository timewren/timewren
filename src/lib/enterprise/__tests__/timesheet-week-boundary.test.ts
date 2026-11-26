import { describe, expect, it } from "vitest";
import { weekStartOf } from "../edit-guard";
import { dayOffsetFromWeekStart } from "../timesheet";

describe("Danish timesheet weeks", () => {
  it("locks a Sunday UTC entry in its Danish Monday week", () => {
    expect(weekStartOf(new Date("2026-11-08T23:30:00Z"))).toBe("2026-11-09");
  });

  it("counts calendar days from a Danish midnight anchor across DST", () => {
    const monday = new Date("2026-10-18T22:00:00Z");
    expect(dayOffsetFromWeekStart(monday, monday)).toBe(0);
    expect(
      dayOffsetFromWeekStart(new Date("2026-10-25T23:00:00Z"), monday),
    ).toBe(7);
  });
});
