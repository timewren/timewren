import { Text } from "@react-email/components";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL_DASHBOARD_URL } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKlippekort,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";
import { PrepaidContactLine } from "./PrepaidExpiryEmail";

interface PrepaidLowBalanceEmailProps {
  recipientName: string;
  clientName: string;
  packageName: string;
  remainingHours: string;
  totalHours: string;
  percentageRemaining: number;
  dashboardUrl?: string;
  /** Kundens portal-link (#95) — erstatter dashboard-CTA for kunde-modtagere */
  portalUrl?: string | null;
  /**
   * Hvem mailen er til. Kunden får altid kundevarianten — også uden
   * portal-link (ingen aktiv portaladgang), hvor dashboard-knappen ville
   * være en blindgyde. Udeladt: kunde hvis der er et portal-link.
   */
  recipient?: "owner" | "client";
  /** Freelanceren — kunden kan kontakte vedkommende om fornyelse */
  senderName?: string;
  senderEmail?: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function PrepaidLowBalanceEmail({
  mailBrand,
  recipientName,
  clientName,
  packageName,
  remainingHours,
  totalHours,
  percentageRemaining,
  dashboardUrl = mailBrand?.dashboardUrl ?? MAIL_DASHBOARD_URL,
  portalUrl = null,
  recipient,
  senderName,
  senderEmail,
  locale = "da",
}: PrepaidLowBalanceEmailProps) {
  const t = mailT("emailsBilling", locale, mailBrand?.key);
  const isCustomer =
    (recipient ?? (portalUrl ? "client" : "owner")) === "client";
  // Saldoen kommer som tekst ("3.50" fra toFixed); vis den efter sprogets
  // regler ("3,5 t") og giv hullerne et tal.
  const remaining = parseHours(remainingHours);
  const total = parseHours(totalHours);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("low.preview", {
        remaining: formatMailHours(remaining, locale),
        package: packageName,
      })}
      kicker={t("prepaid.kicker")}
      heading={t("low.heading")}
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
          t("low.body", {
            remaining: formatMailHours(remaining, locale),
            total: formatMailHours(total, locale),
            package: packageName,
            client: clientName,
            percent: percentageRemaining,
          }),
        )}
      </Text>

      <EmailKlippekort
        locale={locale}
        name={packageName}
        totalHours={total}
        remainingHours={remaining}
      />

      {isCustomer ? (
        portalUrl ? (
          <>
            <Text style={emailText}>{t("low.clientRenew")}</Text>
            <EmailButton href={portalUrl}>
              {t("prepaid.renewButton")}
            </EmailButton>
          </>
        ) : (
          <PrepaidContactLine
            senderName={senderName}
            senderEmail={senderEmail}
            locale={locale}
          />
        )
      ) : (
        <>
          <EmailCallout tone="warning">{t("low.ownerCallout")}</EmailCallout>
          <EmailButton href={`${dashboardUrl}/klippekort`}>
            {t("low.ownerButton")}
          </EmailButton>
          <Text style={emailMuted}>{t("low.ownerMuted")}</Text>
        </>
      )}
    </EmailShell>
  );
}

/** "3.50" og "3,5" bliver begge til 3.5. */
export function parseHours(value: string): number {
  const n = Number.parseFloat(value.replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

export default PrepaidLowBalanceEmail;
