import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL, MAIL_DASHBOARD_URL, MAIL_FONT } from "./brand";
import {
  EmailButton,
  EmailShell,
  EmailStats,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface TopClient {
  name: string;
  hours: number;
  revenue: number;
}

interface WeeklySummaryEmailProps {
  userName: string;
  weekNumber: number;
  year: number;
  // Current week stats
  hoursThisWeek: number;
  hoursLastWeek: number;
  revenueThisWeek: number;
  revenueLastWeek: number;
  unbilledAmount: number;
  // Top clients
  topClients: TopClient[];
  // Streaks and highlights
  daysTracked: number;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function WeeklySummaryEmail({
  mailBrand,
  userName,
  weekNumber,
  year,
  hoursThisWeek,
  hoursLastWeek,
  revenueThisWeek,
  revenueLastWeek,
  unbilledAmount,
  topClients,
  daysTracked,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: WeeklySummaryEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const fmtHours = (h: number) => formatMailHours(h, locale);
  const formatCurrency = (amount: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

  /** "12 % mere end sidste uge"; teksten bærer forskellen, ikke en farve. */
  const trend = (now: number, before: number) => {
    if (before <= 0) return t("weekly.trendFirst");
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return t("weekly.trendSame");
    return t(pct > 0 ? "weekly.trendMore" : "weekly.trendLess", {
      pct: Math.abs(pct),
    });
  };

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("weekly.preview", {
        week: weekNumber,
        hours: fmtHours(hoursThisWeek),
        revenue: formatCurrency(revenueThisWeek),
      })}
      kicker={t("weekly.kicker")}
      heading={t("weekly.heading", { week: weekNumber, year })}
      footerNote={t("weekly.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {daysTracked >= 5 ? t("weekly.introFull") : t("weekly.intro")}
      </Text>

      <EmailStats
        stats={[
          {
            label: t("hours"),
            value: t("hoursUnit", { hours: fmtHours(hoursThisWeek) }),
            sub: trend(hoursThisWeek, hoursLastWeek),
          },
          {
            label: t("revenue"),
            value: formatCurrency(revenueThisWeek),
            sub: trend(revenueThisWeek, revenueLastWeek),
          },
          {
            label: t("weekly.daysLabel"),
            value: t("weekly.daysValue", { days: daysTracked }),
          },
        ]}
      />

      {unbilledAmount > 0 && (
        <Text style={emailText}>
          {mailMarkup(
            t("weekly.unbilled", { amount: formatCurrency(unbilledAmount) }),
          )}
        </Text>
      )}

      {topClients.length > 0 && (
        <table
          style={{
            borderCollapse: "collapse",
            margin: "8px 0 16px",
            width: "100%",
          }}
        >
          <thead>
            <tr>
              <th className="tt-muted" style={thStyle}>
                {t("client")}
              </th>
              <th
                className="tt-muted"
                style={{ ...thStyle, textAlign: "right" }}
              >
                {t("hours")}
              </th>
              <th
                className="tt-muted"
                style={{ ...thStyle, textAlign: "right" }}
              >
                {t("revenue")}
              </th>
            </tr>
          </thead>
          <tbody>
            {topClients.map((client) => (
              <tr key={client.name}>
                <td style={tdStyle}>{client.name || t("unknownClient")}</td>
                <td style={{ ...tdStyle, ...tdNum }}>
                  {fmtHours(client.hours)}
                </td>
                <td style={{ ...tdStyle, ...tdNum }}>
                  {formatCurrency(client.revenue)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <EmailButton href={`${dashboardUrl}/week-review`}>
        {t("weekly.button")}
      </EmailButton>
      <Text style={emailMuted}>{t("weekly.muted")}</Text>
    </EmailShell>
  );
}

const thStyle = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "13px",
  fontWeight: 600,
  padding: "6px 0",
  textAlign: "left" as const,
};

const tdStyle = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.text,
  fontFamily: MAIL_FONT,
  fontSize: "15px",
  padding: "8px 0",
};

const tdNum = {
  fontVariantNumeric: "tabular-nums" as const,
  textAlign: "right" as const,
};

export default WeeklySummaryEmail;
