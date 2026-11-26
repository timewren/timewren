import { Divider } from "@/components/pdf/divider/divider";
import { Heading } from "@/components/pdf/heading/heading";
import { KeyValue } from "@/components/pdf/key-value/key-value";
import { pdfText } from "@/components/pdf/pdf-text";
import { PdfQRCode } from "@/components/pdf/qrcode/qrcode";
import { Section } from "@/components/pdf/section/section";
import {
  Table,
  TableBody,
  TableCell,
  TableFooter,
  TableHeader,
  TableRow,
} from "@/components/pdf/table/table";
import { Text } from "@/components/pdf/text/text";
import { PdfcnThemeProvider } from "@/components/pdf/theme-provider";
import { DEFAULT_INVOICE_PRIMARY_COLOR } from "@/lib/brand/tokens";
import { formatInvoiceNumber } from "@/lib/invoices/draft-number";
import { invoicePdfTotals } from "@/lib/invoices/pdf-totals";
import { Document, Image, Page, View } from "@/lib/pdf-primitives";
import { timetrackPdfTheme } from "@/lib/pdf-themes/timetrack";
import type { InvoicePDF } from "./InvoicePDF";

/** Samme props som den gamle @react-pdf-udgave, så afsenderne er urørte. */
export type InvoiceDocumentProps = Parameters<typeof InvoicePDF>[0] & {
  /** Betalingslink (MobilePay/Stripe) — vises som QR-kode når det findes */
  paymentUrl?: string | null;
};

/**
 * Faktura/kreditnota på pdfcn's takumi-base. Layoutet følger InvoicePDF
 * 1:1 (samme felter, samme rækkefølge, samme momslogik), så en kunde ikke
 * kan se forskel på om PDF_ENGINE er react-pdf eller takumi — bortset fra
 * skarpere typografi, sidetal og valgfri betalings-QR.
 */
