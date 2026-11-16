import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { EmailButton, EmailShell, emailText } from "./EmailShell";

interface EndOfDayEmailProps {
  title: string;
  body: string;
  timeUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/** Dagsoversigten, når brugeren har slået den til som mail. */
export function EndOfDayEmail({
  title,
  body,
  timeUrl,
  locale = "da",
  mailBrand,
}: EndOfDayEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={body}
      kicker={t("endOfDay.kicker")}
      heading={title}
      footerNote={t("endOfDay.footerNote")}
      showSettingsLink
    >
      <Text style={emailText}>{body}</Text>
      <EmailButton href={timeUrl}>{t("endOfDay.button")}</EmailButton>
    </EmailShell>
  );
}

export default EndOfDayEmail;
