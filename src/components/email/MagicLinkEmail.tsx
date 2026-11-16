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

interface MagicLinkEmailProps {
  magicLinkUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function MagicLinkEmail({
  magicLinkUrl,
  locale = "da",
  mailBrand,
}: MagicLinkEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsAuth", locale, mailBrand?.key);
  const values = { brand: brand.name };
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("magicLink.preview", values)}
      kicker={t("magicLink.kicker")}
      heading={t("magicLink.heading", values)}
      footerNote={t("magicLink.footerNote")}
    >
      <Text style={emailText}>{t("magicLink.body")}</Text>
      <EmailButton href={magicLinkUrl}>
        {t("magicLink.button", values)}
      </EmailButton>
      <Text style={emailMuted}>{t("magicLink.ignore")}</Text>
      <EmailFallbackLink href={magicLinkUrl} locale={locale} />
    </EmailShell>
  );
}

export default MagicLinkEmail;
