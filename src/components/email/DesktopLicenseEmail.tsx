import { Link, Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL, MAIL_FONT_MONO } from "./brand";
import {
  EmailKeyValue,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface DesktopLicenseEmailProps {
  name?: string | null;
  licenseKey: string;
  tierLabel: string;
  maxDevices: number;
  appUrl: string;
  locale?: string;
  /** TimeWren: brandets afsender, logo og tekster (udeladt = TimeTrack). */
  mailBrand?: MailBrand;
}

/** Licensnøglen til TimeTrack Desktop efter køb eller "send min nøgle igen". */
export function DesktopLicenseEmail({
  name,
  licenseKey,
  tierLabel,
  maxDevices,
  appUrl,
  locale = "da",
  mailBrand,
}: DesktopLicenseEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const host = appUrl.replace(/^https?:\/\//, "");
  // Both brands have a download page (TimeWren's app URL is its marketing
  // host). TimeWren has no refund page: refunds go by mail to support.
  const timewren = mailBrand?.key === "timewren";
  const supportEmail = mailBrand?.brand.supportEmail ?? "";
  const downloadHref = `${appUrl}/download`;
  const downloadLabel = `${host}/download`;
  return (
    <EmailShell
      locale={locale}
      mailBrand={mailBrand}
      preview={t("desktopLicense.preview", { tier: tierLabel })}
      kicker={t("desktopLicense.kicker")}
      heading={t("desktopLicense.heading")}
      footerNote={t("desktopLicense.footerNote")}
    >
      <Text style={emailText}>
        {name
          ? t("desktopLicense.introNamed", { name, tier: tierLabel })
          : t("desktopLicense.intro", { tier: tierLabel })}
      </Text>
      <Text
        style={{
          backgroundColor: MAIL.surface,
          borderRadius: "8px",
          color: MAIL.text,
          fontFamily: MAIL_FONT_MONO,
          fontSize: "22px",
          fontWeight: 700,
          lineHeight: "30px",
          margin: "0 0 20px 0",
          padding: "16px",
          textAlign: "center",
        }}
      >
        {licenseKey}
      </Text>
      <Text style={{ ...emailText, fontWeight: 700, margin: "0 0 4px" }}>
        {t("desktopLicense.howTo")}
      </Text>
      <EmailKeyValue
        rows={[
          {
            label: t("desktopLicense.step1"),
            value: (
              <Link href={downloadHref} style={emailLink}>
                {downloadLabel}
              </Link>
            ),
          },
          {
            label: t("desktopLicense.step2"),
            value: t("desktopLicense.step2Value"),
          },
          {
            label: t("desktopLicense.step3"),
            value: t("desktopLicense.step3Value"),
          },
        ]}
      />
      <Text style={emailMuted}>
        {t("desktopLicense.keep", { max: maxDevices })}
      </Text>
      <Text style={emailMuted}>
        {timewren
          ? mailMarkup(
              t("desktopLicense.refundByMail", { email: supportEmail }),
              {
                refund: (label) => (
                  <Link href={`mailto:${supportEmail}`} style={emailLink}>
                    {label}
                  </Link>
                ),
              },
            )
          : mailMarkup(
              t("desktopLicense.refund", { link: `${host}/desktop/refund` }),
              {
                refund: (label) => (
                  <Link href={`${appUrl}/desktop/refund`} style={emailLink}>
                    {label}
                  </Link>
                ),
              },
            )}
      </Text>
    </EmailShell>
  );
}

export default DesktopLicenseEmail;
