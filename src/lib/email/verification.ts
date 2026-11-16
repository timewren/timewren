import { createElement } from "react";
import { VerificationEmail } from "@/components/email/VerificationEmail";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface VerificationEmailParams {
  to: string;
  name: string;
  verificationUrl: string;
  userId?: string;
  /** users.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendVerificationEmail({
  to,
  name,
  verificationUrl,
  userId,
  brand,
}: VerificationEmailParams) {
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

  const { html: emailHtml, text } = await renderEmail(
    createElement(VerificationEmail, {
      name,
      verificationUrl,
      locale,
      mailBrand: mb,
    }),
  );

  const subject = t("verification.subject");

  return withEmailLogging(
    { emailType: "email_verification", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
        text,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send verification email");
      }

      return response;
    },
    userId ? { userId, emailType: "email_verification" } : undefined,
  );
}
