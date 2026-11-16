import { render } from "@react-email/render";
import { createElement } from "react";
import { TimesheetNotificationEmail } from "@/components/email/TimesheetNotificationEmail";
import { formatMailHours, mailT } from "@/lib/email/locale";
import { brandUrl, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";

/**
 * Til kunde-portalens kontaktperson, når en bruger eller et team sender tid
 * til godkendelse. Kunden åbner portalen og godkender eller afviser tiden.
 */
export async function sendApprovalRequestEmail(params: {
  to: string;
  recipientName: string;
  freelancerName: string;
  periodLabel: string;
  totalHours: number;
  entryCount: number;
  portalUrl: string;
  /** Freelancerens/ejerens userId — bruges til email-logning. */
  userId: string;
}) {
  const logContext = {
    emailType: "time_approval_request" as const,
    to: params.to,
  };
  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return null;
  }

  // Kundens kontaktperson har ingen profil: mailen følger afsenderens sprog.
  // Kundemail: afsenderens (kontoens) brand.
  const mb = await resolveMailBrand({ userId: params.userId });
  const locale = await getRecipientLocale({
    userId: params.userId,
    email: params.to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);

  const subject = t("approval.subject", {
    freelancer: params.freelancerName,
    period: params.periodLabel,
  });

  const html = await render(
    createElement(TimesheetNotificationEmail, {
      mailBrand: mb,
      locale,
      recipientName: params.recipientName,
      heading: t("approval.heading"),
      bodyLines: [
        t("approval.body1", {
          freelancer: params.freelancerName,
          period: params.periodLabel,
          count: params.entryCount,
          hours: formatMailHours(params.totalHours, locale),
        }),
        t("approval.body2"),
      ],
      ctaLabel: t("approval.cta"),
      ctaUrl: brandUrl(params.portalUrl, mb),
      toCustomer: true,
      footerNote: t("approval.footerNote", {
        freelancer: params.freelancerName,
      }),
    }),
  );

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to: params.to,
        subject,
        html,
      });
      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }
      return response;
    },
    { userId: params.userId, emailType: "time_approval_request" },
  );
}
