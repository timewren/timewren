import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import type { ReminderCharges } from "@/lib/invoices/reminder-rules";
import {
  EmailButton,
  EmailKeyValue,
  EmailShell,
  emailText,
} from "./EmailShell";

// Automatiske rykkere (#92): venlig påmindelse før forfald eller
// rykker 1-3 med dansk-korrekt kravopgørelse (gebyr, B2B-kompensation,
// morarente). Deterministisk indhold. Mailen går til brugerens kunde og
// omtaler afsenderen i tredje person.

interface InvoiceReminderEmailProps {
  clientName: string;
  senderName: string;
  invoiceNumber: string;
  amount: number;
  dueDate: string; // formateret i modtagerens sprog
  /** null = venlig påmindelse FØR forfald */
  reminder: (ReminderCharges & { daysOverdue: number }) | null;
  portalUrl?: string | null;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function InvoiceReminderEmail({
  clientName,
  senderName,
  invoiceNumber,
  amount,
  dueDate,
  reminder,
  portalUrl,
  locale = "da",
  mailBrand,
}: InvoiceReminderEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const isFriendly = reminder === null;
  const fmtKr = (n: number) =>
    t("kr", {
      amount: new Intl.NumberFormat(toIntlLocale(locale), {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(n),
    });

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={
        isFriendly
          ? t("reminder.previewFriendly", {
              number: invoiceNumber,
              due: dueDate,
            })
          : t("reminder.previewOverdue", {
              n: reminder.reminderNumber,
              number: invoiceNumber,
            })
      }
      kicker={
        isFriendly ? t("reminder.kickerFriendly") : t("reminder.kickerOverdue")
      }
      heading={
        isFriendly
          ? t("reminder.headingFriendly")
          : t("reminder.headingOverdue", { n: reminder.reminderNumber })
      }
      footerNote={t("reminder.footerNote", {
        sender: senderName,
        brand: brand.name,
      })}
    >
      <Text style={emailText}>{t("greeting", { name: clientName })}</Text>
      <Text style={emailText}>
        {isFriendly
          ? t("reminder.bodyFriendly", {
              number: invoiceNumber,
              sender: senderName,
              amount: fmtKr(amount),
              due: dueDate,
            })
          : t("reminder.bodyOverdue", {
              number: invoiceNumber,
              sender: senderName,
              amount: fmtKr(amount),
              due: dueDate,
              days: reminder.daysOverdue,
            })}
      </Text>

      {!isFriendly && (
        <EmailKeyValue
          rows={[
            { label: t("reminder.principal"), value: fmtKr(amount) },
            {
              label: t("reminder.fee", { n: reminder.reminderNumber }),
              value: fmtKr(reminder.totalFees),
            },
            ...(reminder.compensation > 0
              ? [
                  {
                    label: t("reminder.compensation"),
                    value: fmtKr(reminder.compensation),
                  },
                ]
              : []),
            {
              label: t("reminder.interest", { days: reminder.daysOverdue }),
              value: fmtKr(reminder.accruedInterest),
            },
            {
              label: t("reminder.total"),
              value: fmtKr(reminder.totalClaim),
              strong: true,
            },
          ]}
        />
      )}

      {portalUrl && (
        <EmailButton href={portalUrl}>{t("reminder.portalButton")}</EmailButton>
      )}
    </EmailShell>
  );
}

export default InvoiceReminderEmail;
