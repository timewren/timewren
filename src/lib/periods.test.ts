import { describe, expect, it } from "vitest";
import {
  percentChange,
  periodStart,
  periodStartUtc,
  previousPeriodRange,
  previousPeriodRangeUtc,
} from "./periods";

/** Lokal dato uden tidszone-overraskelser i testen. */
const at = (y: number, m: number, d: number, h = 12) =>
  new Date(y, m - 1, d, h, 0, 0, 0);

describe("periodStart", () => {
  it("uge starter mandag — også når 'nu' er søndag", () => {
    // Søndag 13. september 2026 → mandag den 7.
    expect(periodStart("week", at(2026, 9, 13))).toEqual(at(2026, 9, 7, 0));
    // Mandag 7. september → samme dag
    expect(periodStart("week", at(2026, 9, 7))).toEqual(at(2026, 9, 7, 0));
  });

  it("måned, kvartal og år starter korrekt", () => {
    expect(periodStart("month", at(2026, 9, 8))).toEqual(at(2026, 9, 1, 0));
    expect(periodStart("quarter", at(2026, 9, 8))).toEqual(at(2026, 7, 1, 0));
    expect(periodStart("quarter", at(2026, 2, 8))).toEqual(at(2026, 1, 1, 0));
    expect(periodStart("year", at(2026, 9, 8))).toEqual(at(2026, 1, 1, 0));
  });

  it("'alt' har ingen nedre grænse", () => {
    expect(periodStart("all", at(2026, 9, 8))).toBeNull();
  });
});

describe("previousPeriodRange", () => {
  it("forrige måned løber fra 1. i forrige måned til 1. i denne", () => {
    const r = previousPeriodRange("month", at(2026, 9, 8));
    expect(r?.from).toEqual(at(2026, 8, 1, 0));
    expect(r?.to).toEqual(at(2026, 9, 1, 0));
  });

  it("krydser årsskifte korrekt", () => {
    const r = previousPeriodRange("month", at(2026, 1, 15));
    expect(r?.from).toEqual(at(2025, 12, 1, 0));
    expect(r?.to).toEqual(at(2026, 1, 1, 0));
  });

  it("forrige uge er de syv dage før denne uges mandag", () => {
    const r = previousPeriodRange("week", at(2026, 9, 8));
    expect(r?.from).toEqual(at(2026, 8, 31, 0));
    expect(r?.to).toEqual(at(2026, 9, 7, 0));
  });

  it("'alt' har ingen forrige periode", () => {
    expect(previousPeriodRange("all", at(2026, 9, 8))).toBeNull();
  });
});

describe("percentChange", () => {
  it("regner stigning og fald", () => {
    expect(percentChange(120, 100)).toBe(20);
    expect(percentChange(80, 100)).toBe(-20);
    expect(percentChange(100, 100)).toBe(0);
  });

  it("er null når der ikke er noget at sammenligne med", () => {
    // Uden timer i forrige periode er "+∞ %" meningsløst
    expect(percentChange(50, 0)).toBeNull();
    expect(percentChange(0, 0)).toBeNull();
  });
});

describe("periodStartUtc / previousPeriodRangeUtc", () => {
  it("bruger UTC-grænser uafhængigt af serverens tidszone", () => {
    const now = new Date(Date.UTC(2026, 8, 8, 12));
    expect(periodStartUtc("month", now)?.toISOString()).toBe(
      "2026-09-01T00:00:00.000Z",
    );
    expect(periodStartUtc("quarter", now)?.toISOString()).toBe(
      "2026-07-01T00:00:00.000Z",
    );
    expect(periodStartUtc("year", now)?.toISOString()).toBe(
      "2026-01-01T00:00:00.000Z",
    );
    // Søndag 13/9 hører til ugen der starter mandag 7/9
    expect(
      periodStartUtc(
        "week",
        new Date(Date.UTC(2026, 8, 13, 12)),
      )?.toISOString(),
    ).toBe("2026-09-07T00:00:00.000Z");
    expect(periodStartUtc("all", now)).toBeNull();
  });

  it("bruger dansk dato: 00:30 dansk tid den 1. er den nye måned (#649)", () => {
    // 1/10-2026 00:30 CEST = 30/9 22:30Z
    const now = new Date("2026-09-30T22:30:00Z");
    expect(periodStartUtc("month", now)?.toISOString()).toBe(
      "2026-10-01T00:00:00.000Z",
    );
    const prev = previousPeriodRangeUtc("month", now);
    expect(prev?.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(prev?.to.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    // Mandag 28/9 00:30 CEST = søndag 27/9 22:30Z → ugen starter 28/9
    expect(
      periodStartUtc("week", new Date("2026-09-27T22:30:00Z"))?.toISOString(),
    ).toBe("2026-09-28T00:00:00.000Z");
  });

  it("forrige periode i UTC krydser årsskifte", () => {
    const r = previousPeriodRangeUtc("month", new Date(Date.UTC(2026, 0, 15)));
    expect(r?.from.toISOString()).toBe("2025-12-01T00:00:00.000Z");
    expect(r?.to.toISOString()).toBe("2026-01-01T00:00:00.000Z");
  });
});
