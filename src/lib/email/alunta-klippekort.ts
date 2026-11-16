import { render } from "@react-email/render";
import { createElement } from "react";
import { AluntaKlippekortCreatedEmail } from "@/components/email/AluntaKlippekortCreatedEmail";
import { parseHours } from "@/components/email/PrepaidLowBalanceEmail";
import { getAppUrl } from "@/lib/config";
import { formatMailHours, mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";

// ─── Alunta Klippekort Created ──────────────────────────────────────

interface SendAluntaKlippekortCreatedParams {
  to: string;
  userName: string;
  clientName: string;
  hours: string;
  hourlyRate: string;
  expiryDate?: string;
  planName: string;
  userId?: string;
}

export async function sendAluntaKlippekortCreatedEmail({
  to,
  userName,
  clientName,
  hours,
  hourlyRate,
  expiryDate,
  planName,
  userId,
}: SendAluntaKlippekortCreatedParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "alunta_klippekort_created" as const,
    to,
    clientName,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    return;
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);
  const dashboardUrl = `${mb?.appUrl ?? getAppUrl()}/dashboard/klippekort`;

  const emailHtml = await render(
    createElement(AluntaKlippekortCreatedEmail, {
      mailBrand: mb,
      userName,
      clientName,
      hours,
      hourlyRate,
      expiryDate,
      planName,
      dashboardUrl,
      locale,
    }),
  );

  const subject = t("alunta.subject", {
    client: clientName,
    hours: formatMailHours(parseHours(hours), locale),
  });

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
    userId ? { userId, emailType: "alunta_klippekort_created" } : undefined,
  );
}
