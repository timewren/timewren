import { render } from "@react-email/render";
import { createElement } from "react";
import { MonthlySummaryEmail } from "@/components/email/MonthlySummaryEmail";
import { UnbilledReminderEmail } from "@/components/email/UnbilledReminderEmail";
import { WeeklySummaryEmail } from "@/components/email/WeeklySummaryEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import {
  DEFAULT_UNBILLED_REMINDER_FREQUENCY,
  type UnbilledReminderFrequency,
} from "@/lib/notifications/unbilled-reminder";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";
import { withEmailLogging } from "./logger";
import { buildUnsubscribeHeaders } from "./unsubscribe";

// Types
interface TopClient {
  name: string;
  hours: number;
  revenue: number;
}

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

interface UnbilledClient {
  name: string;
  hours: number;
  value: number;
}

// Weekly Summary
interface WeeklySummaryParams {
  to: string;
  userName: string;
  weekNumber: number;
  year: number;
  hoursThisWeek: number;
  hoursLastWeek: number;
  revenueThisWeek: number;
  revenueLastWeek: number;
  unbilledAmount: number;
  topClients: TopClient[];
  daysTracked: number;
  userId?: string;
}

export async function sendWeeklySummaryEmail({
  to,
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
  userId,
}: WeeklySummaryParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const emailHtml = await render(
    createElement(WeeklySummaryEmail, {
      mailBrand: mb,
      locale,
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
      dashboardUrl,
    }),
  );

  const subject = t("weekly.subject", { week: weekNumber });

  return withEmailLogging(
    { emailType: "weekly_summary", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send weekly summary email");
      }

      return response;
    },
    userId ? { userId, emailType: "weekly_summary" } : undefined,
  );
}

// Monthly Summary
interface MonthlySummaryParams {
  to: string;
  userName: string;
  /** Den måned rapporten dækker (UTC-midnat den 1.) */
  monthDate: Date;
  year: number;
  hoursThisMonth: number;
  hoursLastMonth: number;
  revenueThisMonth: number;
  revenueLastMonth: number;
  clientBreakdown: ClientBreakdown[];
  invoiceStats: InvoiceStats;
  prepaidStats: PrepaidStats;
  yearToDateRevenue: number;
  userId?: string;
}

export async function sendMonthlySummaryEmail({
  to,
  userName,
  monthDate,
  year,
  hoursThisMonth,
  hoursLastMonth,
  revenueThisMonth,
  revenueLastMonth,
  clientBreakdown,
  invoiceStats,
  prepaidStats,
  yearToDateRevenue,
  userId,
}: MonthlySummaryParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const monthLong = monthDate.toLocaleDateString(toIntlLocale(locale), {
    month: "long",
    timeZone: "UTC",
  });
  const monthName = monthLong.charAt(0).toUpperCase() + monthLong.slice(1);
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const emailHtml = await render(
    createElement(MonthlySummaryEmail, {
      mailBrand: mb,
      locale,
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
      dashboardUrl,
    }),
  );

  const subject = t("monthly.subject", { month: monthName, year });

  return withEmailLogging(
    { emailType: "monthly_summary", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        throw new Error(
          `Failed to send monthly summary email: ${response.error.message}`,
        );
      }

      return response;
    },
    userId ? { userId, emailType: "monthly_summary" } : undefined,
  );
}

// Unbilled Reminder
interface UnbilledReminderParams {
  to: string;
  userName: string;
  totalUnbilledHours: number;
  totalUnbilledValue: number;
  unbilledByClient: UnbilledClient[];
  userId?: string;
  /** Brugerens valgte kadence — styrer footer-teksten i mailen (#622). */
  frequency?: UnbilledReminderFrequency;
}

export async function sendUnbilledReminderEmail({
  to,
  userName,
  totalUnbilledHours,
  totalUnbilledValue,
  unbilledByClient,
  userId,
  frequency = DEFAULT_UNBILLED_REMINDER_FREQUENCY,
}: UnbilledReminderParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error("Email service not configured.");
  }

  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat(toIntlLocale(locale), {
      style: "currency",
      currency: "DKK",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };

  const emailHtml = await render(
    createElement(UnbilledReminderEmail, {
      mailBrand: mb,
      locale,
      userName,
      totalUnbilledHours,
      totalUnbilledValue,
      unbilledByClient,
      dashboardUrl,
      frequency,
    }),
  );

  const subject = t("unbilled.subject", {
    value: formatCurrency(totalUnbilledValue),
  });

  return withEmailLogging(
    { emailType: "unbilled_reminder", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        headers: userId
          ? buildUnsubscribeHeaders(userId, mb?.appUrl)
          : undefined,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send unbilled reminder email");
      }

      return response;
    },
    userId ? { userId, emailType: "unbilled_reminder" } : undefined,
  );
}
