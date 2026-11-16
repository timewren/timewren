import { render } from "@react-email/render";
import { createElement } from "react";
import { MagicLinkEmail } from "@/components/email/MagicLinkEmail";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { withEmailLogging } from "./logger";

interface MagicLinkEmailParams {
  to: string;
  magicLinkUrl: string;
  userId?: string;
  /** users.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendMagicLinkEmail({
  to,
  magicLinkUrl,
  userId,
  brand,
}: MagicLinkEmailParams) {
  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const mb = await resolveMailBrand({ brand, userId, email: to });
  const locale = await getRecipientLocale({
    userId: userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsAuth", locale, mb?.key);

  const emailHtml = await render(
    createElement(MagicLinkEmail, { magicLinkUrl, locale, mailBrand: mb }),
  );

  const subject = t("magicLink.subject");

  return withEmailLogging(
    { emailType: "magic_link", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send magic link email");
      }

      return response;
    },
    userId ? { userId, emailType: "magic_link" } : undefined,
  );
}
