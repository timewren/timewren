import { Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailKeyValue,
  EmailKlippekort,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";
import { parseHours } from "./PrepaidLowBalanceEmail";

interface AluntaKlippekortCreatedEmailProps {
  userName: string;
  clientName: string;
  hours: string;
  hourlyRate: string;
  expiryDate?: string;
  planName: string;
  dashboardUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * Timeprisen kommer som et rent tal ("850"); skriv den med enhed. En tekst
 * der allerede har enhed ("850 kr") vises, som den er.
 */
function formatRate(raw: string, locale: string): string {
  const t = mailT("emailsBilling", locale);
  const value = raw.trim();
  if (!/^\d+([.,]\d+)?$/.test(value)) return raw;
  const n = Number(value.replace(",", "."));
  const formatted = new Intl.NumberFormat(toIntlLocale(locale), {
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(n);
  return t("alunta.rateValue", { rate: formatted });
}

export function AluntaKlippekortCreatedEmail({
  userName,
  clientName,
  hours,
  hourlyRate,
  expiryDate,
  planName,
  dashboardUrl,
  locale = "da",
  mailBrand,
}: AluntaKlippekortCreatedEmailProps) {
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  // Et nyt kort er urørt: alle huller åbne, hele saldoen tilbage.
  const total = parseHours(hours);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("alunta.preview", {
        client: clientName,
        hours: formatMailHours(total, locale),
      })}
      kicker={t("prepaid.kicker")}
      heading={t("alunta.heading")}
      showSettingsLink
    >
      <Text style={emailText}>{t("greeting", { name: userName })}</Text>
      <Text style={emailText}>
        {mailMarkup(t("alunta.body", { plan: planName }))}
      </Text>
      <EmailKlippekort
        locale={locale}
        name={planName}
        totalHours={total}
        remainingHours={total}
      />
      <EmailKeyValue
        rows={[
          { label: t("alunta.client"), value: clientName },
          { label: t("alunta.rate"), value: formatRate(hourlyRate, locale) },
          ...(expiryDate
            ? [{ label: t("alunta.expires"), value: expiryDate }]
            : []),
        ]}
      />
      <EmailButton href={dashboardUrl}>{t("alunta.button")}</EmailButton>
      <Text style={emailMuted}>{t("alunta.muted")}</Text>
    </EmailShell>
  );
}

export default AluntaKlippekortCreatedEmail;
