import { Link, Text } from "@react-email/components";
import { toIntlLocale } from "@/i18n/format-locale";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailLink,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface PrepaidExpiryEmailProps {
  recipientName: string;
  clientName: string;
  packageName: string;
  remainingHours: string;
  expiryDate: string;
  daysUntilExpiry: number;
  dashboardUrl?: string;
  /** Kundens portal-link (#95) — erstatter dashboard-CTA for kunde-modtagere */
  portalUrl?: string | null;
  /**
   * Hvem mailen er til. Kunden får altid kundevarianten — også uden
   * portal-link (ingen aktiv portaladgang), hvor dashboard-knappen ville
   * være en blindgyde. Udeladt: kunde hvis der er et portal-link.
   */
  recipient?: "owner" | "client";
  /** Afsenderen — kunden kan kontakte vedkommende om fornyelse */
  senderName?: string;
  senderEmail?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

/**
 * "udløber i dag" på udløbsdagen — kortet gælder hele dagen (#736).
 * Samme tekster som `prepaidExpiryPhrase`, men i modtagerens sprog; et
 * udløbet kort er "er udløbet".
 */
export function prepaidExpiryMailPhrase(days: number, locale = "da"): string {
  const t = mailT("emailsBilling", locale);
  if (days < 0) return t("expiry.phraseExpired");
  if (days === 0) return t("expiry.phraseToday");
  if (days === 1) return t("expiry.phraseTomorrow");
  return t("expiry.phraseDays", { days });
}

export function PrepaidExpiryEmail({
  mailBrand,
  recipientName,
  clientName,
  packageName,
  remainingHours,
  expiryDate,
  daysUntilExpiry,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  portalUrl = null,
  recipient,
  senderName,
  senderEmail,
  locale = "da",
}: PrepaidExpiryEmailProps) {
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const isCustomer =
    (recipient ?? (portalUrl ? "client" : "owner")) === "client";
  const expiry = new Date(expiryDate).toLocaleDateString(toIntlLocale(locale), {
    timeZone: "Europe/Copenhagen",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const phrase = prepaidExpiryMailPhrase(daysUntilExpiry, locale);
  // Saldoen kommer som tekst ("4.50" fra toFixed); vis den efter sprogets regler.
  // (Lokal omregning: PrepaidLowBalanceEmail importerer herfra.)
  const remaining = Number.parseFloat(remainingHours.replace(",", "."));
  const remainingLabel = t("prepaid.hoursUnit", {
    hours: Number.isFinite(remaining)
      ? formatMailHours(remaining, locale)
      : remainingHours,
  });

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={`${packageName} ${phrase}`}
      kicker={t("prepaid.kicker")}
      heading={t("expiry.heading", { phrase })}
      footerNote={
        isCustomer
          ? t("prepaid.footerClient", {
              client: clientName,
              sender: senderName ?? t("prepaid.fallbackSender"),
            })
          : undefined
      }
      showSettingsLink={!isCustomer}
    >
      <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
      <Text style={emailText}>
        {mailMarkup(
          t("expiry.body", {
            package: packageName,
            client: clientName,
            phrase,
          }),
        )}
      </Text>
      <EmailKeyValue
        rows={[
          { label: t("expiry.rowPackage"), value: packageName },
          { label: t("expiry.rowExpires"), value: expiry, strong: true },
          { label: t("expiry.rowRemaining"), value: remainingLabel },
        ]}
      />
      {isCustomer ? (
        <>
          <Text style={emailText}>
            {portalUrl
              ? t("expiry.clientWithPortal")
              : t("expiry.clientNoPortal")}
          </Text>
          {portalUrl ? (
            <EmailButton href={portalUrl}>
              {t("prepaid.renewButton")}
            </EmailButton>
          ) : (
            <PrepaidContactLine
              senderName={senderName}
              senderEmail={senderEmail}
              locale={locale}
            />
          )}
        </>
      ) : (
        <>
          <EmailCallout tone="warning">
            {t("expiry.ownerCallout", { date: expiry })}
          </EmailCallout>
          <EmailButton href={`${dashboardUrl}/klippekort`}>
            {t("expiry.ownerButton")}
          </EmailButton>
        </>
      )}
    </EmailShell>
  );
}

/** Kundevariant uden portal: hvem kunden skal skrive til om fornyelse. */
export function PrepaidContactLine({
  senderName,
  senderEmail,
  locale = "da",
}: {
  senderName?: string;
  senderEmail?: string;
  locale?: string;
}) {
  const t = mailT("emailsBilling", locale);
  if (!senderName) return null;
  return (
    <Text style={emailText}>
      {senderEmail
        ? mailMarkup(
            t("prepaid.contactLineEmail", {
              sender: senderName,
              email: senderEmail,
            }),
            {
              mail: (label) => (
                <Link href={`mailto:${senderEmail}`} style={emailLink}>
                  {label}
                </Link>
              ),
            },
          )
        : t("prepaid.contactLine", { sender: senderName })}
    </Text>
  );
}

export default PrepaidExpiryEmail;
