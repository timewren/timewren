import { render } from "@react-email/render";
import { createElement } from "react";
import { WelcomeEmail } from "@/components/email/WelcomeEmail";
import { mailT } from "@/lib/email/locale";
import { withEmailLogging } from "@/lib/email/logger";
import { mailBrandFor } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";

interface WelcomeEmailParams {
  to: string;
  name: string;
  /** users.brand. Udeladt eller timetrack = som hidtil. */
  brand?: string | null;
  /** Til log og dedup (emailType drip_welcome, som den personlige velkomst). */
  userId?: string;
}

export async function sendWelcomeEmail({
  to,
  name,
  brand: brandKey,
  userId,
}: WelcomeEmailParams) {
  // Kun ikke-standardbrands får en brand-bevidst mail; timetrack er uændret.
  const mb =
    brandKey && brandKey !== "timetrack" ? mailBrandFor(brandKey) : undefined;
  // Check if Resend API key is configured
  if (!isMailAvailable()) {
    console.error("RESEND_API_KEY is not configured");
    throw new Error(
      "Email service not configured. Contact administrator to set up RESEND_API_KEY.",
    );
  }

  // Sproget er modtagerens; uden profilsprog brandets standard (multibrand).
  const locale = await getRecipientLocale({ email: to, fallback: mb?.locale });
  const t = mailT("emailsAuth", locale, mb?.key);
  const dashboardUrl = mb?.dashboardUrl ?? `${appUrlEnv()}/dashboard`;

  // Render email HTML
  const emailHtml = await render(
    createElement(WelcomeEmail, {
      userName: name,
      dashboardUrl,
      locale,
      mailBrand: mb,
    }),
  );

  const subject = t("welcome.subject");

  const send = async () => {
    const response = await resend.emails.send({
      from: mb?.from ?? DEFAULT_FROM_EMAIL,
      to,
      subject,
      html: emailHtml,
    });
    if (response.error) {
      console.error("Resend error:", response.error);
      throw new Error("Failed to send welcome email");
    }
    return response;
  };

  try {
    return userId && mb
      ? await withEmailLogging(
          { emailType: "drip_welcome", to, subject, userId },
          send,
          { userId, emailType: "drip_welcome" },
        )
      : await send();
  } catch (error) {
    console.error("Welcome email error:", error);
    throw error;
  }
}
