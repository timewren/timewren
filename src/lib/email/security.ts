import { render } from "@react-email/render";
import { createElement } from "react";
import { NewLoginEmail } from "@/components/email/NewLoginEmail";
import { PasswordChangedEmail } from "@/components/email/PasswordChangedEmail";
import { TwoFactorCodeEmail } from "@/components/email/TwoFactorCodeEmail";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { appUrlEnv } from "@/lib/runtime-env";
import { withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface PasswordChangedEmailParams {
  to: string;
  userName: string;
  changedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  userId?: string;
  /** users.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendPasswordChangedEmail({
  to,
  userName,
  changedAt,
  ipAddress,
  userAgent,
  userId,
  brand,
}: PasswordChangedEmailParams) {
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
  const dashboardUrl = mb?.dashboardUrl ?? `${appUrlEnv()}/dashboard`;

  const { html: emailHtml, text } = await renderEmail(
    createElement(PasswordChangedEmail, {
      locale,
      userName,
      changedAt,
      ipAddress,
      userAgent,
      dashboardUrl,
      mailBrand: mb,
    }),
  );

  const subject = t("passwordChanged.subject");

  return withEmailLogging(
    { emailType: "password_changed", to, subject, userId },
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
        throw new Error("Failed to send password changed email");
      }

      return response;
    },
    userId ? { userId, emailType: "password_changed" } : undefined,
  );
}

interface NewLoginEmailParams {
  to: string;
  userName: string;
  loginAt: Date;
  ipAddress?: string;
  userAgent?: string;
  location?: string;
  userId?: string;
  /** users.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendNewLoginEmail({
  to,
  userName,
  loginAt,
  ipAddress,
  userAgent,
  location,
  userId,
  brand,
}: NewLoginEmailParams) {
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
  const dashboardUrl = mb?.dashboardUrl ?? `${appUrlEnv()}/dashboard`;

  const { html: emailHtml, text } = await renderEmail(
    createElement(NewLoginEmail, {
      locale,
      userName,
      loginAt,
      ipAddress,
      userAgent,
      location,
      dashboardUrl,
      mailBrand: mb,
    }),
  );

  const subject = t("newLogin.subject");

  return withEmailLogging(
    { emailType: "new_login", to, subject, userId },
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
        throw new Error("Failed to send new login email");
      }

      return response;
    },
    userId ? { userId, emailType: "new_login" } : undefined,
  );
}

interface TwoFactorCodeEmailParams {
  to: string;
  userName: string;
  code: string;
  userId?: string;
  /** users.brand, hvis kendt (null = standard). Udeladt = slås op. */
  brand?: string | null;
}

export async function sendTwoFactorCodeEmail({
  to,
  userName,
  code,
  userId,
  brand,
}: TwoFactorCodeEmailParams) {
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
    createElement(TwoFactorCodeEmail, {
      locale,
      userName,
      code,
      mailBrand: mb,
    }),
  );

  const subject = t("twoFactor.subject", { code });

  return withEmailLogging(
    { emailType: "two_factor_code", to, subject, userId },
    async () => {
      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html: emailHtml,
      });

      if (response.error) {
        console.error("Resend error:", response.error);
        throw new Error("Failed to send 2FA code email");
      }

      return response;
    },
    userId ? { userId, emailType: "two_factor_code" } : undefined,
  );
}
