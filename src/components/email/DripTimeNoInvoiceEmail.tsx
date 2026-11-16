import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalText as text,
} from "./PersonalEmailLayout";

interface DripTimeNoInvoiceEmailProps {
  userName: string;
  /** Signeret afmeldingslink (List-Unsubscribe-målet) */
  unsubscribeUrl?: string;
  /** Fx "12,5" */
  unbilledHours: string;
  invoiceUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** Aktivering (#91/#175): tid registreret, men ingen faktura efter 14 dage. */
export function DripTimeNoInvoiceEmail({
  mailBrand,
  userName,
  unsubscribeUrl,
  unbilledHours,
  invoiceUrl = mailBrand
    ? `${mailBrand.dashboardUrl}/invoices/new`
    : "https://timetrack.dk/dashboard/invoices/new",
  locale = "da",
}: DripTimeNoInvoiceEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("timeNoInvoice.preview", { hours: unbilledHours })}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Text style={text}>{t("greeting", { name: userName })}</Text>

      <Text style={text}>
        {t("timeNoInvoice.body", { hours: unbilledHours })}
      </Text>

      <PersonalButton href={invoiceUrl}>
        {t("timeNoInvoice.button")}
      </PersonalButton>

      <Text style={text}>{t("timeNoInvoice.elsewhere")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripTimeNoInvoiceEmail;
