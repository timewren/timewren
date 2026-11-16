import { describe, expect, it } from "vitest";
import {
  anchorDayOf,
  fixedLinesTotal,
  nextRunDate,
  periodForRun,
  renderPeriodText,
  rollForwardRunDate,
  shiftRunDate,
  upcomingRunDates,
} from "../schedule";

// Ren kalender-aritmetik på "yyyy-MM-dd" — skal give samme svar under
// TZ=UTC (prod) og TZ=Europe/Copenhagen (udvikling, CI).

describe("nextRunDate (#198)", () => {
  it("månedlig fra den 31.: 31/1 → 28/2 → 31/3 (dagen glider ikke)", () => {
    const anchor = anchorDayOf("2026-01-31");
    expect(anchor).toBe(31);
    expect(upcomingRunDates("2026-01-31", "monthly", anchor, 4)).toEqual([
      "2026-01-31",
      "2026-02-28",
      "2026-03-31",
      "2026-04-30",
    ]);
  });

  it("skudår: 31/1-2028 → 29/2-2028", () => {
    expect(nextRunDate("2028-01-31", "monthly", 31)).toBe("2028-02-29");
  });

  it("kvartal: 31/1 → 30/4 → 31/7", () => {
    expect(upcomingRunDates("2026-01-31", "quarterly", 31, 3)).toEqual([
      "2026-01-31",
      "2026-04-30",
      "2026-07-31",
    ]);
  });

  it("år: 29/2-2028 → 28/2-2029 → 28/2-2030 → 29/2-2032 via anker", () => {
    expect(upcomingRunDates("2028-02-29", "yearly", 29, 3)).toEqual([
      "2028-02-29",
      "2029-02-28",
      "2030-02-28",
    ]);
    expect(shiftRunDate("2028-02-29", "yearly", 29, 4)).toBe("2032-02-29");
  });

  it("over årsskiftet", () => {
    expect(nextRunDate("2026-12-15", "monthly", 15)).toBe("2027-01-15");
    expect(nextRunDate("2026-11-30", "quarterly", 30)).toBe("2027-02-28");
  });

  it("bagud: shiftRunDate med negative trin", () => {
    expect(shiftRunDate("2026-03-31", "monthly", 31, -1)).toBe("2026-02-28");
    expect(shiftRunDate("2026-01-15", "quarterly", 15, -1)).toBe("2025-10-15");
  });
});

describe("periodForRun", () => {
  it("fast beløb forudbetales: perioden starter på kørselsdatoen", () => {
    expect(periodForRun("2026-01-31", "monthly", 31, "fixed")).toEqual({
      start: "2026-01-31",
      end: "2026-02-27",
    });
    expect(periodForRun("2026-10-01", "monthly", 1, "fixed")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
  });

  it("registreret tid faktureres bagud: perioden slutter dagen før", () => {
    expect(periodForRun("2026-11-01", "monthly", 1, "time")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(periodForRun("2027-01-01", "quarterly", 1, "time")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("perioderne støder op til hinanden uden huller eller overlap", () => {
    const runs = upcomingRunDates("2026-01-31", "monthly", 31, 6);
    for (let i = 0; i < runs.length - 1; i++) {
      const a = periodForRun(runs[i], "monthly", 31, "fixed");
      const b = periodForRun(runs[i + 1], "monthly", 31, "fixed");
      expect(b.start > a.end).toBe(true);
      // b.start er dagen efter a.end
      expect(new Date(`${b.start}T00:00:00Z`).getTime()).toBe(
        new Date(`${a.end}T00:00:00Z`).getTime() + 86_400_000,
      );
    }
  });
});

describe("rollForwardRunDate", () => {
  it("springer perioder i en pause over", () => {
    expect(rollForwardRunDate("2026-06-30", "monthly", 30, "2026-10-02")).toBe(
      "2026-10-30",
    );
  });

  it("dato i dag eller frem røres ikke", () => {
    expect(rollForwardRunDate("2026-10-02", "monthly", 2, "2026-10-02")).toBe(
      "2026-10-02",
    );
    expect(rollForwardRunDate("2026-12-01", "monthly", 1, "2026-10-02")).toBe(
      "2026-12-01",
    );
  });
});

describe("renderPeriodText", () => {
  const period = { start: "2026-10-01", end: "2026-10-31" };

  it("udfylder periodevariablerne", () => {
    expect(renderPeriodText("Teknisk partner, periode {periode}", period)).toBe(
      "Teknisk partner, periode 01.10.2026–31.10.2026",
    );
    expect(renderPeriodText("{periode_start} til {periode_slut}", period)).toBe(
      "01.10.2026 til 31.10.2026",
    );
    expect(renderPeriodText("Vedligehold {måned}", period)).toBe(
      "Vedligehold oktober 2026",
    );
    expect(renderPeriodText("Licens {år}", period)).toBe("Licens 2026");
  });

  it("lader ukendte krøllede parenteser stå", () => {
    expect(renderPeriodText("Pris {ukendt}", period)).toBe("Pris {ukendt}");
  });
});

describe("fixedLinesTotal", () => {
  it("summerer antal × pris med øre-afrunding", () => {
    expect(
      fixedLinesTotal([
        { description: "Retainer", quantity: "1", unitPrice: "15000" },
        { description: "Hosting", quantity: "3", unitPrice: "33.333" },
      ]),
    ).toBe(15100);
  });
});
