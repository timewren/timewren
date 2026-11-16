import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailKeyValue,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";

interface DataExportReadyEmailProps {
  recipientName: string;
  downloadUrl: string;
  expiresAt: string;
  format: string;
  /**
   * "organization" = fuld eksport af hele organisationen (ZIP),
   * "user" = brugerens egne data (ZIP), "personal" = den gamle JSON/CSV.
   */
  scope?: "personal" | "organization" | "user";
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DataExportReadyEmail({
  recipientName,
  downloadUrl,
  expiresAt,
  format,
  scope = "personal",
  locale = "da",
  mailBrand,
}: DataExportReadyEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const expires = new Date(expiresAt).toLocaleDateString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
  const values = { brand: brand.name };

  if (scope === "organization") {
    return (
      <EmailShell
        mailBrand={mailBrand}
        locale={locale}
        preview={t("export.orgPreview")}
        kicker={t("export.kicker")}
        heading={t("export.orgHeading")}
        footerNote={t("export.orgFooter", values)}
      >
        <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
        <Text style={emailText}>{t("export.orgBody")}</Text>
        <EmailKeyValue
          rows={[
            { label: t("export.rowFormat"), value: "ZIP" },
            { label: t("export.rowExpires"), value: expires, strong: true },
          ]}
        />
        <EmailButton href={downloadUrl}>{t("export.orgDownload")}</EmailButton>
        <Text style={emailMuted}>{t("export.orgMuted", values)}</Text>
      </EmailShell>
    );
  }

  if (scope === "user") {
    return (
      <EmailShell
        mailBrand={mailBrand}
        locale={locale}
        preview={t("export.userPreview")}
        kicker={t("export.kicker")}
        heading={t("export.userHeading")}
        footerNote={t("export.userFooter", values)}
      >
        <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
        <Text style={emailText}>{t("export.userBody")}</Text>
        <EmailKeyValue
          rows={[
            { label: t("export.rowFormat"), value: "ZIP" },
            { label: t("export.rowExpires"), value: expires, strong: true },
          ]}
        />
        <EmailButton href={downloadUrl}>{t("export.userDownload")}</EmailButton>
        <Text style={emailMuted}>{t("export.userMuted", values)}</Text>
      </EmailShell>
    );
  }

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("export.personalPreview")}
      kicker={t("export.kicker")}
      heading={t("export.personalHeading")}
      footerNote={t("export.personalFooter")}
    >
      <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
      <Text style={emailText}>{t("export.personalBody")}</Text>
      <EmailKeyValue
        rows={[
          { label: t("export.rowFormat"), value: format.toUpperCase() },
          { label: t("export.rowExpires"), value: expires, strong: true },
        ]}
      />
      <EmailButton href={downloadUrl}>{t("export.userDownload")}</EmailButton>
      <Text style={emailMuted}>{t("export.personalMuted")}</Text>
    </EmailShell>
  );
}

export default DataExportReadyEmail;
