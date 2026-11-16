import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  DEFAULT_UNBILLED_REMINDER_FREQUENCY,
  type UnbilledReminderFrequency,
} from "@/lib/notifications/unbilled-reminder";
import { MAIL, MAIL_DASHBOARD_URL, MAIL_FONT } from "./brand";
import {
  EmailButton,
  EmailShell,
  EmailStats,
  emailMuted,
  emailText,
} from "./EmailShell";

interface UnbilledClient {
  name: string;
  hours: number;
  value: number;
}

interface UnbilledReminderEmailProps {
  userName: string;
  totalUnbilledHours: number;
  totalUnbilledValue: number;
  unbilledByClient: UnbilledClient[];
  dashboardUrl?: string;
  /** Kadencen bestemmer footer-teksten, så den matcher brugerens valg (#622). */
  frequency?: UnbilledReminderFrequency;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

const th = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "13px",
  fontWeight: 600,
  padding: "6px 0",
  textAlign: "left" as const,
};

const td = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.text,
  fontFamily: MAIL_FONT,
  fontSize: "15px",
  padding: "8px 0",
};

const tdNum = {
  ...td,
  fontVariantNumeric: "tabular-nums" as const,
  textAlign: "right" as const,
};

export function UnbilledReminderEmail({
  mailBrand,
  userName,
  totalUnbilledHours,
  totalUnbilledValue,
  unbilledByClient,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  frequency = DEFAULT_UNBILLED_REMINDER_FREQUENCY,
  locale = "da",
}: UnbilledReminderEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const currency = (amount: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  const fmtHours = (h: number) => formatMailHours(h, locale);
  const footerKey = {
    daily: "unbilled.footerDaily",
    weekly: "unbilled.footerWeekly",
    monthly: "unbilled.footerMonthly",
  }[frequency];
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("unbilled.preview", {
        hours: fmtHours(totalUnbilledHours),
        value: currency(totalUnbilledValue),
      })}
      kicker={t("unbilled.kicker")}
      heading={t("unbilled.heading")}
      footerNote={t(footerKey)}
      showSettingsLink
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>{t("unbilled.intro")}</Text>

      <EmailStats
        stats={[
          {
            label: t("unbilled.statHours"),
            value: t("hoursUnit", { hours: fmtHours(totalUnbilledHours) }),
          },
          {
            label: t("unbilled.statValue"),
            value: currency(totalUnbilledValue),
          },
        ]}
      />

      {unbilledByClient.length > 0 && (
        <table
          style={{
            borderCollapse: "collapse",
            margin: "8px 0 16px",
            width: "100%",
          }}
        >
          <thead>
            <tr>
              <th className="tt-muted" style={th}>
                {t("client")}
              </th>
              <th className="tt-muted" style={{ ...th, textAlign: "right" }}>
                {t("hours")}
              </th>
              <th className="tt-muted" style={{ ...th, textAlign: "right" }}>
                {t("unbilled.statValue")}
              </th>
            </tr>
          </thead>
          <tbody>
            {unbilledByClient.map((client) => (
              <tr key={client.name}>
                <td style={td}>{client.name || t("unknownClient")}</td>
                <td style={tdNum}>{fmtHours(client.hours)}</td>
                <td style={tdNum}>{currency(client.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <EmailButton href={`${dashboardUrl}/invoices/new`}>
        {t("unbilled.button")}
      </EmailButton>
      <Text style={emailMuted}>{t("unbilled.muted")}</Text>
    </EmailShell>
  );
}

export default UnbilledReminderEmail;
