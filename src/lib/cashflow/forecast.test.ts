import { describe, expect, it } from "vitest";
import { type ForecastParams, forecastCashflow } from "./forecast";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Reference "now": Monday 2025-04-14 08:00 local */
const NOW = new Date(2025, 3, 14, 8, 0, 0); // Month is 0-indexed

function makeParams(overrides: Partial<ForecastParams> = {}): ForecastParams {
  return {
    now: NOW,
    outstandingInvoices: [],
    clientPaymentHistory: new Map(),
    userAvgPaymentDays: 14,
    activePrepaid: [],
    ...overrides,
  };
}

/** Add `days` calendar days to a Date. */
function addDays(d: Date, days: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + days);
  return result;
}

// ---------------------------------------------------------------------------
// Week assignment
// ---------------------------------------------------------------------------

describe("Invoice with dueDate in week 2 → appears in week 2", () => {
  // "now" is Monday 2025-04-14 → week 1: Apr 14–20, week 2: Apr 21–27
  const dueDate = new Date(2025, 3, 24); // Apr 24

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-1",
          invoiceNumber: "INV-001",
          amount: 10_000,
          dueDate,
          clientId: "client-1",
        },
      ],
    }),
  );

  it("total expected is 10000", () => {
    expect(result.totalExpected).toBe(10_000);
  });

  it("amount is in week 2 (index 1), not week 1", () => {
    expect(result.weeks[0].expectedAmount).toBe(0);
    expect(result.weeks[1].expectedAmount).toBe(10_000);
  });

  it("confidence is confirmed", () => {
    expect(result.weeks[1].breakdown.invoices[0].confidence).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// Invoice with dueDate in week 1
// ---------------------------------------------------------------------------

describe("Invoice with dueDate in week 1 → appears in week 1", () => {
  const dueDate = new Date(2025, 3, 16); // Apr 16 (same week as Apr 14)

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-2",
          invoiceNumber: "INV-002",
          amount: 5_000,
          dueDate,
          clientId: "client-1",
        },
      ],
    }),
  );

  it("amount is in week 1", () => {
    expect(result.weeks[0].expectedAmount).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Invoice without dueDate — uses client payment history (>= 3 samples)
// ---------------------------------------------------------------------------

describe("Invoice without dueDate → uses client-specific payment history", () => {
  // Client average: (10+12+14) / 3 = 12 days → paymentDate = now + 12 days
  // now + 12 = Apr 26 → week 2 (Apr 21–27)
  const history = new Map([["client-2", [10, 12, 14]]]);

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-3",
          invoiceNumber: "INV-003",
          amount: 8_000,
          dueDate: null,
          clientId: "client-2",
        },
      ],
      clientPaymentHistory: history,
      userAvgPaymentDays: 30, // should NOT be used
    }),
  );

  it("total expected is 8000", () => {
    expect(result.totalExpected).toBe(8_000);
  });

  it("confidence is estimated", () => {
    const allInvoices = result.weeks.flatMap((w) => w.breakdown.invoices);
    expect(allInvoices[0].confidence).toBe("estimated");
  });

  it("appears in week 2 (12 days out)", () => {
    // avg 12 days from Apr 14 = Apr 26 = week 2
    expect(result.weeks[1].expectedAmount).toBe(8_000);
  });
});

// ---------------------------------------------------------------------------
// Invoice without dueDate — insufficient client history → user-wide avg
// ---------------------------------------------------------------------------

describe("Invoice without dueDate + < 3 client samples → uses user-wide avg", () => {
  // User avg 7 days → now + 7 = Apr 21 → week 2 (Apr 21–27)
  const history = new Map([["client-3", [5, 9]]]); // only 2 samples

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-4",
          invoiceNumber: "INV-004",
          amount: 6_000,
          dueDate: null,
          clientId: "client-3",
        },
      ],
      clientPaymentHistory: history,
      userAvgPaymentDays: 7,
    }),
  );

  it("estimated using user avg (7 days)", () => {
    // 7 days from Apr 14 = Apr 21 → start of week 2
    const allInvoices = result.weeks.flatMap((w) => w.breakdown.invoices);
    expect(allInvoices.length).toBe(1);
    expect(allInvoices[0].confidence).toBe("estimated");
  });
});

// ---------------------------------------------------------------------------
// Invoice without dueDate — no history at all → fallback 14 days
// ---------------------------------------------------------------------------

describe("Invoice without dueDate + no history → fallback 14 days", () => {
  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-5",
          invoiceNumber: "INV-005",
          amount: 3_000,
          dueDate: null,
          clientId: "client-99",
        },
      ],
      clientPaymentHistory: new Map(),
      userAvgPaymentDays: 0, // trigger fallback
    }),
  );

  it("invoice is placed 14 days out", () => {
    // 14 days from Apr 14 = Apr 28 → week 3 (Apr 28 – May 4)
    expect(result.weeks[2].expectedAmount).toBe(3_000);
  });
});

