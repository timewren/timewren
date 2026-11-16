import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface ImportCompleteEmailProps {
  userName: string;
  statusLabel: string;
  status: "completed" | "completed_with_errors" | "failed";
  source: string;
  importedEntries: number;
  skippedEntries: number;
  failedEntries: number;
  totalEntries: number;
  timeUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** Besked når en import af tidsregistreringer (fx fra Toggl) er færdig. */
export function ImportCompleteEmail({
  userName,
  statusLabel,
  status,
  source,
  importedEntries,
  skippedEntries,
  failedEntries,
  totalEntries,
  timeUrl,
  locale = "da",
  mailBrand,
}: ImportCompleteEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const n = (v: number) => v.toLocaleString(toIntlLocale(locale));
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("import.preview", {
        status: statusLabel,
        count: n(importedEntries),
        source,
      })}
      kicker={t("import.kicker")}
      heading={statusLabel}
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>{mailMarkup(t("import.body", { source }))}</Text>
      {status !== "completed" && (
        <EmailCallout tone={status === "failed" ? "danger" : "warning"}>
          {status === "failed"
            ? t("import.failed", {
                email: brand.contactEmail,
              })
            : t("import.partial")}
        </EmailCallout>
      )}
      <EmailKeyValue
        rows={[
          { label: t("import.rowImported"), value: n(importedEntries) },
          ...(skippedEntries > 0
            ? [{ label: t("import.rowSkipped"), value: n(skippedEntries) }]
            : []),
          ...(failedEntries > 0
            ? [{ label: t("import.rowFailed"), value: n(failedEntries) }]
            : []),
          { label: t("import.rowTotal"), value: n(totalEntries), strong: true },
        ]}
      />
      <EmailButton href={timeUrl}>{t("import.button")}</EmailButton>
    </EmailShell>
  );
}

export default ImportCompleteEmail;
