import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailFallbackLink,
  EmailShell,
  emailText,
} from "./EmailShell";

interface PasswordResetEmailProps {
  userName: string;
  resetUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PasswordResetEmail({
  userName,
  resetUrl,
  locale = "da",
  mailBrand,
}: PasswordResetEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("passwordReset.preview", { brand: brand.name })}
      kicker={t("passwordReset.kicker")}
      heading={t("passwordReset.heading")}
      footerNote={t("passwordReset.footerNote")}
    >
      <Text style={emailText}>
        {t("passwordReset.greeting", { name: userName })}
      </Text>
      <Text style={emailText}>{t("passwordReset.body")}</Text>
      <EmailButton href={resetUrl}>{t("passwordReset.button")}</EmailButton>
      <Text style={emailText}>{t("passwordReset.ignore")}</Text>
      <EmailFallbackLink href={resetUrl} locale={locale} />
    </EmailShell>
  );
}

export default PasswordResetEmail;
