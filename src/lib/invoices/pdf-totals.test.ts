import { describe, expect, it } from "vitest";
import { invoicePdfTotals } from "./pdf-totals";

describe("invoicePdfTotals", () => {
  it("lægger moms på linjernes sum, når virksomheden er momsregistreret", () => {
    const t = invoicePdfTotals({
      // Beløbet afviger bevidst fra linjerne: linjerne vinder.
      invoice: { amount: "999", lines: [{ amount: "600" }, { amount: "400" }] },
      companyProfile: { vatRegistered: true },
      template: { vatRate: "25.00", currency: "EUR" },
    });
    expect(t).toEqual({
      currency: "EUR",
      vatRate: 25,
      showVat: true,
      subtotal: 1000,
      vatAmount: 250,
      total: 1250,
    });
  });

  it("ingen moms uden momsregistrering; fakturaens beløb uden linjer", () => {
    const t = invoicePdfTotals({
      invoice: { amount: "850.50", lines: [] },
      companyProfile: { vatRegistered: false },
      template: { vatRate: "12.50", currency: null },
    });
    expect(t.showVat).toBe(false);
    expect(t.subtotal).toBe(850.5);
    expect(t.vatAmount).toBe(0);
    expect(t.total).toBe(850.5);
    expect(t.currency).toBe("DKK");
  });

  it("skabelonens sats; 25 % og DKK uden skabelon; kontoens valuta vinder", () => {
    expect(
      invoicePdfTotals({
        invoice: { amount: "100" },
        companyProfile: { vatRegistered: true },
        template: { vatRate: "12.50", currency: "SEK" },
      }).vatAmount,
    ).toBe(12.5);
    const none = invoicePdfTotals({
      invoice: { amount: "100" },
      companyProfile: { vatRegistered: true },
      template: null,
      currency: "USD",
    });
    expect(none.vatRate).toBe(25);
    expect(none.total).toBe(125);
    expect(none.currency).toBe("USD");
  });
});
