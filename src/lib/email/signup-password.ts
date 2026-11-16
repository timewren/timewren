import { render } from "@react-email/render";
import { createElement } from "react";
import { SignupPasswordEmail } from "@/components/email/SignupPasswordEmail";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";

interface SignupPasswordEmailParams {
  to: string;
  name: string;
  password: string;
}

export async function sendSignupPasswordEmail({
  to,
  name,
  password,
}: SignupPasswordEmailParams) {
  const mb = await resolveMailBrand({ email: to });
  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  const locale = await getRecipientLocale({
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsAuth", locale, mb?.key);
  const dashboardUrl = `${mb?.appUrl ?? appUrlEnv()}/dashboard`;
  const loginUrl = `${mb?.appUrl ?? appUrlEnv()}/login`;

  // Render email HTML
  const emailHtml = await render(
    createElement(SignupPasswordEmail, {
      mailBrand: mb,
      userName: name,
      password,
      dashboardUrl,
      loginUrl,
      locale,
    }),
  );

  // Send email via Resend
  try {
    const response = await resend.emails.send({
      from: mb?.from ?? DEFAULT_FROM_EMAIL,
      to,
      subject: t("signupPassword.subject"),
      html: emailHtml,
    });

    if (response.error) {
      console.error("Resend error:", response.error);
      throw new Error("Failed to send signup password email");
    }

    return response;
  } catch (error) {
    console.error("Signup password email error:", error);
    throw error;
  }
}
