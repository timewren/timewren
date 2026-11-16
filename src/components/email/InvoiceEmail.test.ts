import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { InvoiceEmail } from "./InvoiceEmail";

const base = {
  invoiceNumber: "2026-0042",
  clientName: "Kunde",
  dueDate: "2026-10-25T00:00:00.000Z",
  senderName: "Afsender",
  senderEmail: "a@example.com",
};

async function text(amount: string) {
  return render(createElement(InvoiceEmail, { ...base, amount }), {
    plainText: true,
  });
}

describe("InvoiceEmail beløb", () => {
  // Begge kaldere (invoices-routeren og /api/invoices/[id]/send) sender
  // invoice.amount direkte fra en numeric-kolonne: "8125.00".
  it("formaterer databasens rå beløb dansk", async () => {
    expect(await text("8125.00")).toContain("8.125,00 kr.");
    expect(await text("1250.5")).toContain("1.250,50 kr.");
    expect(await text("-650.00")).toContain("-650,00 kr.");
  });

  it("lader et allerede dansk formateret beløb stå og tilføjer kun enheden", async () => {
    expect(await text("8.125,00")).toContain("8.125,00 kr.");
  });
});
