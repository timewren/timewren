import { describe, expect, it } from "vitest";
import {
  computeVatOverview,
  daysUntilDeadline,
  formatDanishDate,
  getNextDeadlineForPeriod,
  getQuarterDeadline,
  getVatPeriodForDate,
  getVatQuarter,
  VAT_RATE,
} from "./compute";

// -------------------------------------------------------------------------
// Helper: build a fake invoice
// -------------------------------------------------------------------------
function inv(isoDate: string, amountExVat: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  return { issueDate: new Date(year, month - 1, day), amountExVat };
}

// -------------------------------------------------------------------------
// getVatQuarter
// -------------------------------------------------------------------------
describe("getVatQuarter", () => {
  it("January → Q1", () => {
    const q = getVatQuarter(new Date(2026, 0, 1));
    expect(q.quarter).toBe(1);
    expect(q.label).toBe("Q1 2026");
    expect(q.from).toBe("2026-01-01");
    expect(q.to).toBe("2026-03-31");
  });

  it("March 31 → Q1", () => {
    const q = getVatQuarter(new Date(2026, 2, 31));
    expect(q.quarter).toBe(1);
  });

  it("April 1 → Q2", () => {
    const q = getVatQuarter(new Date(2026, 3, 1));
    expect(q.quarter).toBe(2);
    expect(q.label).toBe("Q2 2026");
    expect(q.from).toBe("2026-04-01");
    expect(q.to).toBe("2026-06-30");
  });

  it("June 30 → Q2", () => {
    const q = getVatQuarter(new Date(2026, 5, 30));
    expect(q.quarter).toBe(2);
  });

  it("July 1 → Q3", () => {
    const q = getVatQuarter(new Date(2026, 6, 1));
    expect(q.quarter).toBe(3);
    expect(q.label).toBe("Q3 2026");
    expect(q.from).toBe("2026-07-01");
    expect(q.to).toBe("2026-09-30");
  });

  it("October 1 → Q4", () => {
    const q = getVatQuarter(new Date(2026, 9, 1));
    expect(q.quarter).toBe(4);
    expect(q.label).toBe("Q4 2026");
    expect(q.from).toBe("2026-10-01");
    expect(q.to).toBe("2026-12-31");
  });

  it("December 31 → Q4", () => {
    const q = getVatQuarter(new Date(2026, 11, 31));
    expect(q.quarter).toBe(4);
  });
});

// -------------------------------------------------------------------------
// getQuarterDeadline
// -------------------------------------------------------------------------
describe("getQuarterDeadline", () => {
  it("Q1 deadline is 20. april same year", () => {
    const q = getVatQuarter(new Date(2026, 0, 15));
    const d = getQuarterDeadline(q);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // april (0-indexed)
    expect(d.getDate()).toBe(20);
  });

  it("Q2 deadline is 20. juli same year", () => {
    const q = getVatQuarter(new Date(2026, 4, 1));
    const d = getQuarterDeadline(q);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(6); // july (0-indexed)
    expect(d.getDate()).toBe(20);
  });

  it("Q3 deadline is 20. oktober same year", () => {
    const q = getVatQuarter(new Date(2026, 7, 1));
    const d = getQuarterDeadline(q);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(9); // october (0-indexed)
    expect(d.getDate()).toBe(20);
  });

  it("Q4 deadline is 20. januar NEXT year", () => {
    const q = getVatQuarter(new Date(2026, 10, 1));
    const d = getQuarterDeadline(q);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0); // january (0-indexed)
    expect(d.getDate()).toBe(20);
  });
});

// -------------------------------------------------------------------------
// daysUntilDeadline
// -------------------------------------------------------------------------
describe("daysUntilDeadline", () => {
  it("returns 0 when today IS the deadline", () => {
    const today = new Date(2026, 3, 20); // 20. april 2026
    const deadline = new Date(2026, 3, 20);
    expect(daysUntilDeadline(today, deadline)).toBe(0);
  });

  it("returns positive when deadline is in the future", () => {
    const today = new Date(2026, 3, 1); // 1. april
    const deadline = new Date(2026, 3, 20); // 20. april
    expect(daysUntilDeadline(today, deadline)).toBe(19);
  });

  it("returns negative when deadline is past", () => {
    const today = new Date(2026, 3, 21); // 21. april
    const deadline = new Date(2026, 3, 20); // 20. april
    expect(daysUntilDeadline(today, deadline)).toBe(-1);
  });

  it("handles year boundary (Q4 deadline in next year)", () => {
    const today = new Date(2026, 11, 31); // 31. december 2026
    const deadline = new Date(2027, 0, 20); // 20. januar 2027
    expect(daysUntilDeadline(today, deadline)).toBe(20);
  });
});

