import { describe, expect, it } from "vitest";
import { EMPTY_TOTALS } from "../norm-period";
import {
  canAcknowledgeClosing,
  canApproveClosing,
  canRefreshClosing,
  canUnlockClosing,
  closingPeriodBounds,
  closingPeriodLabel,
  isClosingLocked,
  lockedDates,
  previousClosingPeriod,
  toClosingSummary,
} from "../period-closing";
import {
  autoLockBoundary,
  autoLockMessage,
  isAutoLocked,
} from "../timesheet-validation";

describe("afslutningsperioder", () => {
  it("måned og kalenderkvartal", () => {
    expect(closingPeriodBounds("month", "2026-10-02")).toEqual({
      start: "2026-10-01",
      end: "2026-10-31",
    });
    expect(closingPeriodBounds("quarter", "2026-10-02")).toEqual({
      start: "2026-10-01",
      end: "2026-12-31",
    });
  });

  it("senest afsluttede periode", () => {
    expect(previousClosingPeriod("month", "2026-10-02")).toEqual({
      start: "2026-09-01",
      end: "2026-09-30",
    });
    expect(previousClosingPeriod("quarter", "2026-10-01")).toEqual({
      start: "2026-07-01",
      end: "2026-09-30",
    });
    expect(previousClosingPeriod("quarter", "2026-01-01")).toEqual({
      start: "2025-10-01",
      end: "2025-12-31",
    });
  });

  it("etiketter", () => {
    expect(
      closingPeriodLabel("month", { start: "2026-09-01", end: "2026-09-30" }),
    ).toBe("september 2026");
    expect(
      closingPeriodLabel("quarter", { start: "2026-07-01", end: "2026-09-30" }),
    ).toBe("3. kvt. 2026");
  });
});

describe("status-overgange", () => {
  it("open/reopened kan godkendes og genberegnes; approved kvitteres", () => {
    expect(canApproveClosing("open")).toBe(true);
    expect(canApproveClosing("reopened")).toBe(true);
    expect(canApproveClosing("approved")).toBe(false);
    expect(canRefreshClosing("acknowledged")).toBe(false);
    expect(canAcknowledgeClosing("approved")).toBe(true);
    expect(canAcknowledgeClosing("open")).toBe(false);
  });

  it("godkendt og kvitteret er låst og kan låses op", () => {
    expect(isClosingLocked("approved")).toBe(true);
    expect(isClosingLocked("acknowledged")).toBe(true);
    expect(isClosingLocked("open")).toBe(false);
    expect(isClosingLocked("reopened")).toBe(false);
    expect(canUnlockClosing("acknowledged")).toBe(true);
    expect(canUnlockClosing("reopened")).toBe(false);
  });

  it("lockedDates finder kun datoer i låste perioder", () => {
    const closings = [
      {
        periodStart: "2026-09-01",
        periodEnd: "2026-09-30",
        status: "approved",
      },
      {
        periodStart: "2026-08-01",
        periodEnd: "2026-08-31",
        status: "reopened",
      },
    ];
    expect(
      lockedDates(["2026-08-31", "2026-09-01", "2026-10-01"], closings),
    ).toEqual(["2026-09-01"]);
  });

  it("opgørelsen bærer registreret, norm, flex og fravær", () => {
    const s = toClosingSummary(
      { ...EMPTY_TOTALS, registered: 150, net: 148, flex: 2, vacationDays: 3 },
      5.5,
      new Date("2026-10-01T04:45:00Z"),
    );
    expect(s).toMatchObject({
      registered: 150,
      net: 148,
      flex: 2,
      vacationDays: 3,
      flexBalance: 5.5,
      computedAt: "2026-10-01T04:45:00.000Z",
    });
  });
});

describe("auto-lås på fast ugedag", () => {
  // Lokale datoer — samme konvention som den rullende lås
  const wed = new Date(2026, 8, 30); // onsdag 30/9-2026
  const tue = new Date(2026, 8, 29);
  const sun = new Date(2026, 9, 4);

  it("fra onsdag er forrige uge låst", () => {
    expect(autoLockBoundary(wed, 3)).toEqual(new Date(2026, 8, 28));
    expect(isAutoLocked("2026-09-27", wed, 3)).toBe(true);
    expect(isAutoLocked("2026-09-28", wed, 3)).toBe(false);
  });

  it("før onsdag er forrige uge stadig åben", () => {
    expect(autoLockBoundary(tue, 3)).toEqual(new Date(2026, 8, 21));
    expect(isAutoLocked("2026-09-25", tue, 3)).toBe(false);
    expect(isAutoLocked("2026-09-20", tue, 3)).toBe(true);
  });

  it("søndag regnes som dag 7", () => {
    expect(autoLockBoundary(sun, 3)).toEqual(new Date(2026, 8, 28));
    expect(autoLockBoundary(sun, 7)).toEqual(new Date(2026, 8, 28));
  });

  it("ingen eller ugyldig ugedag = ingen lås", () => {
    expect(autoLockBoundary(wed, null)).toBeNull();
    expect(autoLockBoundary(wed, 0)).toBeNull();
    expect(isAutoLocked("2020-01-01", wed, undefined)).toBe(false);
    expect(autoLockMessage(3)).toContain("onsdag");
  });
});
