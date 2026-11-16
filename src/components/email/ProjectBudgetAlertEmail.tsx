import { Text } from "@react-email/components";
import { mailT } from "@/lib/email/locale";
import type { MailBrand } from "@/lib/email/mail-brand";
import {
  EmailButton,
  EmailCallout,
  EmailKeyValue,
  EmailShell,
  emailMuted,
  emailText,
} from "./EmailShell";
import { mailMarkup } from "./mail-markup";

interface ProjectBudgetAlertEmailProps {
  recipientName: string;
  projectName: string;
  clientName: string | null;
  /** "september 2026" */
  monthLabel: string;
  usedHours: string;
  budgetHours: string;
  percentage: number;
  /** 80 = advarsel, 100 = budgettet er brugt op */
  level: 80 | 100;
  projectUrl: string;
  locale?: string;
  /** Multibrand: brandet for modtagerens konto. Udeladt = build-brandet. */
  mailBrand?: MailBrand;
}

export function ProjectBudgetAlertEmail({
  recipientName,
  projectName,
  clientName,
  monthLabel,
  usedHours,
  budgetHours,
  percentage,
  level,
  projectUrl,
  locale = "da",
  mailBrand,
}: ProjectBudgetAlertEmailProps) {
  const t = mailT("emailsReports", locale, mailBrand?.key);
  const isCritical = level === 100;
  const heading = isCritical
    ? t("budget.headingCritical")
    : t("budget.headingWarning");
  const bodyKey = isCritical
    ? clientName
      ? "budget.bodyCriticalClient"
      : "budget.bodyCritical"
    : clientName
      ? "budget.bodyWarningClient"
      : "budget.bodyWarning";

  return (
    <EmailShell
      mailBrand={mailBrand}
      locale={locale}
      preview={t("budget.preview", {
        project: projectName,
        used: usedHours,
        budget: budgetHours,
        month: monthLabel,
      })}
      kicker={t("budget.kicker")}
      heading={heading}
    >
      <Text style={emailText}>{t("greeting", { name: recipientName })}</Text>
      <Text style={emailText}>
        {mailMarkup(
          t(bodyKey, {
            project: projectName,
            client: clientName ?? "",
            month: monthLabel,
          }),
        )}
      </Text>

      <EmailKeyValue
        rows={[
          { label: t("budget.rowProject"), value: projectName },
          ...(clientName
            ? [{ label: t("budget.rowClient"), value: clientName }]
            : []),
          { label: t("budget.rowMonth"), value: monthLabel },
          {
            label: t("budget.rowUsage"),
            value: t("budget.usageValue", {
              used: usedHours,
              budget: budgetHours,
            }),
            strong: true,
          },
          {
            label: t("budget.rowStatus"),
            value: t("budget.statusValue", { pct: percentage }),
          },
        ]}
      />

      <EmailCallout tone={isCritical ? "danger" : "warning"}>
        {isCritical ? t("budget.calloutCritical") : t("budget.calloutWarning")}
      </EmailCallout>

      <EmailButton href={projectUrl}>{t("budget.button")}</EmailButton>

      <Text style={emailMuted}>{t("budget.muted")}</Text>
    </EmailShell>
  );
}

export default ProjectBudgetAlertEmail;
