import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailCallout,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface PaymentFailedEmailProps {
  userName: string;
  amountDue: string;
  billingPortalUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PaymentFailedEmail({
  userName,
  amountDue,
  billingPortalUrl,
  locale = "da",
  mailBrand,
}: PaymentFailedEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  // Beløbet kommer som "79,00 kr"; skriv enheden med punktum.
  const amount = amountDue.replace(/\skr$/, " kr.");
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("paymentFailed.preview", { brand: brand.name })}
      kicker={t("paymentFailed.kicker")}
      heading={t("paymentFailed.heading")}
      footerNote={t("paymentFailed.footerNote")}
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {mailMarkup(t("paymentFailed.body", { brand: brand.name, amount }))}
      </Text>
      <EmailCallout tone="danger" title={t("paymentFailed.calloutTitle")}>
        {t("paymentFailed.calloutBody")}
      </EmailCallout>
      <EmailButton href={billingPortalUrl}>
        {t("paymentFailed.button")}
      </EmailButton>
      <Text style={emailMuted}>
        {mailMarkup(t("questions", { email: brand.supportEmail }), {
          mail: (label) => (
            <Link href={`mailto:${brand.supportEmail}`} style={emailLink}>
              {label}
            </Link>
          ),
        })}
      </Text>
    </EmailShell>
  );
}

export default PaymentFailedEmail;
