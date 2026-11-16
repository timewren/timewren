import { describe, expect, it } from "vitest";
import * as popupMath from "../popup/utils/calendar-math";
import * as sharedMath from "./calendar-math";

describe.each([
  ["popup", popupMath],
  ["ny fane", sharedMath],
])("calendar-math (%s): hele døgnet", (_name, math) => {
  it("poster før 06 og efter 22 får hver deres plads", () => {
    const early = math.blockToMinutes(
      new Date(2026, 9, 26, 5, 0),
      new Date(2026, 9, 26, 5, 30),
    );
    const late = math.blockToMinutes(
      new Date(2026, 9, 26, 22, 30),
      new Date(2026, 9, 26, 23, 30),
    );
    expect(math.minutesToPercent(early.startMin)).toBeLessThan(
      math.minutesToPercent(early.endMin),
    );
    expect(math.minutesToPercent(late.startMin)).toBeLessThan(
      math.minutesToPercent(late.endMin),
    );
    expect(math.minutesToPercent(late.endMin)).toBeLessThan(100);
  });

  it("en post over midnat vises til midnat", () => {
    const { startMin, endMin } = math.blockToMinutes(
      new Date(2026, 9, 26, 23, 0),
      new Date(2026, 9, 27, 1, 0),
    );
    expect(startMin).toBe(23 * 60);
    expect(endMin).toBe(24 * 60);
    expect(math.minutesToPercent(endMin)).toBe(100);
  });

  it("midnat som sluttid er næste dags 00:00", () => {
    const end = math.minutesToDate(new Date(2026, 9, 26), 24 * 60);
    expect(end.getDate()).toBe(27);
    expect(end.getHours()).toBe(0);
  });
});

describe("formatMinutesOfDay", () => {
  it("skriver minutter efter midnat som HH:MM, 24:00 ved døgnets slutning", () => {
    expect(sharedMath.formatMinutesOfDay(0)).toBe("00:00");
    expect(sharedMath.formatMinutesOfDay(9 * 60 + 5)).toBe("09:05");
    expect(sharedMath.formatMinutesOfDay(24 * 60)).toBe("24:00");
  });
});

describe("newEntrySlot", () => {
  it("i dag: den seneste hele time op til nu (afrundet ned til 15 min)", () => {
    const now = new Date(2026, 9, 15, 14, 52);
    const slot = sharedMath.newEntrySlot(new Date(2026, 9, 15), now);
    expect(slot.startMinutes).toBe(13 * 60 + 45);
    expect(slot.endMinutes).toBe(14 * 60 + 45);
    expect(sharedMath.toLocalDateStr(slot.date)).toBe("2026-10-15");
  });

  it("lige efter midnat starter den ikke før 00:00", () => {
    const now = new Date(2026, 9, 15, 0, 20);
    const slot = sharedMath.newEntrySlot(new Date(2026, 9, 15), now);
    expect(slot.startMinutes).toBe(0);
    expect(slot.endMinutes).toBe(60);
  });

  it("en anden dag end i dag: 09:00 til 10:00 på den dag", () => {
    const now = new Date(2026, 9, 15, 14, 52);
    const slot = sharedMath.newEntrySlot(new Date(2026, 9, 12), now);
    expect(slot.startMinutes).toBe(9 * 60);
    expect(slot.endMinutes).toBe(10 * 60);
    expect(sharedMath.toLocalDateStr(slot.date)).toBe("2026-10-12");
  });
});
