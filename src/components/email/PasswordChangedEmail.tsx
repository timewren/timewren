import { Link, Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";
import { calloutLink, describeDevice } from "./NewLoginEmail";

interface PasswordChangedEmailProps {
  userName: string;
  changedAt: Date;
  ipAddress?: string;
  userAgent?: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PasswordChangedEmail({
  mailBrand,
  userName,
  changedAt,
  ipAddress,
  userAgent,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  locale = "da",
}: PasswordChangedEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  const when = changedAt.toLocaleString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("passwordChanged.preview", { brand: brand.name })}
      kicker={t("security.kicker")}
      heading={t("passwordChanged.heading")}
      footerNote={t("security.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>
        {t("security.greeting", { name: userName })}
      </Text>
      <Text style={emailText}>
        {t("passwordChanged.body", { brand: brand.name })}
      </Text>
      <EmailKeyValue
        rows={[
          { label: t("security.time"), value: when, strong: true },
          ...(ipAddress ? [{ label: t("security.ip"), value: ipAddress }] : []),
          {
            label: t("security.device"),
            value: describeDevice(userAgent, locale),
          },
        ]}
      />
      <EmailCallout tone="danger" title={t("security.notYou")}>
        {mailMarkup(
          t("passwordChanged.calloutBody", { email: brand.supportEmail }),
          {
            mail: (text) => (
              <Link href={`mailto:${brand.supportEmail}`} style={calloutLink}>
                {text}
              </Link>
            ),
          },
        )}
      </EmailCallout>
      <EmailButton href={`${dashboardUrl}/settings`}>
        {t("security.openSettings")}
      </EmailButton>
    </EmailShell>
  );
}

export default PasswordChangedEmail;