// -------------------------------------------------------------------------
// computeVatOverview — happy path
// -------------------------------------------------------------------------
describe("computeVatOverview — Q2 2026", () => {
  // Today is 19. april 2026, so we're in Q2 (april-jun)
  const today = new Date(2026, 3, 19); // 19. april 2026

  const invoices = [
    // Q1 2026 invoices (should count in YTD but NOT in current period)
    inv("2026-01-15", 10_000),
    inv("2026-03-31", 5_000),
    // Q2 2026 invoices (should count in both YTD and current period)
    inv("2026-04-01", 20_000),
    inv("2026-04-19", 8_000),
    // Last year — should NOT count in YTD
    inv("2025-12-31", 100_000),
  ];

  const result = computeVatOverview({ invoices, today });

  it("ytdInvoicedExVat includes Q1 + Q2 invoices only", () => {
    // 10000 + 5000 + 20000 + 8000 = 43000
    expect(result.ytdInvoicedExVat).toBe(43_000);
  });

  it("ytdVat is 25% of YTD invoiced", () => {
    expect(result.ytdVat).toBe(10_750);
  });

  it("currentPeriod label is Q2 2026", () => {
    expect(result.currentPeriod.label).toBe("Q2 2026");
  });

  it("currentPeriod.invoicedExVat is Q2 invoices only", () => {
    // 20000 + 8000 = 28000
    expect(result.currentPeriod.invoicedExVat).toBe(28_000);
  });

  it("currentPeriod.vat is 25% of period invoiced", () => {
    expect(result.currentPeriod.vat).toBe(7_000);
  });

  it("currentPeriod.from is 2026-04-01", () => {
    expect(result.currentPeriod.from).toBe("2026-04-01");
  });

  it("currentPeriod.to is 2026-06-30", () => {
    expect(result.currentPeriod.to).toBe("2026-06-30");
  });

  it("nextDeadline.daysUntil is 92 (Q2 deadline is 20. juli, today is 19. april)", () => {
    // Q2 runs April-June, deadline is 20. juli 2026
    // April 19 → July 20 = 92 days
    expect(result.nextDeadline.daysUntil).toBe(92);
  });

  it("nextDeadline.periodLabel is Q2 2026", () => {
    expect(result.nextDeadline.periodLabel).toBe("Q2 2026");
  });

  it("recommendedSavings equals currentPeriod.vat", () => {
    expect(result.recommendedSavings).toBe(result.currentPeriod.vat);
  });
});

// -------------------------------------------------------------------------
// computeVatOverview — Q4 2026 (year-boundary deadline)
// -------------------------------------------------------------------------
describe("computeVatOverview — Q4 2026 year boundary", () => {
  const today = new Date(2026, 11, 1); // 1. december 2026

  const invoices = [
    inv("2026-10-15", 50_000),
    inv("2026-11-30", 30_000),
    // Q3 same year — YTD yes, current period no
    inv("2026-09-30", 10_000),
  ];

  const result = computeVatOverview({ invoices, today });

  it("currentPeriod label is Q4 2026", () => {
    expect(result.currentPeriod.label).toBe("Q4 2026");
  });

  it("nextDeadline is in 2027 (20. januar)", () => {
    expect(result.nextDeadline.label).toContain("2027");
    expect(result.nextDeadline.label).toContain("januar");
  });

  it("ytdVat includes Q1-Q4 invoices", () => {
    // 50000 + 30000 + 10000 = 90000 YTD, VAT = 22500
    expect(result.ytdVat).toBe(22_500);
  });

  it("currentPeriod.vat is Q4 only", () => {
    // 50000 + 30000 = 80000, VAT = 20000
    expect(result.currentPeriod.vat).toBe(20_000);
  });
});

// -------------------------------------------------------------------------
// computeVatOverview — empty state
// -------------------------------------------------------------------------
describe("computeVatOverview — no invoices", () => {
  const today = new Date(2026, 3, 19);
  const result = computeVatOverview({ invoices: [], today });

  it("ytdInvoicedExVat is 0", () => {
    expect(result.ytdInvoicedExVat).toBe(0);
  });

  it("ytdVat is 0", () => {
    expect(result.ytdVat).toBe(0);
  });

  it("currentPeriod.vat is 0", () => {
    expect(result.currentPeriod.vat).toBe(0);
  });

  it("recommendedSavings is 0", () => {
    expect(result.recommendedSavings).toBe(0);
  });
});

// -------------------------------------------------------------------------
// formatDanishDate
// -------------------------------------------------------------------------
describe("formatDanishDate", () => {
  it("formats a date in Danish long format", () => {
    const d = new Date(2026, 6, 20); // 20. juli 2026
    const formatted = formatDanishDate(d);
    // The string should include the year and "juli"
    expect(formatted).toContain("2026");
    expect(formatted).toContain("juli");
    expect(formatted).toContain("20");
  });

  it("formats Q4 deadline (20. januar 2027)", () => {
    const d = new Date(2027, 0, 20);
    const formatted = formatDanishDate(d);
    expect(formatted).toContain("2027");
    expect(formatted).toContain("januar");
  });
});

// -------------------------------------------------------------------------
// VAT_RATE constant
// -------------------------------------------------------------------------
describe("VAT_RATE", () => {
  it("is 0.25 (25%)", () => {
    expect(VAT_RATE).toBe(0.25);
  });
});

// =========================================================================
// New multi-period API
// =========================================================================

