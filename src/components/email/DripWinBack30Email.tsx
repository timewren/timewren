import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import type { DemoCurrency } from "@/lib/demo/demo-mode";
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

interface DripWinBack30EmailProps {
  userName: string;
  unbilledHours?: number;
  unbilledValue?: number;
  pendingTasks?: number;
  dashboardUrl?: string;
  locale?: string;
  currencyCode?: DemoCurrency;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function DripWinBack30Email({
  mailBrand,
  userName,
  unbilledHours,
  unbilledValue,
  pendingTasks,
  dashboardUrl = mailBrand
    ? `${mailBrand.dashboardUrl}`
    : "https://timetrack.dk/dashboard",
  locale = "da",
  currencyCode = "DKK",
}: DripWinBack30EmailProps) {
  const t = mailT("emailsDrip", locale, mailBrand?.key);
  const intl = toIntlLocale(locale);
  const kroner = new Intl.NumberFormat(intl, {
    style: "currency",
    currency: currencyCode,
  });
  const hoursFormat = new Intl.NumberFormat(intl, { maximumFractionDigits: 2 });
  const showHours = (unbilledHours ?? 0) > 0;
  const showValue = (unbilledValue ?? 0) > 0;
  const showTasks = (pendingTasks ?? 0) > 0;
  const hasData = showHours || showTasks;

  return (
    <PersonalEmailLayout
      mailBrand={mailBrand}
      locale={locale}
      preview={t("winBack30.preview", { name: userName })}
      showReplyCta={false}
    >
      <Text style={personalText}>{t("greeting", { name: userName })}</Text>

      <Text style={personalText}>{t("winBack30.intro")}</Text>

      {hasData && (
        <>
          <Text style={personalText}>{t("winBack30.stillThere")}</Text>
          <PersonalBox>
            {showHours && (
              <Text
                style={
                  showTasks
                    ? personalBoxItem
                    : { ...personalBoxItem, margin: 0 }
                }
              >
                {mailMarkup(
                  showValue
                    ? t("winBack30.hoursValue", {
                        hours: hoursFormat.format(unbilledHours ?? 0),
                        value: kroner.format(unbilledValue ?? 0),
                      })
                    : t("winBack30.hoursOnly", {
                        hours: hoursFormat.format(unbilledHours ?? 0),
                      }),
                )}
              </Text>
            )}
            {showTasks && (
              <Text style={{ ...personalBoxItem, margin: 0 }}>
                {mailMarkup(t("winBack30.tasks", { count: pendingTasks ?? 0 }))}
              </Text>
            )}
          </PersonalBox>
        </>
      )}

      <Text style={personalText}>{t("winBack30.how")}</Text>

      <PersonalButton href={dashboardUrl}>{t("openApp")}</PersonalButton>

      <Text style={personalText}>{t("winBack30.why")}</Text>
    </PersonalEmailLayout>
  );
}

export default DripWinBack30Email;
