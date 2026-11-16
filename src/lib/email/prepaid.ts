import { createElement } from "react";
import {
  PrepaidExpiryEmail,
  prepaidExpiryMailPhrase,
} from "@/components/email/PrepaidExpiryEmail";
import { PrepaidLowBalanceEmail } from "@/components/email/PrepaidLowBalanceEmail";
import { getAppUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { brandUrl, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface SendLowBalanceAlertParams {
  to: string;
  recipientName: string;
  clientName: string;
  packageName: string;
  remainingHours: string;
  totalHours: string;
  percentageRemaining: number;
  userId?: string;
  clientId?: string;
  /** Kundens portal-link (#95) — kun for kunde-modtagere */
  portalUrl?: string | null;
  /** Kunden får kundevarianten, også uden portal-link */
  recipient?: "owner" | "client";
  senderName?: string;
  senderEmail?: string;
}

interface SendExpiryWarningParams {
  to: string;
  recipientName: string;
  clientName: string;
  packageName: string;
  remainingHours: string;
  expiryDate: string;
  daysUntilExpiry: number;
  userId?: string;
  clientId?: string;
  /** Kundens portal-link (#95) — kun for kunde-modtagere */
  portalUrl?: string | null;
  /** Kunden får kundevarianten, også uden portal-link */
  recipient?: "owner" | "client";
  senderName?: string;
  senderEmail?: string;
}

export async function sendLowBalanceAlert({
  to,
  recipientName,
  clientName,
  packageName,
  remainingHours,
  totalHours,
  percentageRemaining,
  userId,
  clientId,
  portalUrl = null,
  recipient,
  senderName,
  senderEmail,
}: SendLowBalanceAlertParams) {
  // Kundemodtagere får afsenderens (kontoens) brand.
  const mb = await resolveMailBrand({
    userId,
    email: recipient === "client" ? senderEmail : to,
  });
  const logContext = {
    emailType: "low_balance_alert" as const,
    to,
    clientName,
    packageName,
    remainingHours,
    percentageRemaining,
  };

  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  // Skabelonen bygger `${dashboardUrl}/klippekort` — uden /dashboard endte
  // knappen på den offentlige klippekort-landingsside.
  const dashboardUrl = `${mb?.appUrl ?? getAppUrl()}/dashboard`;

  // Render email HTML
  const { html: emailHtml, text } = await renderEmail(
    createElement(PrepaidLowBalanceEmail, {
      mailBrand: mb,
      locale,
      recipientName,
      clientName,
      packageName,
      remainingHours,
      totalHours,
      percentageRemaining,
      dashboardUrl,
      portalUrl: brandUrl(portalUrl, mb),
      recipient,
      senderName,
      senderEmail,
    }),
  );

  const subject = t("low.subject", { client: clientName });

  // Send email via Resend with structured logging
  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        text,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType: "low_balance_alert", clientId } : undefined,
  );
}

export async function sendExpiryWarning({
  to,
  recipientName,
  clientName,
  packageName,
  remainingHours,
  expiryDate,
  daysUntilExpiry,
  userId,
  clientId,
  portalUrl = null,
  recipient,
  senderName,
  senderEmail,
}: SendExpiryWarningParams) {
  // Kundemodtagere får afsenderens (kontoens) brand.
  const mb = await resolveMailBrand({
    userId,
    email: recipient === "client" ? senderEmail : to,
  });
  const logContext = {
    emailType: "expiry_warning" as const,
    to,
    clientName,
    packageName,
    remainingHours,
    daysUntilExpiry,
  };

  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsBilling", locale, mb?.key);

  // Skabelonen bygger `${dashboardUrl}/klippekort` — uden /dashboard endte
  // knappen på den offentlige klippekort-landingsside.
  const dashboardUrl = `${mb?.appUrl ?? getAppUrl()}/dashboard`;

  // Render email HTML
  const { html: emailHtml, text } = await renderEmail(
    createElement(PrepaidExpiryEmail, {
      mailBrand: mb,
      locale,
      recipientName,
      clientName,
      packageName,
      remainingHours,
      expiryDate,
      daysUntilExpiry,
      dashboardUrl,
      portalUrl: brandUrl(portalUrl, mb),
      recipient,
      senderName,
      senderEmail,
    }),
  );

  const subject = t("expiry.subject", {
    package: packageName,
    client: clientName,
    phrase: prepaidExpiryMailPhrase(daysUntilExpiry, locale),
  });

  // Send email via Resend with structured logging
  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        text,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType: "expiry_warning", clientId } : undefined,
  );
}