describe("getVatPeriodForDate — monthly", () => {
  it("15. april → April 2026", () => {
    const p = getVatPeriodForDate(new Date(2026, 3, 15), "monthly");
    expect(p.kind).toBe("monthly");
    expect(p.label).toBe("April 2026");
    expect(p.from).toBe("2026-04-01");
    expect(p.to).toBe("2026-04-30");
    expect(p.ordinal).toBe(4);
  });

  it("31. december → December 2026 ends on last day", () => {
    const p = getVatPeriodForDate(new Date(2026, 11, 31), "monthly");
    expect(p.from).toBe("2026-12-01");
    expect(p.to).toBe("2026-12-31");
  });

  it("leap-year February ends on 29th in 2028", () => {
    const p = getVatPeriodForDate(new Date(2028, 1, 10), "monthly");
    expect(p.to).toBe("2028-02-29");
  });
});

describe("getVatPeriodForDate — semi_annual", () => {
  it("15. mars → H1 2026", () => {
    const p = getVatPeriodForDate(new Date(2026, 2, 15), "semi_annual");
    expect(p.label).toBe("H1 2026");
    expect(p.from).toBe("2026-01-01");
    expect(p.to).toBe("2026-06-30");
    expect(p.ordinal).toBe(1);
  });

  it("1. juli → H2 2026", () => {
    const p = getVatPeriodForDate(new Date(2026, 6, 1), "semi_annual");
    expect(p.label).toBe("H2 2026");
    expect(p.from).toBe("2026-07-01");
    expect(p.to).toBe("2026-12-31");
    expect(p.ordinal).toBe(2);
  });
});

describe("getNextDeadlineForPeriod — monthly", () => {
  it("April period → 25. maj", () => {
    const p = getVatPeriodForDate(new Date(2026, 3, 15), "monthly");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(4); // May
    expect(d.getDate()).toBe(25);
  });

  it("December period → 25. januar next year", () => {
    const p = getVatPeriodForDate(new Date(2026, 11, 10), "monthly");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0); // January
    expect(d.getDate()).toBe(25);
  });
});

describe("getNextDeadlineForPeriod — quarterly (matches legacy)", () => {
  it("Q1 → 20. april same year", () => {
    const p = getVatPeriodForDate(new Date(2026, 1, 1), "quarterly");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(20);
  });

  it("Q4 → 20. januar next year", () => {
    const p = getVatPeriodForDate(new Date(2026, 10, 15), "quarterly");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(20);
  });
});

describe("getNextDeadlineForPeriod — semi_annual", () => {
  it("H1 → 1. september same year", () => {
    const p = getVatPeriodForDate(new Date(2026, 2, 15), "semi_annual");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(8); // September
    expect(d.getDate()).toBe(1);
  });

  it("H2 → 1. marts next year", () => {
    const p = getVatPeriodForDate(new Date(2026, 8, 15), "semi_annual");
    const d = getNextDeadlineForPeriod(p);
    expect(d.getFullYear()).toBe(2027);
    expect(d.getMonth()).toBe(2); // March
    expect(d.getDate()).toBe(1);
  });
});

describe("computeVatOverview — respects vatPeriod", () => {
  const invoices = [
    { issueDate: new Date(2026, 3, 10), amountExVat: 10000 }, // April
    { issueDate: new Date(2026, 4, 5), amountExVat: 5000 }, // May
  ];

  it("monthly: April period includes only April invoice", () => {
    const result = computeVatOverview({
      invoices,
      today: new Date(2026, 3, 20),
      vatPeriod: "monthly",
    });
    expect(result.periodKind).toBe("monthly");
    expect(result.currentPeriod.label).toBe("April 2026");
    expect(result.currentPeriod.invoicedExVat).toBe(10000);
    expect(result.currentPeriod.vat).toBe(2500);
    expect(result.nextDeadline.label).toBe("25. maj 2026");
  });

  it("quarterly: Q2 period includes both invoices", () => {
    const result = computeVatOverview({
      invoices,
      today: new Date(2026, 3, 20),
      vatPeriod: "quarterly",
    });
    expect(result.periodKind).toBe("quarterly");
    expect(result.currentPeriod.label).toBe("Q2 2026");
    expect(result.currentPeriod.invoicedExVat).toBe(15000);
    expect(result.currentPeriod.vat).toBe(3750);
  });

  it("semi_annual: H1 period includes both invoices", () => {
    const result = computeVatOverview({
      invoices,
      today: new Date(2026, 3, 20),
      vatPeriod: "semi_annual",
    });
    expect(result.periodKind).toBe("semi_annual");
    expect(result.currentPeriod.label).toBe("H1 2026");
    expect(result.currentPeriod.invoicedExVat).toBe(15000);
    expect(result.nextDeadline.label).toBe("1. september 2026");
  });

  it("defaults to quarterly when vatPeriod is not supplied", () => {
    const result = computeVatOverview({
      invoices,
      today: new Date(2026, 3, 20),
    });
    expect(result.periodKind).toBe("quarterly");
    expect(result.currentPeriod.label).toBe("Q2 2026");
  });
});