// ---------------------------------------------------------------------------
// Overdue invoice → week 1 with overdueAmount
// ---------------------------------------------------------------------------

describe("Overdue invoice → counted in week 1 with overdueAmount flag", () => {
  const dueDate = new Date(2025, 3, 10); // Apr 10, before NOW (Apr 14)

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-6",
          invoiceNumber: "INV-006",
          amount: 12_500,
          dueDate,
          clientId: "client-1",
        },
      ],
    }),
  );

  it("total overdue is 12500", () => {
    expect(result.totalOverdue).toBe(12_500);
  });

  it("overdueAmount on week 1 is 12500", () => {
    expect(result.weeks[0].overdueAmount).toBe(12_500);
  });

  it("expectedAmount on week 1 includes overdue", () => {
    expect(result.weeks[0].expectedAmount).toBe(12_500);
  });

  it("confidence is confirmed (has an explicit dueDate)", () => {
    expect(result.weeks[0].breakdown.invoices[0].confidence).toBe("confirmed");
  });
});

// ---------------------------------------------------------------------------
// Invoice with dueDate beyond 30 days → excluded
// ---------------------------------------------------------------------------

describe("Invoice with dueDate > 30 days → excluded from forecast", () => {
  const dueDate = addDays(NOW, 35);

  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        {
          id: "inv-7",
          invoiceNumber: "INV-007",
          amount: 20_000,
          dueDate,
          clientId: "client-1",
        },
      ],
    }),
  );

  it("total expected is 0", () => {
    expect(result.totalExpected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Klippekort with 2h saldo + 8h/month burn → renewal ~7 days away (week 1–2)
// ---------------------------------------------------------------------------

describe("Klippekort: saldo 2h + burn 8h/month → renewal ~7 days out", () => {
  // 8h/month → 8/30 ≈ 0.2667 h/day; 2h / 0.2667 ≈ 7.5 days ≈ 8 days → week 2
  const historicalPackages = [
    {
      priceExVat: 15_000,
      purchasedAt: new Date(2025, 0, 1),
      hoursAtPurchase: 20,
    },
    {
      priceExVat: 15_000,
      purchasedAt: new Date(2025, 1, 1),
      hoursAtPurchase: 20,
    },
    {
      priceExVat: 16_000, // most recent
      purchasedAt: new Date(2025, 2, 1),
      hoursAtPurchase: 20,
    },
  ];

  const result = forecastCashflow(
    makeParams({
      activePrepaid: [
        {
          clientId: "client-kk",
          clientName: "Klient KK",
          currentSaldoHours: 2,
          historicalPackages,
          avgHoursPerMonth: 8,
        },
      ],
    }),
  );

  it("total expected includes klippekort renewal", () => {
    expect(result.totalExpected).toBeGreaterThan(0);
  });

  it("renewal uses price of most recent package (16000)", () => {
    const allRenewals = result.weeks.flatMap(
      (w) => w.breakdown.prepaidRenewals,
    );
    expect(allRenewals[0].estimatedAmount).toBe(16_000);
  });

  it("client name is correct", () => {
    const allRenewals = result.weeks.flatMap(
      (w) => w.breakdown.prepaidRenewals,
    );
    expect(allRenewals[0].clientName).toBe("Klient KK");
  });
});

// ---------------------------------------------------------------------------
// Klippekort with < 3 historical packages → skipped
// ---------------------------------------------------------------------------

describe("Klippekort with < 3 historical packages → no prediction", () => {
  const result = forecastCashflow(
    makeParams({
      activePrepaid: [
        {
          clientId: "client-sparse",
          clientName: "Sparse Client",
          currentSaldoHours: 1,
          historicalPackages: [
            {
              priceExVat: 10_000,
              purchasedAt: new Date(2025, 0, 1),
              hoursAtPurchase: 10,
            },
            {
              priceExVat: 10_000,
              purchasedAt: new Date(2025, 1, 1),
              hoursAtPurchase: 10,
            },
          ], // only 2 packages
          avgHoursPerMonth: 10,
        },
      ],
    }),
  );

  it("no renewals predicted", () => {
    const allRenewals = result.weeks.flatMap(
      (w) => w.breakdown.prepaidRenewals,
    );
    expect(allRenewals.length).toBe(0);
  });

  it("total expected is 0", () => {
    expect(result.totalExpected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Klippekort with saldo that won't run out within 30 days → skipped
// ---------------------------------------------------------------------------

describe("Klippekort: saldo 50h + burn 8h/month → more than 30 days → excluded", () => {
  const historicalPackages = Array.from({ length: 3 }, (_, i) => ({
    priceExVat: 10_000,
    purchasedAt: new Date(2025, i, 1),
    hoursAtPurchase: 20,
  }));

  const result = forecastCashflow(
    makeParams({
      activePrepaid: [
        {
          clientId: "client-plenty",
          clientName: "Plenty Client",
          currentSaldoHours: 50, // 50h / (8/30) ≈ 187 days
          historicalPackages,
          avgHoursPerMonth: 8,
        },
      ],
    }),
  );

  it("no renewal predicted", () => {
    expect(result.totalExpected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Klippekort with zero avgHoursPerMonth → skipped
// ---------------------------------------------------------------------------

describe("Klippekort: avgHoursPerMonth = 0 → skipped (no division by zero)", () => {
  const historicalPackages = Array.from({ length: 3 }, (_, i) => ({
    priceExVat: 10_000,
    purchasedAt: new Date(2025, i, 1),
    hoursAtPurchase: 20,
  }));

  const result = forecastCashflow(
    makeParams({
      activePrepaid: [
        {
          clientId: "client-zero",
          clientName: "Zero Client",
          currentSaldoHours: 5,
          historicalPackages,
          avgHoursPerMonth: 0,
        },
      ],
    }),
  );

  it("no renewal predicted", () => {
    expect(result.totalExpected).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Multiple invoices across weeks + overdue
// ---------------------------------------------------------------------------

describe("Mixed scenario: overdue + confirmed + estimated across weeks", () => {
  const result = forecastCashflow(
    makeParams({
      outstandingInvoices: [
        // Overdue
        {
          id: "ov-1",
          invoiceNumber: "INV-OV1",
          amount: 5_000,
          dueDate: new Date(2025, 3, 5), // Apr 5 — overdue
          clientId: "c1",
        },
        // Due in week 3 (Apr 28)
        {
          id: "w3-1",
          invoiceNumber: "INV-W3",
          amount: 7_500,
          dueDate: new Date(2025, 3, 28),
          clientId: "c2",
        },
        // No due date — client avg 21 days → week 3/4
        {
          id: "est-1",
          invoiceNumber: "INV-EST",
          amount: 4_000,
          dueDate: null,
          clientId: "c3",
        },
      ],
      clientPaymentHistory: new Map([["c3", [19, 21, 23]]]), // avg 21 days
    }),
  );

  it("totalOverdue is 5000", () => {
    expect(result.totalOverdue).toBe(5_000);
  });

  it("week 1 has 5000 (overdue)", () => {
    expect(result.weeks[0].expectedAmount).toBe(5_000);
    expect(result.weeks[0].overdueAmount).toBe(5_000);
  });

  it("week 3 has 7500 (confirmed INV-W3)", () => {
    expect(
      result.weeks[2].breakdown.invoices.some((i) => i.invoiceId === "w3-1"),
    ).toBe(true);
    expect(result.weeks[2].expectedAmount).toBeGreaterThanOrEqual(7_500);
  });

  it("totalExpected is sum of all items within 30 days", () => {
    // All three invoices should be within 30 days (Apr 14 + 30 = May 14)
    expect(result.totalExpected).toBe(5_000 + 7_500 + 4_000);
  });
});

// ---------------------------------------------------------------------------
// Empty inputs → zero totals
// ---------------------------------------------------------------------------

describe("No outstanding invoices or prepaid → all zeros", () => {
  const result = forecastCashflow(makeParams());

  it("totalExpected is 0", () => {
    expect(result.totalExpected).toBe(0);
  });

  it("totalOverdue is 0", () => {
    expect(result.totalOverdue).toBe(0);
  });

  it("produces 4 week buckets", () => {
    expect(result.weeks.length).toBe(4);
  });

  it("all week amounts are 0", () => {
    for (const week of result.weeks) {
      expect(week.expectedAmount).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Week number assignment correctness
// ---------------------------------------------------------------------------

describe("Week numbers are assigned correctly", () => {
  const result = forecastCashflow(makeParams());

  it("week 1 has a valid ISO week number", () => {
    expect(result.weeks[0].weekNumber).toBeGreaterThanOrEqual(1);
    expect(result.weeks[0].weekNumber).toBeLessThanOrEqual(53);
  });

  it("consecutive weeks have ascending week numbers (or wrap around year)", () => {
    for (let i = 0; i < 3; i++) {
      const curr = result.weeks[i].weekNumber;
      const next = result.weeks[i + 1].weekNumber;
      // Normal case: next = curr + 1; year-wrap: next = 1 and curr >= 52
      const isValid = next === curr + 1 || (next === 1 && curr >= 52);
      expect(isValid).toBe(true);
    }
  });
});
