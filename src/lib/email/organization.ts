import { render } from "@react-email/render";
import { createElement } from "react";
import { OrganizationInviteEmail } from "@/components/email/OrganizationInviteEmail";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { withEmailLogging } from "./logger";

interface OrganizationInviteEmailParams {
  to: string;
  inviterName: string;
  organizationName: string;
  inviteUrl: string;
  role: string;
  userId?: string;
  /** organizations.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendOrganizationInviteEmail({
  to,
  inviterName,
  organizationName,
  inviteUrl,
  role,
  userId,
  brand,
}: OrganizationInviteEmailParams) {
  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const mb = await resolveMailBrand({ brand, userId });
  const locale = await getRecipientLocale({
    userId: userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsAuth", locale, mb?.key);

  const emailHtml = await render(
    createElement(OrganizationInviteEmail, {
      inviterName,
      organizationName,
      inviteUrl,
      role,
      locale,
      mailBrand: mb,
    }),
  );

  const subject = t("orgInvite.subject", {
    inviter: inviterName,
    org: organizationName,
  });

  return withEmailLogging(
    { emailType: "organization_invite", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send organization invite email");
      }

      return response;
    },
    userId ? { userId, emailType: "organization_invite" } : undefined,
  );
}
