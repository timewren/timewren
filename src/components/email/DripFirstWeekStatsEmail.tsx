import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { EmailKeyValue } from "./EmailShell";
import { mailMarkup } from "./mail-markup";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalText,
} from "./PersonalEmailLayout";

interface DripFirstWeekStatsEmailProps {
  userName: string;
  totalHoursTracked: number;
  clientCount: number;
  projectCount: number;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripFirstWeekStatsEmail({
  mailBrand,
  userName,
  totalHoursTracked,
  clientCount,
  projectCount,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripFirstWeekStatsEmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const isMinimalUsage = totalHoursTracked < 2;
  const hours = new Intl.NumberFormat(toIntlLocale(locale), {
    maximumFractionDigits: 2,
  }).format(totalHoursTracked);

  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("firstWeek.preview")}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      {isMinimalUsage ? (
        <>
          <Text style={personalText}>{t("firstWeek.minimal1")}</Text>

          <Text style={personalText}>{t("firstWeek.minimal2")}</Text>

          <PersonalBox>
            <Text style={{ ...personalBoxItem, margin: 0 }}>
              {mailMarkup(t("firstWeek.tip"))}
            </Text>
          </PersonalBox>
        </>
      ) : (
        <>
          <Text style={personalText}>{t("firstWeek.active")}</Text>

          <EmailKeyValue
            rows={[
              {
                label: t("firstWeek.trackedTime"),
                value: t("firstWeek.hoursUnit", { hours }),
              },
              { label: t("firstWeek.clients"), value: clientCount },
              { label: t("firstWeek.projects"), value: projectCount },
            ]}
          />

          <Text style={personalText}>{t("firstWeek.closing")}</Text>
        </>
      )}

      <PersonalButton href={dashboardUrl}>{t("openApp")}</PersonalButton>

      <Text style={personalText}>{t("firstWeek.feedback")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripFirstWeekStatsEmail;
