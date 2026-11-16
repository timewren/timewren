import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailCallout,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface CancellationConfirmedEmailProps {
  userName: string;
  endDate: string;
  reactivateUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function CancellationConfirmedEmail({
  userName,
  endDate,
  reactivateUrl,
  locale = "da",
  mailBrand,
}: CancellationConfirmedEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("cancel.preview", { brand: brand.name })}
      kicker={t("cancel.kicker")}
      heading={t("cancel.heading")}
      footerNote={t("cancel.footerNote")}
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {mailMarkup(t("cancel.body", { brand: brand.name, date: endDate }))}
      </Text>
      <EmailCallout tone="warning" title={t("cancel.calloutTitle")}>
        {t("cancel.calloutBody", { date: endDate })}
      </EmailCallout>
      <Text style={emailText}>{t("cancel.changedMind")}</Text>
      <EmailButton href={reactivateUrl}>{t("cancel.button")}</EmailButton>
      <Text style={emailMuted}>
        {mailMarkup(
          t("cancel.feedback", {
            brand: brand.name,
            email: brand.supportEmail,
          }),
          {
            mail: (label) => (
              <Link href={`mailto:${brand.supportEmail}`} style={emailLink}>
                {label}
              </Link>
            ),
          },
        )}
      </Text>
    </EmailShell>
  );
}

export default CancellationConfirmedEmail;
