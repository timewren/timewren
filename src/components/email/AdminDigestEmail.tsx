import { Text } from "@react-email/components";
import { brand } from "@/lib/brand";
import { mailT } from "@/lib/email/locale";
import { MAIL, MAIL_STATUS } from "./brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";

export interface AdminDigestEmailProps {
  weekLabel: string;
  /** Falsk uden betalingsudbyder: MRR-/abonnementsafsnittet udelades. */
  showBilling?: boolean;
  mrr: string;
  mrrChange: string;
  mrrChangeTone: "up" | "down" | "none";
  activeSubscriptions: number;
  trialsEndingSoon: number;
  alerts: string[];
  newSignups: number;
  signups: { name: string; detail: string }[];
  adminUrl: string;
  locale?: string;
}

/** Ugentlig intern briefing til admins. */
export function AdminDigestEmail({
  weekLabel,
  showBilling = true,
  mrr,
  mrrChange,
  mrrChangeTone,
  activeSubscriptions,
  trialsEndingSoon,
  alerts,
  newSignups,
  signups,
  adminUrl,
  locale = "da",
}: AdminDigestEmailProps) {
  const t = mailT("emailsReports", locale);
  const changeColor =
    mrrChangeTone === "up"
      ? MAIL.brand
      : mrrChangeTone === "down"
        ? MAIL_STATUS.danger.text
        : MAIL.muted;
  return (
    <EmailShell
      locale={locale}
      preview={t("admin.digestPreview", { week: weekLabel })}
      kicker={t("admin.kicker")}
      heading={t("admin.digestHeading")}
      footerNote={t("admin.footerNote", { brand: brand.name })}
    >
      <Text style={{ ...emailMuted, margin: "-8px 0 16px 0" }}>
        {weekLabel}
      </Text>

      {alerts.length > 0 && (
        <EmailCallout tone="danger" title={t("admin.attention")}>
          {alerts.map((a) => (
            <div key={a}>{a}</div>
          ))}
        </EmailCallout>
      )}

      {showBilling && (
        <>
          <Text style={{ ...emailText, fontWeight: 700, margin: "16px 0 4px" }}>
            {t("admin.business")}
          </Text>
          <EmailKeyValue
            rows={[
              { label: "MRR", value: mrr, strong: true },
              {
                label: t("admin.mrrChange"),
                value: <span style={{ color: changeColor }}>{mrrChange}</span>,
              },
              {
                label: t("admin.activeSubs"),
                value: String(activeSubscriptions),
              },
              {
                label: t("admin.trialsEnding"),
                value: String(trialsEndingSoon),
              },
            ]}
          />
        </>
      )}

      <Text style={{ ...emailText, fontWeight: 700, margin: "16px 0 4px" }}>
        {t("admin.newUsers", { count: newSignups })}
      </Text>
      {signups.length === 0 ? (
        <Text style={emailMuted}>{t("admin.noNewUsers")}</Text>
      ) : (
        <EmailKeyValue
          rows={signups.map((s) => ({ label: s.name, value: s.detail }))}
        />
      )}

      <EmailButton href={adminUrl}>{t("admin.open")}</EmailButton>
    </EmailShell>
  );
}

export default AdminDigestEmail;
