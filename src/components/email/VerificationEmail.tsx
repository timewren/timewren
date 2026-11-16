import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailFallbackLink,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";

interface VerificationEmailProps {
  name: string;
  verificationUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function VerificationEmail({
  name,
  verificationUrl,
  locale = "da",
  mailBrand,
}: VerificationEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("verification.preview")}
      kicker={t("verification.kicker")}
      heading={t("verification.heading")}
      footerNote={t("verification.footerNote", { brand: brand.name })}
    >
      <Text style={emailText}>
        {name
          ? t("verification.greeting", { name })
          : t("verification.greetingFallback")}
      </Text>
      <Text style={emailText}>{t("verification.body")}</Text>
      <EmailButton href={verificationUrl}>
        {t("verification.button")}
      </EmailButton>
      <Text style={emailMuted}>{t("verification.ignore")}</Text>
      <EmailFallbackLink href={verificationUrl} locale={locale} />
    </EmailShell>
  );
}

export default VerificationEmail;
