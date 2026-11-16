import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { bgAttr, MAIL, MAIL_FONT } from "./brand";
import { EmailButton, EmailShell, emailText } from "./EmailShell";

interface TimesheetNotificationEmailProps {
  recipientName: string;
  heading: string;
  bodyLines: string[];
  /** Vises på en rolig flade, fx afvisningsårsag eller en note */
  highlight?: string;
  ctaLabel: string;
  ctaUrl: string;
  /** Mailen går til brugerens kunde: neutral sidefod (se EmailShell). */
  toCustomer?: boolean;
  /** Linje i sidefoden: hvorfor modtageren får mailen. */
  footerNote?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * Generisk notifikation til timeseddel-godkendelsesflowet:
 * indsendt (til leder), godkendt/afvist (til medarbejder) og tid til
 * godkendelse (til kundens kontaktperson, `toCustomer`).
 */
export function TimesheetNotificationEmail({
  recipientName,
  heading,
  bodyLines,
  highlight,
  ctaLabel,
  ctaUrl,
  toCustomer = false,
  footerNote,
  locale = "da",
  mailBrand,
}: TimesheetNotificationEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={heading}
      kicker={t("timesheet.kicker")}
      heading={heading}
      showSettingsLink={!toCustomer}
      audience={toCustomer ? "kunde" : "bruger"}
      footerNote={footerNote}
    >
      <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
      {bodyLines.map((line) => (
        <Text key={line} style={emailText}>
          {line}
        </Text>
      ))}
      {highlight && (
        <table
          role="presentation"
          border={0}
          cellPadding={0}
          cellSpacing={0}
          width="100%"
          style={{ margin: "0 0 16px 0" }}
        >
          <tbody>
            <tr>
              <td
                {...bgAttr(MAIL.surface)}
                style={{
                  backgroundColor: MAIL.surface,
                  borderRadius: "6px",
                  color: MAIL.text,
                  fontFamily: MAIL_FONT,
                  fontSize: "15px",
                  lineHeight: "22px",
                  padding: "12px 16px",
                  whiteSpace: "pre-line",
                }}
              >
                {highlight}
              </td>
            </tr>
          </tbody>
        </table>
      )}
      <EmailButton href={ctaUrl}>{ctaLabel}</EmailButton>
    </EmailShell>
  );
}

export default TimesheetNotificationEmail;
