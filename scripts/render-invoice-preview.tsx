/**
 * Renderer en prøvefaktura med begge PDF-motorer, så de kan sammenlignes
 * side om side før PDF_ENGINE=takumi slås til i prod.
 *
 *   npx tsx scripts/render-invoice-preview.tsx [output-dir]
 *
 * Ingen database, ingen afsendelse.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { InvoicePDF } from "@/components/pdf/InvoicePDF";
import { renderInvoicePdfTakumi } from "@/lib/pdf/render-invoice";

const outDir = process.argv[2] ?? join(process.cwd(), ".email-previews");
mkdirSync(outDir, { recursive: true });

const props: Parameters<typeof InvoicePDF>[0] = {
  invoice: {
    invoiceNumber: "2026-0142",
    kind: "invoice",
    relatedInvoiceNumber: null,
    issueDate: "2026-09-16",
    dueDate: "2026-10-01",
    amount: "23250.00",
    notes: "Timer for september ifølge aftale. Tak for samarbejdet — æøå ÆØÅ.",
    client: {
      name: "Eksempel Børn ApS",
      email: "bogholderi@example.dk",
      company: null,
      address: "Nørregade 12, 2. th",
      city: "Aarhus C",
      postalCode: "8000",
      country: "Danmark",
      cvrNumber: "12345678",
    },
    lines: Array.from({ length: 28 }, (_, i) => ({
      description:
        i % 3 === 0
          ? `SEO-rådgivning og søgeordsanalyse, uge ${36 + (i % 4)}`
          : i % 3 === 1
            ? "Webudvikling: landingsside og formularer"
            : "Statusmøde og afrapportering",
      quantity: `${(i % 4) + 1}.00`,
      unitPrice: "850.00",
      amount: `${((i % 4) + 1) * 850}.00`,
      sortOrder: i,
    })),
    timeEntries: [],
  },
  user: { name: "Anders Eksempel", email: "bruger@example.dk" },
  companyProfile: {
    name: "Eksempel ApS",
    cvrNumber: "87654321",
    email: "faktura@example.dk",
    phone: "+45 12 34 56 78",
    address: "Søndergade 4",
    postalCode: "8000",
    city: "Aarhus C",
    country: "Danmark",
    bankRegNr: "1234",
    bankAccountNr: "0012345678",
    vatRegistered: true,
    vatNumber: null,
    logoUrl: null,
  },
  template: {
    headerText: null,
    footerText: null,
    termsText:
      "Betalingsbetingelser: netto 14 dage. Ved for sen betaling tillægges rente jf. renteloven.",
    bankName: "Danske Bank",
    bankAccount: null,
    bankRegNumber: null,
    logoUrl: null,
    primaryColor: "#2563eb",
    vatRate: "25.00",
    currency: "DKK",
  },
};

async function main() {
  const t0 = Date.now();
  const legacy = await renderToBuffer(<InvoicePDF {...props} />);
  const t1 = Date.now();
  writeFileSync(join(outDir, "faktura-react-pdf.pdf"), legacy);
  const takumi = await renderInvoicePdfTakumi({
    ...props,
    paymentUrl: "https://app.timetrack.dk/pay/eksempel",
  });
  const t2 = Date.now();
  writeFileSync(join(outDir, "faktura-takumi.pdf"), takumi);
  console.log(
    JSON.stringify({
      reactPdf: { bytes: legacy.length, ms: t1 - t0 },
      takumi: { bytes: takumi.length, ms: t2 - t1 },
    }),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
