import { describe, expect, it } from "vitest";
import {
  formatQuarterTime,
  initialSlotCursor,
  moveSlotCursor,
  resizeSlotCursor,
  slotCursorToTimes,
} from "@/lib/calendarSlots";

// A 6–23 grid, like DayView and WeekView use
const START_HOUR = 6;
const TOTAL_QUARTERS = 17 * 4;

function at(hour: number, minute = 0): Date {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d;
}

describe("initialSlotCursor", () => {
  it("starts at the current time, snapped to a quarter hour", () => {
    const cursor = initialSlotCursor(at(9, 37), START_HOUR, TOTAL_QUARTERS, 4);
    expect(cursor).toEqual({ startQ: 14, endQ: 18 }); // 09:30–10:30
  });

  it("clamps to the top of the grid before it opens", () => {
    const cursor = initialSlotCursor(at(3), START_HOUR, TOTAL_QUARTERS, 4);
    expect(cursor).toEqual({ startQ: 0, endQ: 4 }); // 06:00–07:00
  });

  it("keeps the whole block inside the grid at the end of the day", () => {
    const cursor = initialSlotCursor(at(22, 50), START_HOUR, TOTAL_QUARTERS, 4);
    expect(cursor.endQ).toBeLessThanOrEqual(TOTAL_QUARTERS);
    expect(cursor.endQ - cursor.startQ).toBe(4);
    // 22:50 would want 22:45–23:45, so it must move back to fit
    expect(cursor).toEqual({ startQ: 64, endQ: 68 }); // 22:00–23:00
  });

  it("shrinks the block when the grid is smaller than the block", () => {
    const cursor = initialSlotCursor(at(9), START_HOUR, 2, 4);
    expect(cursor).toEqual({ startQ: 0, endQ: 2 });
  });
});

describe("moveSlotCursor", () => {
  const cursor = { startQ: 8, endQ: 12 }; // 08:00–09:00

  it("moves the block and keeps its length", () => {
    expect(moveSlotCursor(cursor, 1, TOTAL_QUARTERS)).toEqual({
      startQ: 9,
      endQ: 13,
    });
    expect(moveSlotCursor(cursor, -1, TOTAL_QUARTERS)).toEqual({
      startQ: 7,
      endQ: 11,
    });
  });

  it("stops at the top of the grid", () => {
    expect(moveSlotCursor({ startQ: 0, endQ: 4 }, -1, TOTAL_QUARTERS)).toEqual({
      startQ: 0,
      endQ: 4,
    });
  });

  it("stops with the end flush to the last hour", () => {
    const moved = moveSlotCursor(
      { startQ: TOTAL_QUARTERS - 2, endQ: TOTAL_QUARTERS },
      1,
      TOTAL_QUARTERS,
    );
    expect(moved).toEqual({ startQ: TOTAL_QUARTERS - 2, endQ: TOTAL_QUARTERS });
  });
});

describe("resizeSlotCursor", () => {
  const cursor = { startQ: 8, endQ: 12 };

  it("changes only the end, so the length changes", () => {
    expect(resizeSlotCursor(cursor, 2, TOTAL_QUARTERS)).toEqual({
      startQ: 8,
      endQ: 14,
    });
  });

  it("never goes below a quarter hour", () => {
    expect(resizeSlotCursor(cursor, -10, TOTAL_QUARTERS)).toEqual({
      startQ: 8,
      endQ: 9,
    });
  });

  it("never grows past the end of the grid", () => {
    expect(
      resizeSlotCursor({ startQ: 64, endQ: 66 }, 10, TOTAL_QUARTERS),
    ).toEqual({
      startQ: 64,
      endQ: TOTAL_QUARTERS,
    });
  });
});

describe("formatQuarterTime", () => {
  it("formats quarter hours as HH:MM", () => {
    expect(formatQuarterTime(0, START_HOUR)).toBe("06:00");
    expect(formatQuarterTime(6, START_HOUR)).toBe("07:30");
    expect(formatQuarterTime(68, START_HOUR)).toBe("23:00");
  });

  it("never produces a non-existent :60 minute", () => {
    // 15 min steps land on whole minutes, but the formatter must stay safe if
    // it is ever handed a fraction.
    expect(formatQuarterTime(0.99, START_HOUR)).toBe("06:15");
    expect(formatQuarterTime(1.999, START_HOUR)).toBe("06:30");
  });
});

describe("slotCursorToTimes", () => {
  it("gives the strings the create form expects", () => {
    expect(slotCursorToTimes({ startQ: 8, endQ: 12 }, START_HOUR)).toEqual({
      startTime: "08:00",
      endTime: "09:00",
    });
  });

  it("handles the last block of the day", () => {
    expect(
      slotCursorToTimes(
        { startQ: TOTAL_QUARTERS - 4, endQ: TOTAL_QUARTERS },
        START_HOUR,
      ),
    ).toEqual({ startTime: "22:00", endTime: "23:00" });
  });
});
