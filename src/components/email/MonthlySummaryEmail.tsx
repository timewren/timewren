import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import type { DemoCurrency } from "@/lib/demo/demo-mode";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL, MAIL_DASHBOARD_URL, MAIL_FONT } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  EmailStats,
  emailMuted,
  emailText,
} from "./EmailShell";

interface ClientBreakdown {
  name: string;
  hours: number;
  revenue: number;
}

interface InvoiceStats {
  paid: number;
  paidAmount: number;
  outstanding: number;
  outstandingAmount: number;
}

interface PrepaidStats {
  activePackages: number;
  lowBalancePackages: number;
  expiringPackages: number;
}

interface MonthlySummaryEmailProps {
  userName: string;
  monthName: string;
  year: number;
  // Current month stats
  hoursThisMonth: number;
  hoursLastMonth: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  // Client breakdown
  clientBreakdown: ClientBreakdown[];
  // Invoice stats
  invoiceStats: InvoiceStats;
  // Prepaid stats
  prepaidStats: PrepaidStats;
  // Year to date
  yearToDateRevenue: number;
  dashboardUrl?: string;
  locale?: string;
  currencyCode?: DemoCurrency;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

const currencyFor =
  (locale: string, currencyCode: DemoCurrency) => (amount: number) =>
    new Intl.NumberFormat(toIntlLocale(locale), {
      style: "currency",
      currency: currencyCode,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);

/** "12 % mere end forrige måned"; teksten bærer forskellen, ikke en farve. */
function trendFor(t: ReturnType<typeof mailT>) {
  return (now: number, before: number): string => {
    if (before <= 0) return t("monthly.trendFirst");
    const pct = Math.round(((now - before) / before) * 100);
    if (pct === 0) return t("monthly.trendSame");
    return t(pct > 0 ? "monthly.trendMore" : "monthly.trendLess", {
      pct: Math.abs(pct),
    });
  };
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

export function MonthlySummaryEmail({
  mailBrand,
  userName,
  monthName,
  year,
  hoursThisMonth,
  hoursLastMonth,
  revenueThisMonth,
  revenueLastMonth,
  clientBreakdown,
  invoiceStats,
  prepaidStats,
  yearToDateRevenue,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
  currencyCode = "DKK",
}: MonthlySummaryEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const currency = currencyFor(locale, currencyCode);
  const trend = trendFor(t);
  const fmtHours = (h: number) => formatMailHours(h, locale);
  const prepaidWarnings =
    prepaidStats.lowBalancePackages + prepaidStats.expiringPackages;

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("monthly.preview", {
        month: monthName,
        year,
        revenue: currency(revenueThisMonth),
      })}
      kicker={t("monthly.kicker")}
      heading={`${monthName} ${year}`}
      footerNote={t("monthly.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>{t("monthly.intro")}</Text>

      <EmailStats
        stats={[
          {
            label: t("hours"),
            value: t("hoursUnit", { hours: fmtHours(hoursThisMonth) }),
            sub: trend(hoursThisMonth, hoursLastMonth),
          },
          {
            label: t("revenue"),
            value: currency(revenueThisMonth),
            sub: trend(revenueThisMonth, revenueLastMonth),
          },
          {
            label: t("monthly.yearLabel", { year }),
            value: currency(yearToDateRevenue),
            sub: t("monthly.yearSub"),
          },
        ]}
      />

      <EmailKeyValue
        rows={[
          {
            label: t("monthly.paidInvoices"),
            value: `${invoiceStats.paid} (${currency(invoiceStats.paidAmount)})`,
          },
          {
            label: t("monthly.outstanding"),
            value: `${invoiceStats.outstanding} (${currency(invoiceStats.outstandingAmount)})`,
            strong: invoiceStats.outstandingAmount > 0,
          },
        ]}
      />

      {clientBreakdown.length > 0 && (
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
                {t("revenue")}
              </th>
            </tr>
          </thead>
          <tbody>
            {clientBreakdown.map((client) => (
              <tr key={client.name}>
                <td style={td}>{client.name || t("unknownClient")}</td>
                <td style={tdNum}>{fmtHours(client.hours)}</td>
                <td style={tdNum}>{currency(client.revenue)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {prepaidWarnings > 0 && (
        <EmailCallout tone="warning" title={t("monthly.prepaidTitle")}>
          {prepaidStats.lowBalancePackages > 0 && (
            <div>
              {t("monthly.lowBalance", {
                count: prepaidStats.lowBalancePackages,
              })}
            </div>
          )}
          {prepaidStats.expiringPackages > 0 && (
            <div>
              {t("monthly.expiring", { count: prepaidStats.expiringPackages })}
            </div>
          )}
          <div>
            {t("monthly.activePackages", {
              count: prepaidStats.activePackages,
            })}
          </div>
        </EmailCallout>
      )}

      <EmailButton href={`${dashboardUrl}/reports`}>
        {t("monthly.button")}
      </EmailButton>
      <Text style={emailMuted}>{t("monthly.muted")}</Text>
    </EmailShell>
  );
}

export default MonthlySummaryEmail;
