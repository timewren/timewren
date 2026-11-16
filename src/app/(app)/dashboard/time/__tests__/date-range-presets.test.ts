import { describe, expect, it } from "vitest";
import { getDateRangeForPreset } from "../date-range-presets";

// Lokal middag, så testen giver samme kalenderdag under både TZ=UTC og
// TZ=Europe/Copenhagen.
const at = (y: number, m: number, d: number) => new Date(y, m - 1, d, 12);

describe("getDateRangeForPreset — ISO-uger (mandag–søndag)", () => {
  it("søndag: 'Denne uge' er ugen der slutter i dag, ikke næste uge", () => {
    expect(getDateRangeForPreset("thisWeek", at(2026, 10, 4))).toEqual({
      start: "2026-09-28",
      end: "2026-10-04",
    });
  });

  it("søndag: 'Sidste uge' er ugen før", () => {
    expect(getDateRangeForPreset("lastWeek", at(2026, 10, 4))).toEqual({
      start: "2026-09-21",
      end: "2026-09-27",
    });
  });

  it("mandag og midt i ugen giver samme uge", () => {
    const week = { start: "2026-09-28", end: "2026-10-04" };
    expect(getDateRangeForPreset("thisWeek", at(2026, 9, 28))).toEqual(week);
    expect(getDateRangeForPreset("thisWeek", at(2026, 10, 1))).toEqual(week);
    expect(getDateRangeForPreset("lastWeek", at(2026, 9, 28))).toEqual({
      start: "2026-09-21",
      end: "2026-09-27",
    });
  });

  it("uge hen over sommertidsskiftet 25/10", () => {
    expect(getDateRangeForPreset("thisWeek", at(2026, 10, 25))).toEqual({
      start: "2026-10-19",
      end: "2026-10-25",
    });
  });
});