export function InvoiceDocument({
  invoice,
  user,
  companyProfile,
  template,
  paymentUrl,
  locale,
  currency: accountCurrency,
}: InvoiceDocumentProps) {
  const { t, intlLocale } = pdfText(locale);
  const formatDate = (date: Date | string | null) =>
    date
      ? new Date(date).toLocaleDateString(intlLocale, {
          timeZone: "Europe/Copenhagen",
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        })
      : t("notSpecified");
  const money = (value: string | number) =>
    (typeof value === "string"
      ? Number.parseFloat(value)
      : value
    ).toLocaleString(intlLocale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  // Kundens egen farve respekteres altid; ellers brandets default.
  const theme = timetrackPdfTheme(
    template?.primaryColor || DEFAULT_INVOICE_PRIMARY_COLOR,
  );
  const c = theme.colors;
  const { currency, vatRate, showVat, subtotal, vatAmount, total } =
    invoicePdfTotals({
      invoice,
      companyProfile,
      template,
      currency: accountCurrency,
    });
  const lines = invoice.lines ?? [];
  const hasLines = lines.length > 0;
  const entries = invoice.timeEntries ?? [];
  const hasTimeEntries = !hasLines && entries.length > 0;
  const logoUrl = template?.logoUrl || companyProfile?.logoUrl;
  const isCreditNote = invoice.kind === "credit_note";
  const senderName = companyProfile?.name || user.name;

  const bankName = template?.bankName || null;
  const bankRegNr =
    template?.bankRegNumber || companyProfile?.bankRegNr || null;
  const bankAccountNr =
    template?.bankAccount || companyProfile?.bankAccountNr || null;
  const hasBankInfo = !!(bankRegNr && bankAccountNr);

  const meta = [
    {
      key: isCreditNote ? t("creditNoteNo") : t("invoiceNo"),
      value: formatInvoiceNumber(invoice.invoiceNumber, t("draft")),
    },
    ...(isCreditNote && invoice.relatedInvoiceNumber
      ? [{ key: t("creditOf"), value: invoice.relatedInvoiceNumber }]
      : []),
    { key: t("issued"), value: formatDate(invoice.issueDate) },
    { key: t("due"), value: formatDate(invoice.dueDate) },
  ];

  const fromLines = [
    companyProfile?.address,
    [companyProfile?.postalCode, companyProfile?.city]
      .filter(Boolean)
      .join(" "),
    companyProfile?.country && companyProfile.country !== "Danmark"
      ? companyProfile.country
      : null,
    companyProfile?.cvrNumber || companyProfile?.vatNumber
      ? t("vatId", {
          number: companyProfile.cvrNumber || companyProfile.vatNumber || "",
        })
      : null,
    companyProfile?.email || user.email,
    companyProfile?.phone,
  ].filter((line): line is string => !!line && line.trim() !== "");

  const toLines = [
    invoice.client.company,
    invoice.client.address,
    [invoice.client.postalCode, invoice.client.city].filter(Boolean).join(" "),
    invoice.client.country && invoice.client.country !== "Danmark"
      ? invoice.client.country
      : null,
    invoice.client.cvrNumber
      ? t("vatId", { number: invoice.client.cvrNumber })
      : null,
    invoice.client.email,
  ].filter((line): line is string => !!line && line.trim() !== "");

  return (
    <PdfcnThemeProvider theme={theme}>
      <Document
        title={t("documentTitle", {
          kind: isCreditNote ? t("creditNote") : t("invoice"),
          number: invoice.invoiceNumber,
        })}
      >
        <Page size="A4">
          {/* Hoved: afsender + titel */}
          <View
            style={{
              alignItems: "flex-start",
              flexDirection: "row",
              justifyContent: "space-between",
              marginBottom: 20,
            }}
          >
            <View style={{ flexDirection: "column", gap: 6 }}>
              {logoUrl && (
                <Image
                  src={logoUrl}
                  style={{ height: 40, objectFit: "contain", width: 120 }}
                />
              )}
              <Text variant="lg" weight="semibold" noMargin>
                {senderName}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end", flexDirection: "column" }}>
              <Heading level={1} color={c.primary} noMargin>
                {isCreditNote ? t("creditNote") : t("invoice")}
              </Heading>
              <Text variant="xs" color={c.mutedForeground} noMargin>
                {formatInvoiceNumber(invoice.invoiceNumber, t("draft"))}
              </Text>
            </View>
          </View>

          {/* Meta + parter */}
          <View
            style={{
              flexDirection: "row",
              gap: 24,
              marginBottom: 20,
            }}
          >
            <View style={{ flex: 1 }}>
              <Text variant="xs" weight="semibold" color={c.mutedForeground}>
                {t("from")}
              </Text>
              <Text weight="semibold" noMargin>
                {senderName}
              </Text>
              {fromLines.map((line) => (
                <Text key={line} noMargin>
                  {line}
                </Text>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <Text variant="xs" weight="semibold" color={c.mutedForeground}>
                {t("to")}
              </Text>
              <Text weight="semibold" noMargin>
                {invoice.client.name}
              </Text>
              {toLines.map((line) => (
                <Text key={line} noMargin>
                  {line}
                </Text>
              ))}
            </View>
            <View style={{ flex: 1 }}>
              <KeyValue items={meta} size="sm" labelFlex={1.1} boldValue />
            </View>
          </View>

          {template?.headerText && (
            <Text variant="sm" color={c.mutedForeground}>
              {template.headerText}
            </Text>
          )}

          {/* Linjer */}
          {hasLines && (
            <Table variant="line" zebraStripe>
              <TableHeader>
                <TableRow header>
                  <TableCell header width="52%">
                    {t("description")}
                  </TableCell>
                  <TableCell header align="right" width="12%">
                    {t("quantity")}
                  </TableCell>
                  <TableCell header align="right" width="18%">
                    {t("unitPrice")}
                  </TableCell>
                  <TableCell header align="right" width="18%" _last>
                    {t("amount")}
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {lines.map((line, index) => (
                  <TableRow
                    // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                    key={`line-${line.sortOrder}-${index}`}
                    stripe={index % 2 === 1}
                  >
                    <TableCell width="52%">{line.description}</TableCell>
                    <TableCell align="right" width="12%">
                      {money(line.quantity)}
                    </TableCell>
                    <TableCell align="right" width="18%">
                      {money(line.unitPrice)}
                    </TableCell>
                    <TableCell align="right" width="18%" _last>
                      {money(line.amount)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Fallback: tidsposter */}
          {hasTimeEntries && (
            <Table variant="line" zebraStripe>
              <TableHeader>
                <TableRow header>
                  <TableCell header width="14%">
                    {t("date")}
                  </TableCell>
                  <TableCell header width="44%">
                    {t("description")}
                  </TableCell>
                  <TableCell header align="right" width="12%">
                    {t("hours")}
                  </TableCell>
                  <TableCell header align="right" width="15%">
                    {t("hourlyRate")}
                  </TableCell>
                  <TableCell header align="right" width="15%" _last>
                    {t("amount")}
                  </TableCell>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry, index) => {
                  const hours = Number.parseFloat(entry.hours);
                  const rate = Number.parseFloat(entry.billableRate || "0");
                  return (
                    <TableRow
                      // biome-ignore lint/suspicious/noArrayIndexKey: statisk liste, der ikke omsorteres eller har egen tilstand; indekset er identiteten
                      key={`te-${String(entry.date)}-${index}`}
                      stripe={index % 2 === 1}
                    >
                      <TableCell width="14%">
                        {formatDate(entry.date)}
                      </TableCell>
                      <TableCell width="44%">
                        {entry.description || t("noDescription")}
                        {entry.project ? ` (${entry.project.name})` : ""}
                      </TableCell>
                      <TableCell align="right" width="12%">
                        {entry.hours}
                      </TableCell>
                      <TableCell align="right" width="15%">
                        {money(rate)}
                      </TableCell>
                      <TableCell align="right" width="15%" _last>
                        {money(hours * rate)}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}

          {/* Totaler */}
          <View
            style={{
              alignItems: "flex-end",
              flexDirection: "column",
              marginTop: 12,
            }}
          >
            <View style={{ width: "45%" }}>
              <Table variant="minimal">
                <TableFooter>
                  {showVat && (
                    <>
                      <TableRow>
                        <TableCell width="55%">{t("subtotal")}</TableCell>
                        <TableCell align="right" width="45%" _last>
                          {money(subtotal)} {currency}
                        </TableCell>
                      </TableRow>
                      <TableRow>
                        <TableCell width="55%">
                          {t("vat", { rate: vatRate })}
                        </TableCell>
                        <TableCell align="right" width="45%" _last>
                          {money(vatAmount)} {currency}
                        </TableCell>
                      </TableRow>
                    </>
                  )}
                  <TableRow footer>
                    <TableCell footer width="55%">
                      {isCreditNote ? t("toCredit") : t("toPay")}
                    </TableCell>
                    <TableCell footer align="right" width="45%" _last>
                      {money(total)} {currency}
                    </TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            </View>
          </View>

          {invoice.notes && (
            <Section spacing="md" variant="card">
              <Text variant="xs" weight="semibold" color={c.mutedForeground}>
                {t("notes")}
              </Text>
              <Text noMargin>{invoice.notes}</Text>
            </Section>
          )}

          {/* Betaling: bankoplysninger + evt. QR */}
          {(hasBankInfo || paymentUrl) && (
            <View
              style={{
                alignItems: "flex-start",
                flexDirection: "row",
                gap: 24,
                marginTop: 16,
              }}
            >
              {hasBankInfo && (
                <View style={{ flex: 1 }}>
                  <Text
                    variant="xs"
                    weight="semibold"
                    color={c.mutedForeground}
                  >
                    {t("paymentDetails")}
                  </Text>
                  {bankName && (
                    <Text noMargin>{t("bank", { name: bankName })}</Text>
                  )}
                  <Text noMargin>
                    {t("regAccount", {
                      reg: bankRegNr ?? "",
                      account: bankAccountNr ?? "",
                    })}
                  </Text>
                  <Text variant="xs" color={c.mutedForeground} noMargin>
                    {t(isCreditNote ? "quoteCreditNote" : "quoteInvoice", {
                      number: formatInvoiceNumber(
                        invoice.invoiceNumber,
                        t("draft"),
                      ),
                    })}
                  </Text>
                </View>
              )}
              {paymentUrl && (
                <PdfQRCode
                  value={paymentUrl}
                  size={72}
                  caption={t("scanToPay")}
                />
              )}
            </View>
          )}

          <Divider spacing="lg" />

          {template?.termsText && (
            <Text variant="xs" color={c.mutedForeground}>
              {template.termsText}
            </Text>
          )}
          {template?.footerText ? (
            <Text variant="xs" color={c.mutedForeground}>
              {template.footerText}
            </Text>
          ) : (
            <Text variant="xs" color={c.mutedForeground}>
              {t("payBy", { date: formatDate(invoice.dueDate) })}
            </Text>
          )}
        </Page>
      </Document>
    </PdfcnThemeProvider>
  );
}
