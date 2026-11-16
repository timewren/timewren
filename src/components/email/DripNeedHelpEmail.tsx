import { Link, Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  PersonalBox,
  PersonalButton,
  PersonalEmailLayout,
  personalBoxItem,
  personalLink,
  personalText,
} from "./PersonalEmailLayout";

interface DripNeedHelpEmailProps {
  userName: string;
  hasTimeEntries: boolean;
  dashboardUrl?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripNeedHelpEmail({
  mailBrand,
  userName,
  hasTimeEntries,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
}: DripNeedHelpEmailProps) {
  // Mads skriver fra TimeTrack; TimeWren-konti får brandets supportadresse.
  const personalEmail =
    mailBrand?.brand.supportEmail ?? buildBrand.contactEmail;
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("needHelp.preview", { name: userName })}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>
        {t(
          hasTimeEntries
            ? "needHelp.introTracking"
            : "needHelp.introNoTracking",
        )}
      </Text>

      <Text style={personalText}>
        {t(
          hasTimeEntries
            ? "needHelp.placesTracking"
            : "needHelp.placesNoTracking",
        )}
      </Text>

      <PersonalBox>
        <Text style={personalBoxItem}>
          <Link href={`${dashboardUrl}/help`} style={personalLink}>
            {t("needHelp.helpCentre")}
          </Link>
          {t("needHelp.helpCentreNote")}
        </Text>
        <Text style={personalBoxItem}>
          <Link href={`${dashboardUrl}/clients/new`} style={personalLink}>
            {t("needHelp.createClient")}
          </Link>
          {t("needHelp.createClientNote")}
        </Text>
        <Text style={{ ...personalBoxItem, margin: 0 }}>
          <Link href={`mailto:${personalEmail}`} style={personalLink}>
            {t("needHelp.writeMe")}
          </Link>
          {t("needHelp.writeMeNote")}
        </Text>
      </PersonalBox>

      <PersonalButton href={dashboardUrl}>{t("openApp")}</PersonalButton>

      <Text style={personalText}>{t("needHelp.missing")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripNeedHelpEmail;
