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

interface PaymentReminderEmailProps {
  userName: string;
  urgency: "warning" | "urgent";
  daysOverdue: number;
  billingPortalUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PaymentReminderEmail({
  userName,
  urgency,
  daysOverdue,
  billingPortalUrl,
  locale = "da",
  mailBrand,
}: PaymentReminderEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const isUrgent = urgency === "urgent";
  const values = { brand: brand.name, days: daysOverdue };
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={
        isUrgent
          ? t("paymentReminder.previewUrgent", values)
          : t("paymentReminder.previewWarning", values)
      }
      kicker={t("paymentReminder.kicker")}
      heading={
        isUrgent
          ? t("paymentReminder.headingUrgent")
          : t("paymentReminder.headingWarning")
      }
      footerNote={t("paymentReminder.footerNote")}
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {isUrgent
          ? t("paymentReminder.bodyUrgent", values)
          : t("paymentReminder.bodyWarning", values)}
      </Text>
      {isUrgent ? (
        <EmailCallout
          tone="danger"
          title={t("paymentReminder.calloutUrgentTitle")}
        >
          {t("paymentReminder.calloutUrgentBody")}
        </EmailCallout>
      ) : (
        <EmailCallout tone="warning" title={t("paymentFailed.calloutTitle")}>
          {t("paymentReminder.calloutWarningBody")}
        </EmailCallout>
      )}
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

export default PaymentReminderEmail;
