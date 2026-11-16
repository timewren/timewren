/**
 * Renderer fixture-fakturaer og -rapporter til PDF på alle eksisterende
 * stier (react-pdf og takumi), så før/efter kan sammenlignes.
 *
 *   PDF_PREVIEW_OUT=<mappe> npx vitest run --config scripts/brand/vitest.preview.config.ts pdf
 *
 * Alle data er opdigtede. compare-pdfs.py udtrækker beløb og linjer og
 * tjekker at de er identiske før og efter.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { renderToBuffer } from "@react-pdf/renderer";
import { describe, it } from "vitest";
import { InvoicePDF } from "@/components/pdf/InvoicePDF";
import { EnterpriseReportPDF } from "@/lib/enterprise/reporting/pdf";
import type { ReportTable } from "@/lib/enterprise/reporting/render";
import { renderInvoicePdfTakumi } from "@/lib/pdf/render-invoice";
import type { ReportEntry } from "@/lib/reports/columns";
import { reportTemplateConfigSchema } from "@/lib/reports/config-schema";
import { ReportPDF } from "@/lib/reports/generators/pdf/ReportPDF";

const OUT = process.env.PDF_PREVIEW_OUT ?? "pdf-preview-out";

// PDF_NO_NETWORK=1: bevis at ingen motor henter fonte over nettet.
if (process.env.PDF_NO_NETWORK === "1") {
  globalThis.fetch = (async (input: unknown) => {
    throw new Error(`Netværk forbudt under PDF-render: ${String(input)}`);
  }) as typeof fetch;
}

type InvoiceProps = Parameters<typeof InvoicePDF>[0];

const company = {
  name: "Eksempel Design ApS",
  cvrNumber: "12345678",
  email: "faktura@example.com",
  phone: "+45 12 34 56 78",
  address: "Eksempelvej 1",
  postalCode: "8000",
  city: "Aarhus C",
  country: "Danmark",
  bankRegNr: "1234",
  bankAccountNr: "0001234567",
  vatRegistered: true,
  vatNumber: null,
  logoUrl: null,
};

const client = {
  name: "Bageriet på hjørnet",
  email: "kunde@example.com",
  company: "Bageriet på hjørnet ApS",
  address: "Testgade 2",
  city: "Odense C",
  postalCode: "5000",
  country: "Danmark",
  cvrNumber: "87654321",
};

const template = (over: Partial<NonNullable<InvoiceProps["template"]>>) => ({
  headerText: null,
  footerText: null,
  termsText: null,
  bankName: "Eksempelbanken",
  bankAccount: null,
  bankRegNumber: null,
  logoUrl: null,
  primaryColor: null,
  vatRate: "25.00",
  currency: "DKK",
  ...over,
});

const user = { name: "Mette Eksempel", email: "mette@example.com" };

const INVOICE_FIXTURES: { id: string; props: InvoiceProps }[] = [
  {
    // Linjer, moms, ingen gemt farve (default brandfarve)
    id: "faktura-linjer-moms",
    props: {
      invoice: {
        invoiceNumber: "2026-0042",
        issueDate: "2026-10-01",
        dueDate: "2026-10-15",
        amount: "8125.00",
        notes: "Tak for samarbejdet i september.",
        client,
        lines: [
          {
            description: "Design af forside",
            quantity: "6.5",
            unitPrice: "650.00",
            amount: "4225.00",
            sortOrder: 0,
          },
          {
            description: "Klippekort 10 t (Bageriet, oktober)",
            quantity: "1",
            unitPrice: "3250.00",
            amount: "3250.00",
            sortOrder: 1,
          },
          {
            description: "Hosting, 1 md.",
            quantity: "1",
            unitPrice: "650.00",
            amount: "650.00",
            sortOrder: 2,
          },
        ],
      },
      user,
      companyProfile: company,
      template: template({}),
    },
  },
  {
    // Tidsregistreringer, ingen moms, intet forfald
    id: "faktura-tid-uden-moms",
    props: {
      invoice: {
        invoiceNumber: "2026-0043",
        issueDate: "2026-10-02",
        dueDate: null,
        amount: "2762.50",
        notes: null,
        client: { ...client, company: null, cvrNumber: null },
        timeEntries: [
          {
            date: "2026-09-22",
            description: "Møde om ny menu",
            hours: "1.25",
            billableRate: "650.00",
            project: { name: "Menukort" },
          },
          {
            date: "2026-09-24",
            description: null,
            hours: "3.00",
            billableRate: "650.00",
            project: null,
          },
        ],
      },
      user,
      companyProfile: { ...company, vatRegistered: false },
      template: null,
    },
  },
  {
    // Kreditnota med henvisning
    id: "kreditnota",
    props: {
      invoice: {
        invoiceNumber: "2026-0044",
        kind: "credit_note",
        relatedInvoiceNumber: "2026-0042",
        issueDate: "2026-10-05",
        dueDate: "2026-10-05",
        amount: "-650.00",
        notes: "Kreditering af hosting.",
        client,
        lines: [
          {
            description: "Hosting, 1 md. (krediteret)",
            quantity: "-1",
            unitPrice: "650.00",
            amount: "-650.00",
            sortOrder: 0,
          },
        ],
      },
      user,
      companyProfile: company,
      template: template({}),
    },
  },
  {
    // Kundens egen gemte farve og egen sidefod skal bevares
    id: "faktura-kundefarve",
    props: {
      invoice: {
        invoiceNumber: "2026-0045",
        issueDate: "2026-10-06",
        dueDate: "2026-10-20",
        amount: "1300.00",
        notes: null,
        client,
        lines: [
          {
            description: "Support",
            quantity: "2",
            unitPrice: "650.00",
            amount: "1300.00",
            sortOrder: 0,
          },
        ],
      },
      user,
      companyProfile: company,
      template: template({
        primaryColor: "#3b82f6",
        footerText: "Betaling til konto 1234 0001234567 senest 14 dage netto.",
        termsText: "Ved for sen betaling opkræves rente efter renteloven.",
        vatRate: "25.00",
      }),
    },
  },
];

function entry(
  id: string,
  day: string,
  hours: string,
  description: string,
  project: string,
): ReportEntry {
  const date = new Date(`${day}T08:00:00Z`);
  const h = Number.parseFloat(hours);
  return {
    id,
    date,
    startTime: date,
    endTime: new Date(date.getTime() + h * 3_600_000),
    hours,
    billableRate: "650.00",
    description,
    isBilled: false,
    isBillable: true,
    isPrepaid: false,
    clientDefaultBillable: true,
    isFromTemplate: false,
    source: "timer",
    approvalStatus: null,
    segments: [],
    _rounded: h,
    _value: h * 650,
    client: { id: "c1", name: "Bageriet på hjørnet" },
    project: {
      id: `p-${project}`,
      name: project,
      client: { id: "c1", name: "Bageriet på hjørnet" },
      monthlyBudgetHours: null,
    },
    prepaidPackage: null,
    tags: [],
    task: null,
    member: null,
  };
}

const entries = [
  entry("e1", "2026-09-22", "1.25", "Møde om ny menu", "Menukort"),
  entry("e2", "2026-09-24", "3.00", "Skitser", "Menukort"),
  entry("e3", "2026-09-29", "2.50", "Forside", "Hjemmeside"),
];

const reportConfig = (primaryColor?: string) =>
  reportTemplateConfigSchema.parse({
    filters: {},
    grouping: "project",
    columns: ["date", "project", "description", "hours", "rate", "value"],
    branding: {
      title: "Tidsrapport september",
      ...(primaryColor ? { primaryColor } : {}),
    },
  });

const aggregates = {
  summary: {
    totalHours: 6.75,
    totalRevenue: 4387.5,
    billedHours: 0,
    billedRevenue: 0,
    unbilledHours: 6.75,
    unbilledRevenue: 4387.5,
    entriesCount: 3,
  },
  groups: [
    {
      key: "p-Menukort",
      label: "Menukort",
      hours: 4.25,
      revenue: 2762.5,
      entries: entries.slice(0, 2),
      budget: null,
    },
    {
      key: "p-Hjemmeside",
      label: "Hjemmeside",
      hours: 2.5,
      revenue: 1625,
      entries: entries.slice(2),
      budget: null,
    },
  ],
  groupingNote: null,
  pauses: null,
};

const enterpriseTable: ReportTable = {
  columns: [
    { id: "employee", key: "employee", label: "Medarbejder", format: "text" },
    { id: "project", key: "project", label: "Projekt", format: "text" },
    { id: "hours", key: "hours", label: "Timer", format: "hours" },
  ] as ReportTable["columns"],
  rows: [
    { cells: ["Medarbejder A", "Menukort", 12.5] },
    { cells: ["Medarbejder A", "Hjemmeside", 4] },
    { cells: ["Medarbejder A", "", 16.5], subtotal: true, groupSize: 2 },
    { cells: ["Medarbejder B", "Menukort", 7.25] },
  ],
  totals: ["I alt", "", 23.75],
};

function save(name: string, buf: Buffer | Uint8Array) {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, name), buf);
}

/** En fejlende render skrives som .error.txt i stedet for at stoppe resten. */
async function saveOrError(name: string, render: () => Promise<Buffer>) {
  try {
    save(name, await render());
  } catch (err) {
    save(`${name}.error.txt`, Buffer.from(String(err), "utf8"));
  }
}

describe("pdf-previews", () => {
  it("fakturaer på begge motorer", async () => {
    for (const { id, props } of INVOICE_FIXTURES) {
      save(
        `${id}.react-pdf.pdf`,
        await renderToBuffer(<InvoicePDF {...props} />),
      );
      save(`${id}.takumi.pdf`, await renderInvoicePdfTakumi(props));
    }
  });

  it("rapporter", async () => {
    const common = {
      aggregates,
      entries,
      startDate: "01.09.2026",
      endDate: "30.09.2026",
      logoUrl: null,
      companyName: "Eksempel Design ApS",
    };
    await saveOrError("rapport-standard.react-pdf.pdf", () =>
      renderToBuffer(<ReportPDF config={reportConfig()} {...common} />),
    );
    await saveOrError("rapport-kundefarve.react-pdf.pdf", () =>
      renderToBuffer(
        <ReportPDF config={reportConfig("#7c3aed")} {...common} />,
      ),
    );
    await saveOrError("rapport-enterprise.react-pdf.pdf", () =>
      renderToBuffer(
        <EnterpriseReportPDF
          title="Timer pr. medarbejder"
          orgName="Eksempel Bureau ApS"
          period="september 2026"
          table={enterpriseTable}
        />,
      ),
    );
  });
});
