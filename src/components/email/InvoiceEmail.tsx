import { Link, Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { DEMO_CURRENCY } from "@/lib/demo/demo-mode";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailKeyValue,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface InvoiceEmailProps {
  invoiceNumber: string;
  clientName: string;
  amount: string;
  currency?: typeof DEMO_CURRENCY;
  dueDate: string;
  senderName: string;
  senderEmail: string;
  notes?: string | null;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * Beløbet kommer fra databasen som "8125.00"; skriv det som "8.125,00 kr.".
 * En tekst der allerede er formateret ("8.125,00") får kun enheden.
 */
function formatAmount(
  raw: string,
  locale: string,
  currency?: typeof DEMO_CURRENCY,
): string {
  const t = mailT("emailsBilling", locale);
  const value = raw.trim();
  const formatted = /^-?\d+(\.\d+)?$/.test(value)
    ? new Intl.NumberFormat(toIntlLocale(locale), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number(value))
    : value;
  return currency === DEMO_CURRENCY
    ? `${formatted} ${currency}`
    : t("kr", { amount: formatted });
}

export function InvoiceEmail({
  invoiceNumber,
  clientName,
  amount,
  currency,
  dueDate,
  senderName,
  senderEmail,
  notes,
  locale = "da",
  mailBrand,
}: InvoiceEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const formatDate = (dateString: string) =>
    new Date(dateString).toLocaleDateString(toIntlLocale(locale), {
      timeZone: "Europe/Copenhagen",
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  const formattedAmount = formatAmount(amount, locale, currency);

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("invoice.preview", {
        number: invoiceNumber,
        sender: senderName,
        amount: formattedAmount,
        due: formatDate(dueDate),
      })}
      kicker={t("invoice.kicker")}
      heading={t("invoice.heading", { number: invoiceNumber })}
      footerNote={t("invoice.footerNote", {
        sender: senderName,
        brand: brand.name,
      })}
    >
      <Text style={emailText}>
        {t("invoice.greeting", { name: clientName })}
      </Text>
      <Text style={emailText}>
        {t("invoice.attached", { number: invoiceNumber, sender: senderName })}
      </Text>

      <EmailKeyValue
        rows={[
          { label: t("invoice.number"), value: invoiceNumber },
          { label: t("invoice.amount"), value: formattedAmount, strong: true },
          { label: t("invoice.due"), value: formatDate(dueDate) },
        ]}
      />

      {notes && (
        <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
          <strong>{t("invoice.noteLabel")}</strong> {notes}
        </Text>
      )}

      <Text style={emailText}>
        {t("invoice.payBy", { due: formatDate(dueDate) })}
      </Text>

      <Text style={emailMuted}>
        {mailMarkup(
          t("invoice.questions", { sender: senderName, email: senderEmail }),
          {
            mail: (label) => (
              <Link href={`mailto:${senderEmail}`} style={emailLink}>
                {label}
              </Link>
            ),
          },
        )}
      </Text>
    </EmailShell>
  );
}

export default InvoiceEmail;
