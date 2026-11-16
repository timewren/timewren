import { Link, Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalButton,
  PersonalEmailLayout,
  personalLink,
  personalText,
} from "./PersonalEmailLayout";

interface DripWinBack60EmailProps {
  userName: string;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripWinBack60Email({
  mailBrand,
  userName,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripWinBack60EmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("winBack60.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("winBack60.intro")}</Text>

      <PersonalButton href={dashboardUrl}>
        {t("winBack60.button")}
      </PersonalButton>

      <Text style={personalText}>
        {mailMarkup(t("winBack60.export"), {
          export: (label) => (
            <Link href={`${dashboardUrl}/settings/data`} style={personalLink}>
              {label}
            </Link>
          ),
        })}
      </Text>

      <Text style={personalText}>{t("winBack60.feedback")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripWinBack60Email;
