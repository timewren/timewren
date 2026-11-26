import { describe, expect, it } from "vitest";
import { invoicePdfTotals } from "./pdf-totals";
import {
  invoiceSendReview,
  matchesInvoiceReview,
  type ReviewedInvoice,
  reviewedInvoiceSchema,
} from "./send-review";

function pdfData({
  lines = [{ amount: "800" }, { amount: "200.5" }],
  timeEntries = [] as unknown[],
  vatRegistered = true as boolean | null,
  vatRate = "25.00",
  currency = undefined as string | undefined,
} = {}) {
  return {
    invoice: { invoiceNumber: "1001" },
    pdfProps: {
      currency,
      invoice: { amount: "999", lines, timeEntries },
      companyProfile: { vatRegistered },
      template: { vatRate, currency: "DKK" },
    },
  } as never;
}

describe("invoiceSendReview", () => {
  it("takes the total incl. VAT from invoicePdfTotals, as the PDF shows it", () => {
    const data = pdfData();
    const review = invoiceSendReview(data, "anna@example.com");
    // 1.000,50 + 25 % moms
    expect(review.total).toBeCloseTo(1250.625);
    expect(review.total).toBe(
      invoicePdfTotals((data as { pdfProps: never }).pdfProps).total,
    );
    expect(review).toMatchObject({
      invoiceNumber: "1001",
      currency: "DKK",
      lineCount: 2,
    });
  });

  it("leaves VAT out when the company is not VAT registered", () => {
    expect(
      invoiceSendReview(pdfData({ vatRegistered: false }), "a@b.dk").total,
    ).toBeCloseTo(1000.5);
  });

  it("uses the invoice amount and counts the time entries without lines", () => {
    const review = invoiceSendReview(
      pdfData({ lines: [], timeEntries: [{}, {}, {}], vatRegistered: false }),
      "a@b.dk",
    );
    expect(review.total).toBe(999);
    expect(review.lineCount).toBe(3);
  });

  it("follows the account currency over the template's", () => {
    expect(
      invoiceSendReview(pdfData({ currency: "EUR" }), "a@b.dk").currency,
    ).toBe("EUR");
  });

  it("normalizes the recipient", () => {
    expect(invoiceSendReview(pdfData(), " Anna@Example.com ").recipient).toBe(
      "anna@example.com",
    );
  });
});

describe("matchesInvoiceReview", () => {
  const actual: ReviewedInvoice = {
    invoiceNumber: "1001",
    total: 1250.625,
    currency: "DKK",
    lineCount: 2,
    recipient: "anna@example.com",
  };

  it("matches the same invoice, rounding the total to øre", () => {
    expect(matchesInvoiceReview({ ...actual, total: 1250.63 }, actual)).toBe(
      true,
    );
    expect(
      matchesInvoiceReview(
        { ...actual, recipient: "ANNA@example.com" },
        actual,
      ),
    ).toBe(true);
  });

  it.each([
    ["number", { invoiceNumber: "1002" }],
    ["total", { total: 1250.5 }],
    ["currency", { currency: "EUR" }],
    ["line count", { lineCount: 3 }],
    ["recipient", { recipient: "bo@example.com" }],
  ])("rejects a changed %s", (_, changed) => {
    expect(matchesInvoiceReview({ ...actual, ...changed }, actual)).toBe(false);
  });

  it("requires every reviewed field from the client", () => {
    expect(
      reviewedInvoiceSchema.safeParse({ total: 1, currency: "DKK" }).success,
    ).toBe(false);
    expect(reviewedInvoiceSchema.safeParse(actual).success).toBe(true);
  });
});
