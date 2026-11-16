import { Text } from "@react-email/components";
import {
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
} from "@/lib/billing/plan-gate";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalText,
} from "./PersonalEmailLayout";

interface DripUpgradeReminderEmailProps {
  userName: string;
  daysLeft: number;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripUpgradeReminderEmail({
  mailBrand,
  userName,
  daysLeft,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripUpgradeReminderEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  // daysLeft er hele døgn tilbage, så 0 betyder under et døgn.
  const when =
    daysLeft <= 0
      ? t("upgrade.whenNow")
      : t("upgrade.whenDays", { days: daysLeft });

  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("upgrade.preview", { when })}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("upgrade.body", { when })}</Text>

      <PersonalBox>
        <Text style={personalBoxItem}>
          {t("upgrade.free", {
            clients: FREE_MAX_ACTIVE_CLIENTS,
            seats: FREE_MAX_SEATS,
          })}
        </Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          {t("upgrade.paid")}
        </Text>
      </PersonalBox>

      <PersonalButton href={`${dashboardUrl}/settings/subscription`}>
        {t("upgrade.button")}
      </PersonalButton>

      <Text style={personalText}>{t("upgrade.questions")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripUpgradeReminderEmail;
