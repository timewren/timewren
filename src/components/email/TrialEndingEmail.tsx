import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailShell,
  emailLink,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface TrialEndingEmailProps {
  userName: string;
  daysRemaining: number;
  upgradeUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** "i dag" / "om 1 dag" / "om N dage" i modtagerens sprog. */
export function trialWhen(daysRemaining: number, locale = "da"): string {
  const t = mailT("emailsBilling", locale);
  return daysRemaining <= 0
    ? t("trial.whenToday")
    : t("trial.whenDays", { days: daysRemaining });
}

export function TrialEndingEmail({
  userName,
  daysRemaining,
  upgradeUrl,
  locale = "da",
  mailBrand,
}: TrialEndingEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const when = trialWhen(daysRemaining, locale);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("trial.preview", { when })}
      kicker={t("trial.kicker")}
      heading={t("trial.heading")}
      footerNote={t("trial.footerNote")}
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>{mailMarkup(t("trial.expires", { when }))}</Text>
      <Text style={emailText}>{t("trial.afterwards")}</Text>
      <EmailButton href={upgradeUrl}>{t("trial.button")}</EmailButton>
      <Text style={emailMuted}>
        {mailMarkup(t("questions", { email: brand.supportEmail }), {
          mail: (label) => (
            <Link href={`mailto:${brand.supportEmail}`} style={emailLink}>
              {label}
            </Link>
          ),
        })}
      </Text>
    </EmailShell>
  );
}

export default TrialEndingEmail;
