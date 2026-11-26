import {
  Document,
  Image,
  Page,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import { pdfText } from "@/components/pdf/pdf-text";
import { BRAND_LIGHT, DEFAULT_INVOICE_PRIMARY_COLOR } from "@/lib/brand/tokens";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { invoicePdfTotals } from "@/lib/invoices/pdf-totals";
import { TT_IKON_PNG_DATA_URI } from "@/lib/pdf/brand-icon";
import { registerPdfFonts } from "@/lib/pdf/react-pdf-fonts";

const FONT = registerPdfFonts();
const T = BRAND_LIGHT;

interface CompanyProfile {
  name: string;
  cvrNumber: string | null;
  email: string;
  phone: string | null;
  address: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  bankRegNr: string | null;
  bankAccountNr: string | null;
  vatRegistered: boolean | null;
  vatNumber: string | null;
  logoUrl: string | null;
}

interface InvoiceTemplate {
  headerText: string | null;
  footerText: string | null;
  termsText: string | null;
  bankName: string | null;
  bankAccount: string | null;
  bankRegNumber: string | null;
  logoUrl: string | null;
  primaryColor: string | null;
  vatRate: string | null;
  currency: string | null;
}

interface InvoiceLine {
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
  sortOrder: number;
}

interface InvoicePDFProps {
  invoice: {
    invoiceNumber: string;
    kind?: string;
    relatedInvoiceNumber?: string | null;
    issueDate: Date | string;
    dueDate: Date | string | null;
    amount: string;
    notes: string | null;
    client: {
      name: string;
      email: string | null;
      company: string | null;
      address: string | null;
      city: string | null;
      postalCode: string | null;
      country: string | null;
      cvrNumber: string | null;
    };
    lines?: InvoiceLine[];
    timeEntries?: Array<{
      date: Date | string;
      description: string | null;
      hours: string;
      billableRate: string | null;
      project?: {
        name: string;
      } | null;
    }>;
  };
  user: {
    name: string;
    email: string;
  };
  companyProfile?: CompanyProfile | null;
  template?: InvoiceTemplate | null;
  /** Sprog til fakturaens tekster (standard: dansk). */
  locale?: string;
  currency?: string;
}

export function InvoicePDF({
  invoice,
  user,
  companyProfile,
  template,
  locale,
  currency: accountCurrency,
}: InvoicePDFProps) {
  const { t, intlLocale } = pdfText(locale);
  // Kundens egen farve respekteres altid; ellers brandets default.
  const primaryColor = template?.primaryColor || DEFAULT_INVOICE_PRIMARY_COLOR;
  const { currency, vatRate, showVat, subtotal, vatAmount, total } =
    invoicePdfTotals({
      invoice,
      companyProfile,
      template,
      currency: accountCurrency,
    });
  const hasLines = invoice.lines && invoice.lines.length > 0;
  const hasTimeEntries = invoice.timeEntries && invoice.timeEntries.length > 0;
  const logoUrl = template?.logoUrl || companyProfile?.logoUrl;

  // Bank info priority: template → companyProfile
  const bankName = template?.bankName || null;
  const bankRegNr =
    template?.bankRegNumber || companyProfile?.bankRegNr || null;
  const bankAccountNr =
    template?.bankAccount || companyProfile?.bankAccountNr || null;
  const hasBankInfo = bankRegNr && bankAccountNr;

  const formatDate = (date: Date | string | null) => {
    if (!date) return t("notSpecified");
    return new Date(date).toLocaleDateString(intlLocale, {
      timeZone: "Europe/Copenhagen",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const formatCurrency = (value: string | number) => {
    const numValue =
      typeof value === "string" ? Number.parseFloat(value) : value;
    return numValue.toLocaleString(intlLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  };

  const styles = createStyles(primaryColor);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        {/* Header with logo and title */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            {logoUrl && <Image src={logoUrl} style={styles.logo} />}
            <Text style={styles.companyName}>
              {companyProfile?.name || user.name}
            </Text>
          </View>
          <View style={styles.headerRight}>
            <Text style={styles.title}>
              {invoice.kind === "credit_note" ? t("creditNote") : t("invoice")}
            </Text>
            <Text style={styles.invoiceNumber}>
              {formatInvoiceNumber(invoice.invoiceNumber, t("draft"))}
            </Text>
          </View>
        </View>

        {/* Invoice meta details */}
        <View style={styles.metaSection}>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>
              {invoice.kind === "credit_note"
                ? t("creditNoteNoColon")
                : t("invoiceNoColon")}
            </Text>
            <Text style={styles.metaValue}>
              {formatInvoiceNumber(invoice.invoiceNumber, t("draft"))}
            </Text>
          </View>
          {invoice.kind === "credit_note" && invoice.relatedInvoiceNumber ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{t("creditOfColon")}</Text>
              <Text style={styles.metaValue}>
                {invoice.relatedInvoiceNumber}
              </Text>
            </View>
          ) : null}
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("issuedColon")}</Text>
            <Text style={styles.metaValue}>
              {formatDate(invoice.issueDate)}
            </Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaLabel}>{t("dueColon")}</Text>
            <Text style={styles.metaValue}>{formatDate(invoice.dueDate)}</Text>
          </View>
          {template?.headerText && (
            <Text style={styles.headerText}>{template.headerText}</Text>
          )}
        </View>

        {/* From / To */}
        <View style={styles.parties}>
          {/* From */}
          <View style={styles.partyColumn}>
            <Text style={styles.partyLabel}>{t("from")}</Text>
            <Text style={[styles.text, styles.bold]}>
              {companyProfile?.name || user.name}
            </Text>
            {companyProfile?.address && (
              <Text style={styles.text}>{companyProfile.address}</Text>
            )}
            {(companyProfile?.postalCode || companyProfile?.city) && (
              <Text style={styles.text}>
                {companyProfile.postalCode} {companyProfile.city}
              </Text>
            )}
            {companyProfile?.country &&
              companyProfile.country !== "Danmark" && (
                <Text style={styles.text}>{companyProfile.country}</Text>
              )}
            {(companyProfile?.cvrNumber || companyProfile?.vatNumber) && (
              <Text style={styles.text}>
                {t("vatId", {
                  number:
                    companyProfile.cvrNumber || companyProfile.vatNumber || "",
                })}
              </Text>
            )}
            <Text style={styles.text}>
              {companyProfile?.email || user.email}
            </Text>
            {companyProfile?.phone && (
              <Text style={styles.text}>{companyProfile.phone}</Text>
            )}
          </View>

          {/* To */}
          <View style={styles.partyColumn}>
            <Text style={styles.partyLabel}>{t("to")}</Text>
            <Text style={[styles.text, styles.bold]}>
              {invoice.client.name}
            </Text>
            {invoice.client.company && (
              <Text style={styles.text}>{invoice.client.company}</Text>
            )}
            {invoice.client.address && (
              <Text style={styles.text}>{invoice.client.address}</Text>
            )}
            {(invoice.client.postalCode || invoice.client.city) && (
              <Text style={styles.text}>
                {invoice.client.postalCode} {invoice.client.city}
              </Text>
            )}
            {invoice.client.country && invoice.client.country !== "Danmark" && (
              <Text style={styles.text}>{invoice.client.country}</Text>
            )}
            {invoice.client.cvrNumber && (
              <Text style={styles.text}>
                {t("vatId", { number: invoice.client.cvrNumber })}
              </Text>
            )}
            {invoice.client.email && (
              <Text style={styles.text}>{invoice.client.email}</Text>
            )}
          </View>
        </View>

        {/* Invoice Lines Table (primary) */}
        {hasLines && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.lineCol1}>{t("description")}</Text>
              <Text style={styles.lineCol2}>{t("quantity")}</Text>
              <Text style={styles.lineCol3}>{t("unitPrice")}</Text>
              <Text style={styles.lineCol4}>{t("amount")}</Text>
            </View>
            {invoice.lines?.map((line, index) => (
              <View
                // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                key={`line-${line.sortOrder}-${index}`}
                style={[
                  styles.tableRow,
                  ...(index % 2 === 1 ? [styles.tableRowAlt] : []),
                ]}
              >
                <Text style={styles.lineCol1}>{line.description}</Text>
                <Text style={styles.lineCol2}>
                  {formatCurrency(line.quantity)}
                </Text>
                <Text style={styles.lineCol3}>
                  {formatCurrency(line.unitPrice)}
                </Text>
                <Text style={styles.lineCol4}>
                  {formatCurrency(line.amount)}
                </Text>
              </View>
            ))}
          </View>
        )}

        {/* Fallback: Time Entries Table */}
        {!hasLines && hasTimeEntries && (
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              <Text style={styles.teCol1}>{t("date")}</Text>
              <Text style={styles.teCol2}>{t("description")}</Text>
              <Text style={styles.teCol3}>{t("hours")}</Text>
              <Text style={styles.teCol4}>{t("hourlyRate")}</Text>
              <Text style={styles.teCol5}>{t("amount")}</Text>
            </View>
            {invoice.timeEntries?.map((entry, index) => {
              const hours = Number.parseFloat(entry.hours);
              const rate = Number.parseFloat(entry.billableRate || "0");
              const amount = hours * rate;
              return (
                <View
                  // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                  key={`te-${entry.date}-${index}`}
                  style={[
                    styles.tableRow,
                    ...(index % 2 === 1 ? [styles.tableRowAlt] : []),
                  ]}
                >
                  <Text style={styles.teCol1}>{formatDate(entry.date)}</Text>
                  <Text style={styles.teCol2}>
                    {entry.description || t("noDescription")}
                    {entry.project && ` (${entry.project.name})`}
                  </Text>
                  <Text style={styles.teCol3}>{entry.hours}</Text>
                  <Text style={styles.teCol4}>{formatCurrency(rate)}</Text>
                  <Text style={styles.teCol5}>{formatCurrency(amount)}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Totals */}
        <View style={styles.totalSection}>
          {showVat && (
            <>
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>{t("subtotal")}</Text>
                <Text style={styles.subtotalValue}>
                  {formatCurrency(subtotal)} {currency}
                </Text>
              </View>
              <View style={styles.subtotalRow}>
                <Text style={styles.subtotalLabel}>
                  {t("vatCompact", { rate: vatRate })}
                </Text>
                <Text style={styles.subtotalValue}>
                  {formatCurrency(vatAmount)} {currency}
                </Text>
              </View>
            </>
          )}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>{t("total")}</Text>
            <Text style={styles.totalValue}>
              {formatCurrency(total)} {currency}
            </Text>
          </View>
        </View>

        {/* Notes */}
        {invoice.notes && (
          <View style={styles.notesSection}>
            <Text style={styles.sectionLabel}>{t("notes")}</Text>
            <Text style={styles.text}>{invoice.notes}</Text>
          </View>
        )}

        {/* Bank / Payment Info */}
        {hasBankInfo && (
          <View style={styles.bankSection}>
            <Text style={styles.sectionLabel}>{t("paymentDetails")}</Text>
            {bankName && (
              <Text style={styles.text}>{t("bank", { name: bankName })}</Text>
            )}
            <Text style={styles.text}>
              {t("regAccountCompact", {
                reg: bankRegNr,
                account: bankAccountNr,
              })}
            </Text>
          </View>
        )}

        {/* Footer */}
        <View style={styles.footer}>
          {template?.termsText && (
            <Text style={styles.footerText}>{template.termsText}</Text>
          )}
          {template?.footerText ? (
            <Text style={styles.footerText}>{template.footerText}</Text>
          ) : (
            <>
              <Text style={styles.footerText}>
                {t("payByCompact", { date: formatDate(invoice.dueDate) })}
              </Text>
              <Text style={styles.footerText}>{t("terms")}</Text>
            </>
          )}
          <View style={styles.generatedBy}>
            <Image src={TT_IKON_PNG_DATA_URI} style={styles.generatedIcon} />
            <Text style={styles.footerText}>{t("generatedBy")}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}

function createStyles(primaryColor: string) {
  return StyleSheet.create({
    page: {
      padding: 40,
      fontFamily: FONT,
      fontSize: 10,
      color: T.blaek,
    },
    // Header
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "flex-start",
      marginBottom: 24,
    },
    headerLeft: {
      flexDirection: "column",
      gap: 6,
    },
    headerRight: {
      alignItems: "flex-end",
    },
    logo: {
      width: 80,
      height: 80,
      objectFit: "contain",
      marginBottom: 6,
    },
    companyName: {
      fontSize: 14,
      fontWeight: 700,
      color: T.blaek,
    },
    title: {
      fontSize: 28,
      fontWeight: 700,
      color: primaryColor,
    },
    invoiceNumber: {
      fontSize: 12,
      color: T.graa,
      marginTop: 2,
    },
    // Meta section
    metaSection: {
      backgroundColor: T.flade,
      padding: 14,
      borderRadius: 4,
      marginBottom: 20,
    },
    metaRow: {
      flexDirection: "row",
      marginBottom: 4,
    },
    metaLabel: {
      fontSize: 10,
      color: T.graa,
      width: 80,
    },
    metaValue: {
      fontSize: 10,
      fontWeight: 700,
    },
    headerText: {
      fontSize: 10,
      color: T.blaek,
      marginTop: 8,
      fontStyle: "italic",
    },
    // From / To
    parties: {
      flexDirection: "row",
      justifyContent: "space-between",
      marginBottom: 24,
    },
    partyColumn: {
      flex: 1,
    },
    partyLabel: {
      fontSize: 9,
      color: primaryColor,
      marginBottom: 6,
      fontWeight: 700,
    },
    text: {
      fontSize: 10,
      marginBottom: 2,
    },
    bold: {
      fontWeight: 700,
    },
    // Table (shared)
    table: {
      marginBottom: 20,
    },
    tableHeader: {
      flexDirection: "row",
      backgroundColor: primaryColor,
      padding: 10,
      color: T.paaGran,
      fontWeight: 700,
      fontSize: 9,
    },
    tableRow: {
      flexDirection: "row",
      borderBottomWidth: 1,
      borderBottomColor: T.streg,
      padding: 10,
      fontSize: 9,
    },
    tableRowAlt: {
      backgroundColor: T.flade,
    },
    // Invoice Lines columns (4 col)
    lineCol1: { width: "45%" },
    lineCol2: { width: "15%", textAlign: "right" },
    lineCol3: { width: "20%", textAlign: "right" },
    lineCol4: { width: "20%", textAlign: "right" },
    // Time Entries columns (5 col)
    teCol1: { width: "15%" },
    teCol2: { width: "35%" },
    teCol3: { width: "15%", textAlign: "right" },
    teCol4: { width: "15%", textAlign: "right" },
    teCol5: { width: "20%", textAlign: "right" },
    // Totals
    totalSection: {
      alignItems: "flex-end",
      marginBottom: 20,
    },
    subtotalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: 250,
      paddingVertical: 4,
    },
    subtotalLabel: {
      fontSize: 10,
      color: T.graa,
    },
    subtotalValue: {
      fontSize: 10,
      fontWeight: 700,
    },
    totalRow: {
      flexDirection: "row",
      justifyContent: "space-between",
      width: 250,
      paddingVertical: 8,
      borderTopWidth: 2,
      borderTopColor: primaryColor,
    },
    totalLabel: {
      fontSize: 14,
      fontWeight: 700,
    },
    totalValue: {
      fontSize: 16,
      fontWeight: 700,
      color: primaryColor,
    },
    // Notes
    notesSection: {
      marginBottom: 16,
    },
    sectionLabel: {
      fontSize: 9,
      color: primaryColor,
      marginBottom: 6,
      fontWeight: 700,
    },
    // Bank
    bankSection: {
      backgroundColor: T.flade,
      padding: 14,
      borderRadius: 4,
      marginBottom: 16,
    },
    // Footer
    footer: {
      marginTop: "auto",
      paddingTop: 16,
      borderTopWidth: 1,
      borderTopColor: T.streg,
    },
    footerText: {
      fontSize: 9,
      color: T.graa,
      marginBottom: 3,
    },
    generatedBy: {
      flexDirection: "row",
      alignItems: "center",
      gap: 4,
      marginTop: 4,
    },
    generatedIcon: {
      width: 9,
      height: 9,
      marginBottom: 3,
    },
  });
}
