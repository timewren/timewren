import { renderToBuffer } from "@react-pdf/renderer";
import { and, desc, eq } from "drizzle-orm";
import { InvoicePDF } from "@/components/pdf/InvoicePDF";
import { db as defaultDb } from "@/lib/db";
import {
  companyProfiles,
  invoices,
  invoiceTemplates,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { DEMO_CURRENCY, demoCurrencyForEmail } from "@/lib/demo/demo-mode";
import { getOrgRegion } from "@/lib/org/region.server";

// Shared data-loading for invoice PDFs so the downloaded and the emailed PDF
// always render identically (VAT, logo, bank info, invoice lines). Both the
// REST routes and the tRPC sendEmail path build their props here.
export async function buildInvoicePdfProps({
  invoiceId,
  userId,
  orgId,
  clientId,
  db = defaultDb,
}: {
  invoiceId: string;
  userId: string;
  orgId: string | null;
  /** Extra scoping for portal access: the invoice must belong to this client */
  clientId?: string;
  /** A transaction that reads its own locked rows (provider exports). */
  db?: Pick<typeof defaultDb, "select" | "query">;
}) {
  const invoice = await db.query.invoices.findFirst({
    where: and(
      eq(invoices.id, invoiceId),
      orgId ? eq(invoices.organizationId, orgId) : eq(invoices.userId, userId),
      clientId ? eq(invoices.clientId, clientId) : undefined,
    ),
    with: {
      client: true,
      lines: true,
      timeEntries: {
        with: {
          project: true,
        },
        orderBy: [desc(timeEntries.date)],
      },
    },
  });

  if (!invoice) return null;

  // Normalize client (Drizzle may return array or single object)
  const client = Array.isArray(invoice.client)
    ? invoice.client[0]
    : invoice.client;
  if (!client) return null;

  const [user, companyProfile, defaultTemplate] = await Promise.all([
    db.query.users.findFirst({
      where: eq(users.id, userId),
    }),
    // The company profile follows the invoice's org (not the caller) so the
    // client sees the same sender identity regardless of which member sends.
    db.query.companyProfiles.findFirst({
      where: invoice.organizationId
        ? eq(companyProfiles.organizationId, invoice.organizationId)
        : eq(companyProfiles.userId, userId),
    }),
    db.query.invoiceTemplates.findFirst({
      // Fakturaens egen template foretraekkes (#201); ellers default
      where: and(
        invoice.organizationId
          ? eq(invoiceTemplates.organizationId, invoice.organizationId)
          : eq(invoiceTemplates.userId, userId),
        invoice.templateId
          ? eq(invoiceTemplates.id, invoice.templateId)
          : eq(invoiceTemplates.isDefault, true),
      ),
    }),
  ]);

  if (!user) return null;

  const sortedLines = invoice.lines
    ? [...invoice.lines].sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  // Kreditnota (#195): PDF'en skal utvetydigt referere originalfakturaen
  let relatedInvoiceNumber: string | null = null;
  if (invoice.kind === "credit_note" && invoice.relatedInvoiceId) {
    const related = await db.query.invoices.findFirst({
      where: eq(invoices.id, invoice.relatedInvoiceId),
      columns: { invoiceNumber: true },
    });
    relatedInvoiceNumber = related?.invoiceNumber ?? null;
  }

  const demoCurrency = demoCurrencyForEmail(user.email);
  // Uden for demoen: fakturaens organisations valuta (fund 19). DKK giver
  // undefined som før, så skabelonens valuta stadig gælder.
  const orgCurrency = (await getOrgRegion(db, invoice.organizationId)).currency;

  const pdfProps = {
    currency:
      demoCurrency === DEMO_CURRENCY
        ? demoCurrency
        : orgCurrency !== "DKK"
          ? orgCurrency
          : undefined,
    // Fakturaens sprog: afsenderens (der er intet kunde- eller organisationssprog
    // i datamodellen). InvoicePDF/InvoiceDocument oversætter efter dette sprog.
    locale: user.locale ?? undefined,
    invoice: {
      invoiceNumber: invoice.invoiceNumber,
      kind: invoice.kind,
      relatedInvoiceNumber,
      issueDate: invoice.issueDate,
      dueDate: invoice.dueDate,
      amount: invoice.amount,
      notes: invoice.notes,
      client: {
        name: client.name,
        email: client.email,
        company: client.company,
        address: client.address,
        city: client.city,
        postalCode: client.postalCode,
        country: client.country,
        cvrNumber: client.cvrNumber,
      },
      lines: sortedLines.map((line) => ({
        description: line.description,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        amount: line.amount,
        sortOrder: line.sortOrder,
      })),
      timeEntries: invoice.timeEntries?.map((entry) => {
        const project = Array.isArray(entry.project)
          ? entry.project[0]
          : entry.project;
        return {
          date: entry.date,
          description: entry.description,
          hours: entry.hours,
          billableRate: entry.billableRate,
          project: project ? { name: project.name } : null,
        };
      }),
    },
    user: {
      name: user.name,
      email: user.email,
    },
    companyProfile: companyProfile
      ? {
          name: companyProfile.name,
          cvrNumber: companyProfile.cvrNumber,
          email: companyProfile.email,
          phone: companyProfile.phone,
          address: companyProfile.address,
          postalCode: companyProfile.postalCode,
          city: companyProfile.city,
          country: companyProfile.country,
          bankRegNr: companyProfile.bankRegNr,
          bankAccountNr: companyProfile.bankAccountNr,
          vatRegistered: companyProfile.vatRegistered,
          vatNumber: companyProfile.vatNumber,
          logoUrl: companyProfile.logoUrl,
        }
      : null,
    template: defaultTemplate
      ? {
          headerText: defaultTemplate.headerText,
          footerText: defaultTemplate.footerText,
          termsText: defaultTemplate.termsText,
          bankName: defaultTemplate.bankName,
          bankAccount: defaultTemplate.bankAccount,
          bankRegNumber: defaultTemplate.bankRegNumber,
          logoUrl: defaultTemplate.logoUrl,
          primaryColor: defaultTemplate.primaryColor,
          vatRate: defaultTemplate.vatRate,
          currency: defaultTemplate.currency,
        }
      : null,
  };

  return { invoice, client, user, companyProfile, pdfProps };
}

export type InvoicePdfData = NonNullable<
  Awaited<ReturnType<typeof buildInvoicePdfProps>>
>;

/**
 * Pilot (#579): PDF_ENGINE=takumi renderer fakturaen på pdfcn/takumi (WASM,
 * indlejret Inter, sidetal). Alt andet — inkl. usat — bruger den gamle
 * @react-pdf-udgave, så prod kan slås tilbage uden deploy.
 */
export function invoicePdfEngine(): "react-pdf" | "takumi" {
  return process.env.PDF_ENGINE === "takumi" ? "takumi" : "react-pdf";
}

export async function renderInvoicePdfBuffer(
  pdfProps: InvoicePdfData["pdfProps"],
): Promise<Buffer> {
  if (invoicePdfEngine() === "takumi") {
    const { renderInvoicePdfTakumi } = await import("@/lib/pdf/render-invoice");
    return renderInvoicePdfTakumi(pdfProps);
  }
  return renderToBuffer(<InvoicePDF {...pdfProps} />);
}
