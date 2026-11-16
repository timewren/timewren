import { render } from "@react-email/render";
import { createElement } from "react";
import { PortalInvitationEmail } from "@/components/email/PortalInvitationEmail";
import { mailT } from "@/lib/email/locale";
import { brandUrl, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";

interface SendPortalInvitationEmailParams {
  to: string;
  clientName: string;
  senderName: string;
  senderEmail: string;
  portalUrl: string;
  accessType: "account" | "token";
  loginEmail?: string;
  userId?: string;
  clientId?: string;
}

export async function sendPortalInvitationEmail({
  to,
  clientName,
  senderName,
  senderEmail,
  portalUrl,
  accessType,
  loginEmail,
  userId,
  clientId,
}: SendPortalInvitationEmailParams) {
  const mb = await resolveMailBrand({ userId });
  const logContext = {
    emailType: "portal_invitation" as const,
    to,
    clientName,
  };

  if (!isMailAvailable()) {
    logEmailSkipped(logContext, "RESEND_API_KEY not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  // Kunden har ingen profil: mailen følger afsenderens sprog.
  const locale = await getRecipientLocale({
    userId,
    fallback: mb?.locale,
  });
  const t = mailT("emailsAuth", locale, mb?.key);

  const emailHtml = await render(
    createElement(PortalInvitationEmail, {
      mailBrand: mb,
      clientName,
      senderName,
      senderEmail,
      portalUrl: brandUrl(portalUrl, mb),
      accessType,
      loginEmail,
      locale,
    }),
  );

  const subject = t("portalInvite.subject", { sender: senderName });

  return withEmailLogging(
    { ...logContext, subject },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        replyTo: senderEmail,
      });

      if (response.error) {
        throw new Error(`Resend API error: ${JSON.stringify(response.error)}`);
      }

      return response;
    },
    userId ? { userId, emailType: "portal_invitation", clientId } : undefined,
  );
}
