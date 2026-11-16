import { createElement } from "react";
import { ImportCompleteEmail } from "@/components/email/ImportCompleteEmail";
import { getAppUrl } from "@/lib/config";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import { withEmailLogging } from "./logger";
import { renderEmail } from "./render-email";

interface SendImportCompleteEmailParams {
  to: string;
  userName: string;
  userId: string;
  status: "completed" | "completed_with_errors" | "failed";
  importedEntries: number;
  skippedEntries: number;
  failedEntries: number;
  totalEntries: number;
  source: string;
}

export async function sendImportCompleteEmail({
  to,
  userName,
  userId,
  status,
  importedEntries,
  skippedEntries,
  failedEntries,
  totalEntries,
  source,
}: SendImportCompleteEmailParams) {
  const mb = await resolveMailBrand({ userId, email: to });
  const locale = await getRecipientLocale({
    userId,
    email: to,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const statusLabel =
    status === "completed"
      ? t("import.statusCompleted")
      : status === "completed_with_errors"
        ? t("import.statusErrors")
        : t("import.statusFailed");

  const subject = t("import.subject", {
    status: statusLabel,
    count: importedEntries,
    source,
  });

  const { html, text } = await renderEmail(
    createElement(ImportCompleteEmail, {
      mailBrand: mb,
      locale,
      userName,
      statusLabel,
      status,
      source,
      importedEntries,
      skippedEntries,
      failedEntries,
      totalEntries,
      timeUrl: `${mb?.appUrl ?? getAppUrl()}/dashboard/time`,
    }),
  );

  return withEmailLogging(
    {
      emailType: "import_complete",
      to,
      userId,
    },
    async () => {
      const result = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to,
        subject,
        html,
        text,
      });
      return { id: result.data?.id ?? "unknown" };
    },
  );
}
