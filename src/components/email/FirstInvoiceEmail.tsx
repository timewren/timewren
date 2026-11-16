import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import { EmailKeyValue } from "./EmailShell";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText,
} from "./PersonalEmailLayout";

interface FirstInvoiceEmailProps {
  userName: string;
  invoiceNumber: string;
  amount: string;
  clientName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function FirstInvoiceEmail({
  mailBrand,
  userName,
  invoiceNumber,
  amount,
  clientName,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: FirstInvoiceEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("firstInvoice.preview", {
        number: invoiceNumber,
        client: clientName,
      })}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("firstInvoice.congrats")}</Text>

      <EmailKeyValue
        rows={[
          { label: t("firstInvoice.number"), value: `#${invoiceNumber}` },
          { label: t("firstInvoice.client"), value: clientName },
          { label: t("firstInvoice.amount"), value: amount, strong: true },
        ]}
      />

      <Text style={personalText}>
        {t("firstInvoice.send", { client: clientName, brand: brand.name })}
      </Text>

      <PersonalButton href={`${dashboardUrl}/invoices`}>
        {t("firstInvoice.button")}
      </PersonalButton>

      <Text style={personalText}>{t("firstInvoice.accounting")}</Text>
    </PersonalEmailLayout>
  );
}

export default FirstInvoiceEmail;
