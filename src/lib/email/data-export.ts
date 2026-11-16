import { createElement } from "react";
import { DataExportReadyEmail } from "@/components/email/DataExportReadyEmail";
import { mailT } from "@/lib/email/locale";
import { brandUrl, resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { isMailAvailable } from "@/lib/email/transport";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { logEmailSkipped, withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface SendDataExportReadyParams {
  to: string;
  recipientName: string;
  downloadUrl: string;
  expiresAt: string;
  format: string;
  userId: string;
  /**
   * "organization" = fuld eksport af hele organisationen (ZIP),
   * "user" = brugerens egne data (ZIP), "personal" = den gamle JSON/CSV.
   */
  scope?: "personal" | "organization" | "user";
}

export async function sendDataExportReady({
  to,
  recipientName,
  downloadUrl,
  expiresAt,
  format,
  userId,
  scope = "personal",
}: SendDataExportReadyParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const logContext = {
    emailType: "data_export" as const,
    to,
    format,
  };

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
  const t = mailT("emailsReports", locale, mb?.key);

  const { html: emailHtml, text } = await renderEmail(
    createElement(DataExportReadyEmail, {
      mailBrand: mb,
      recipientName,
      downloadUrl: brandUrl(downloadUrl, mb),
      expiresAt,
      format,
      scope,
      locale,
    }),
  );

  const subject =
    scope === "organization"
      ? t("export.subjectOrg")
      : scope === "user"
        ? t("export.subjectUser")
        : t("export.subjectPersonal");

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
    { userId, emailType: "data_export" },
  );
}
