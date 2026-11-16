import { Text } from "@react-email/components";
import { brand as buildBrand } from "@/lib/brand";
import { formatMailHours, mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import { MAIL, MAIL_FONT } from "./brand";
import {
  EmailButton,
  EmailKlippekort,
  EmailShell,
  EmailStats,
  emailMuted,
  emailText,
} from "./EmailShell";

// Månedlig kunde-statusrapport (#96): branded status-mail på brugerens
// vegne. Ren deterministisk data-aggregering; personlig note fra brugeren.
// Mailen går til brugerens kunde og omtaler afsenderen i tredje person.

export interface MonthlyStatusProject {
  name: string;
  hours: number;
}

export interface MonthlyStatusPackage {
  name: string;
  remainingHours: number;
  totalHours: number;
  overdraftHours: number;
}

interface MonthlyClientStatusEmailProps {
  clientName: string;
  senderName: string;
  monthLabel: string; // fx "juni 2026"
  totalHours: number;
  projects: MonthlyStatusProject[];
  packages: MonthlyStatusPackage[];
  pendingApprovals: number;
  personalNote?: string | null;
  portalUrl?: string | null;
  logoUrl?: string | null;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

const th = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.muted,
  fontFamily: MAIL_FONT,
  fontSize: "13px",
  fontWeight: 600,
  padding: "6px 0",
  textAlign: "left" as const,
};

const td = {
  borderBottom: `1px solid ${MAIL.line}`,
  color: MAIL.text,
  fontFamily: MAIL_FONT,
  fontSize: "15px",
  padding: "8px 0",
};

export function MonthlyClientStatusEmail({
  clientName,
  senderName,
  monthLabel,
  totalHours,
  projects,
  packages,
  pendingApprovals,
  personalNote,
  portalUrl,
  logoUrl,
  locale = "da",
  mailBrand,
}: MonthlyClientStatusEmailProps) {
  const brand = mailBrand?.brand ?? buildBrand;
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const fmtHours = (h: number) => formatMailHours(h, locale);
  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("clientStatus.preview", {
        month: monthLabel,
        hours: fmtHours(totalHours),
        sender: senderName,
      })}
      kicker={t("clientStatus.kicker")}
      heading={t("clientStatus.heading", { month: monthLabel })}
      brandLogoUrl={logoUrl}
      brandName={senderName}
      footerNote={t("clientStatus.footerNote", {
        sender: senderName,
        brand: brand.name,
      })}
    >
      <Text style={emailText}>{t("greeting", { name: clientName })}</Text>
      <Text style={emailText}>
        {t("clientStatus.intro", { sender: senderName })}
      </Text>

      {personalNote && (
        <>
          <Text style={{ ...emailMuted, margin: "0 0 4px 0" }}>
            {t("clientStatus.noteLabel", { sender: senderName })}
          </Text>
          <Text style={{ ...emailText, whiteSpace: "pre-line" }}>
            {personalNote}
          </Text>
        </>
      )}

      <EmailStats
        stats={[
          {
            label: t("clientStatus.monthHours"),
            value: t("hoursUnit", { hours: fmtHours(totalHours) }),
          },
          ...(pendingApprovals > 0
            ? [
                {
                  label: t("clientStatus.approvalLabel"),
                  value: String(pendingApprovals),
                  sub: t("clientStatus.approvalSub"),
                },
              ]
            : []),
        ]}
      />

      {projects.length > 0 && (
        <table
          style={{
            borderCollapse: "collapse",
            margin: "8px 0 16px",
            width: "100%",
          }}
        >
          <thead>
            <tr>
              <th className="tt-muted" style={th}>
                {t("clientStatus.project")}
              </th>
              <th className="tt-muted" style={{ ...th, textAlign: "right" }}>
                {t("hours")}
              </th>
            </tr>
          </thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.name}>
                <td style={td}>{p.name}</td>
                <td
                  style={{
                    ...td,
                    fontVariantNumeric: "tabular-nums",
                    textAlign: "right",
                  }}
                >
                  {fmtHours(p.hours)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {packages.map((pkg) => (
        <EmailKlippekort
          key={pkg.name}
          locale={locale}
          name={pkg.name}
          totalHours={pkg.totalHours}
          // Databasen holder saldoen på 0 og gælden i overdraftHours;
          // en negativ saldo giver "x t overtrukket" i kortets tekst.
          remainingHours={
            pkg.overdraftHours > 0 ? -pkg.overdraftHours : pkg.remainingHours
          }
        />
      ))}

      {pendingApprovals > 0 && (
        <Text style={emailText}>
          {t("clientStatus.pending", { count: pendingApprovals })}
        </Text>
      )}

      {portalUrl && (
        <EmailButton href={portalUrl}>
          {t("clientStatus.portalButton")}
        </EmailButton>
      )}
    </EmailShell>
  );
}

export default MonthlyClientStatusEmail;
