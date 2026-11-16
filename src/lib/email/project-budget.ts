import { render } from "@react-email/render";
import { createElement } from "react";
import { ProjectBudgetAlertEmail } from "@/components/email/ProjectBudgetAlertEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { getAppUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";

export interface SendProjectBudgetAlertParams {
  to: string;
  recipientName: string;
  projectId: string;
  projectName: string;
  clientName: string | null;
  /** "YYYY-MM" i dansk tid */
  month: string;
  usedHours: number;
  budgetHours: number;
  percentage: number;
  level: 80 | 100;
  userId?: string;
}

/** "2026-09" → "september 2026" (i modtagerens sprog) */
export function monthLabelDa(month: string, locale = "da"): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(
    toIntlLocale(locale),
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  );
}

function fmtHours(h: number, locale: string): string {
  return h.toLocaleString(toIntlLocale(locale), { maximumFractionDigits: 1 });
}

/**
 * Advarsel om månedsbudget (#592). Sendes af budget-alerts-cronen, én gang
 * pr. tærskel (80/100 %) pr. projekt pr. måned.
 */
export async function sendProjectBudgetAlert({
  to,
  recipientName,
  projectId,
  projectName,
  clientName,
  month,
  usedHours,
  budgetHours,
  percentage,
  level,
  userId,
}: SendProjectBudgetAlertParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "project_budget_alert" as const,
    to,
    projectName,
    month,
    level,
    percentage,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const appUrl = mb?.appUrl ?? getAppUrl();
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const monthLabel = monthLabelDa(month, locale);

  const emailHtml = await render(
    createElement(ProjectBudgetAlertEmail, {
      mailBrand: mb,
      locale,
      recipientName,
      projectName,
      clientName,
      monthLabel,
      usedHours: fmtHours(usedHours, locale),
      budgetHours: fmtHours(budgetHours, locale),
      percentage,
      level,
      projectUrl: `${appUrl}/dashboard/projects/${projectId}`,
    }),
  );

  const subject =
    level === 100
      ? t("budget.subjectCritical", { project: projectName, month: monthLabel })
      : t("budget.subjectWarning", { project: projectName, month: monthLabel });

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });
      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }
      return response;
    },
    userId ? { userId, emailType: "project_budget_alert" } : undefined,
  );
}
