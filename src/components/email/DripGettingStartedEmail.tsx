import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { mailMarkup } from "./mail-markup";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalText,
} from "./PersonalEmailLayout";

interface DripGettingStartedEmailProps {
  userName: string;
  hasClient: boolean;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripGettingStartedEmail({
  mailBrand,
  userName,
  hasClient,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripGettingStartedEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const prefix = hasClient
    ? "gettingStarted.hasClient"
    : "gettingStarted.noClient";
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("gettingStarted.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>
        {t(
          hasClient
            ? "gettingStarted.hasClientIntro"
            : "gettingStarted.noClientIntro",
        )}
      </Text>

      <PersonalBox>
        <Text style={personalBoxItem}>{mailMarkup(t(`${prefix}1`))}</Text>
        <Text style={personalBoxItem}>{mailMarkup(t(`${prefix}2`))}</Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {mailMarkup(t(`${prefix}3`))}
        </Text>
      </PersonalBox>

      <PersonalButton
        href={
          hasClient
            ? `${dashboardUrl}/projects/new`
            : `${dashboardUrl}/clients/new`
        }
      >
        {t(
          hasClient
            ? "gettingStarted.buttonProject"
            : "gettingStarted.buttonClient",
        )}
      </PersonalButton>

      <Text style={personalText}>{t("gettingStarted.stuck")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripGettingStartedEmail;
