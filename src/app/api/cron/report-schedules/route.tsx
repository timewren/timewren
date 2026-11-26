import { renderToBuffer } from "@react-pdf/renderer";
import { eq } from "drizzle-orm";
import { toIntlLocale } from "@/i18n/format-locale";
import { runWithLocale } from "@/i18n/server-text";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  companyProfiles,
  reportSchedules,
  reportTemplates,
} from "@/lib/db/schema";
import { runWithOwnerCurrency } from "@/lib/demo/server-currency";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import {
  canRunReportType,
  resolveScopeCtxForUser,
} from "@/lib/enterprise/reporting/access";
import {
  enterpriseReportConfigSchema,
  isEnterpriseReportType,
} from "@/lib/enterprise/reporting/config";
import { EnterpriseReportPDF } from "@/lib/enterprise/reporting/pdf";
import {
  reportTableToCsv,
  reportTableToXlsx,
} from "@/lib/enterprise/reporting/render";
import { runEnterpriseReport } from "@/lib/enterprise/reporting/run";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { toLocalDateStr } from "@/lib/format";
import {
  type ReportTemplateConfig,
  showsBudgetColumn,
} from "@/lib/reports/config-schema";
import { resolveDateRange } from "@/lib/reports/date-range";
import { generateCSV } from "@/lib/reports/generators/csv";
import { ReportPDF } from "@/lib/reports/generators/pdf/ReportPDF";
import { generateXLSX } from "@/lib/reports/generators/xlsx";
import {
  aggregateReport,
  loadReportBudgetUsage,
  loadReportEntries,
} from "@/lib/reports/query";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import {
  addDaysToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  copenhagenTodayAnchor,
  entryDateFromStr,
  isoWeekdayOfDateStr,
} from "@/lib/time/copenhagen";

// Planlagte email-rapporter (#189): kør dagligt kl. 07, find schedules der
// er "due" i dag (ugedag/månedsdag), generér rapporten fra skabelonens
// config (rullende periode — "sidste måned" sendt d. 1. giver netop sidste
// måneds tal) og send med vedhæftning til modtagerne.
// Schedule: dagligt 07:05 (cron-sidecar).

// Catch-up-vindue: en fejlet afsendelse (Resend-udfald m.m.) forsøges igen
// de næste dage i stedet for først ved NÆSTE forekomst (op til en måned væk
// for månedlige — uacceptabelt for en betalt feature).
const RETRY_WINDOW_DAYS = 3;

/** Seneste planlagte forekomst inden for retry-vinduet (midnat), ellers null */
function latestOccurrence(
  schedule: { frequency: string; sendDay: number },
  now: Date,
): Date | null {
  // Danske datoer uanset processens TZ (#649)
  const today = copenhagenToday(now);
  for (let i = 0; i < RETRY_WINDOW_DAYS; i++) {
    const day = addDaysToDateStr(today, -i);
    const matches =
      schedule.frequency === "weekly"
        ? isoWeekdayOfDateStr(day) === schedule.sendDay
        : Number(day.slice(8, 10)) === schedule.sendDay;
    if (matches) return copenhagenDayStart(day);
  }
  return null;
}

function isDueToday(
  schedule: { frequency: string; sendDay: number; lastSentAt: Date | null },
  now: Date,
): boolean {
  const occurrence = latestOccurrence(schedule, now);
  if (!occurrence) return false;
  // Due hvis der ikke er sendt siden seneste forekomst — dækker både
  // idempotens (sendt i dag → skip) og catch-up efter fejl.
  if (!schedule.lastSentAt) return true;
  return new Date(schedule.lastSentAt) < occurrence;
}

/**
 * Enterprise-rapport (E4, #462): genskab ejerens scope (leder = egne
 * afdelinger, HR/admin = alt), kør datasæt-motoren og mail vedhæftningen.
 * Returnerer false når planen er ugyldig (ejer uden profil/adgang).
 */
async function sendEnterpriseSchedule(
  schedule: {
    id: string;
    userId: string;
    organizationId: string | null;
    recipients: string[];
    format: string;
    subject: string | null;
    message: string | null;
    templateName: string;
    config: unknown;
    reportType: string;
  },
  now: Date,
): Promise<boolean> {
  if (
    !schedule.organizationId ||
    !isEnterpriseReportType(schedule.reportType)
  ) {
    return false;
  }
  const parsed = enterpriseReportConfigSchema.safeParse(schedule.config);
  if (!parsed.success) {
    console.warn(
      `[Report Schedules] ${schedule.id}: ugyldig enterprise-config`,
    );
    return false;
  }
  const scopeCtx = await resolveScopeCtxForUser(
    db,
    schedule.userId,
    schedule.organizationId,
  );
  if (
    !scopeCtx ||
    !canRunReportType(scopeCtx.orgRole, parsed.data.reportType)
  ) {
    console.warn(
      `[Report Schedules] ${schedule.id}: ejer har ikke længere adgang — springes over`,
    );
    return false;
  }
  const scope = await getVisibleScope(db, scopeCtx);
  const result = await runEnterpriseReport(db, {
    orgId: schedule.organizationId,
    scope,
    config: parsed.data,
    // Anker på dansk dato — perioden regnes med lokale getters (#734)
    now: copenhagenTodayAnchor(now),
  });
  const periodLabel = `${result.period.from}–${result.period.to}`;
  const safeName = schedule.templateName.replace(/[^\wæøåÆØÅ -]/g, "");

  let attachment: { filename: string; content: Buffer };
  if (schedule.format === "csv") {
    attachment = {
      filename: `${safeName}.csv`,
      content: Buffer.from(reportTableToCsv(result.table), "utf-8"),
    };
  } else if (schedule.format === "xlsx") {
    const buf = await reportTableToXlsx(result.table, {
      title: result.title,
      period: periodLabel,
    });
    attachment = { filename: `${safeName}.xlsx`, content: Buffer.from(buf) };
  } else {
    const org = await db.query.organizations.findFirst({
      where: (o, { eq: eqO }) => eqO(o.id, schedule.organizationId as string),
      columns: { name: true },
    });
    const pdfBuffer = await renderToBuffer(
      <EnterpriseReportPDF
        title={result.title}
        orgName={org?.name ?? ""}
        period={periodLabel}
        table={result.table}
      />,
    );
    attachment = {
      filename: `${safeName}.pdf`,
      content: Buffer.from(pdfBuffer),
    };
  }

  // Modtagerne er vilkårlige adresser: standardteksten følger ejerens sprog.
  const mb = await resolveMailBrand({ userId: schedule.userId });
  const locale = await getRecipientLocale({
    userId: schedule.userId,
    fallback: mb?.locale,
  });
  const t = mailT("emailsReports", locale, mb?.key);
  const num = (n: number) =>
    n.toLocaleString(toIntlLocale(locale), {
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    });
  const subject =
    schedule.subject ||
    t("schedule.enterpriseSubject", {
      title: result.title,
      name: schedule.templateName,
      period: periodLabel,
    });
  const bodyText =
    schedule.message ||
    t("schedule.enterpriseBody", {
      name: schedule.templateName,
      period: periodLabel,
      employees: result.summary.employeeCount,
      hours: num(result.summary.hours),
      absence: num(result.summary.absenceDays),
    });

  const response = await resend.emails.send({
    from: mb?.from ?? DEFAULT_FROM_EMAIL,
    to: schedule.recipients,
    subject,
    text: bodyText,
    attachments: [attachment],
  });
  if (response.error) {
    throw new Error(`Resend: ${JSON.stringify(response.error)}`);
  }
  await db
    .update(reportSchedules)
    .set({ lastSentAt: now })
    .where(eq(reportSchedules.id, schedule.id));
  return true;
}

export const GET = withCronLogging("report-schedules", async (_request) => {
  const now = new Date();

  const schedules = await db
    .select({
      id: reportSchedules.id,
      userId: reportSchedules.userId,
      organizationId: reportSchedules.organizationId,
      frequency: reportSchedules.frequency,
      sendDay: reportSchedules.sendDay,
      recipients: reportSchedules.recipients,
      format: reportSchedules.format,
      subject: reportSchedules.subject,
      message: reportSchedules.message,
      restrictToOwnEntries: reportSchedules.restrictToOwnEntries,
      lastSentAt: reportSchedules.lastSentAt,
      reportType: reportSchedules.reportType,
      templateName: reportTemplates.name,
      config: reportTemplates.config,
    })
    .from(reportSchedules)
    .innerJoin(
      reportTemplates,
      eq(reportSchedules.reportTemplateId, reportTemplates.id),
    )
    .where(eq(reportSchedules.isActive, true));

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  for (const schedule of schedules) {
    if (!isDueToday(schedule, now)) {
      skipped++;
      continue;
    }

    // Enterprise-rapporter (E4, #462) routes på reportType — freelance-vejen
    // nedenfor er uændret.
    if (isEnterpriseReportType(schedule.reportType)) {
      try {
        const ok = await sendEnterpriseSchedule(schedule, now);
        if (ok) sent++;
        else failed++;
      } catch (err) {
        failed++;
        console.error(
          `[Report Schedules] ${schedule.id} (enterprise) fejlede:`,
          err instanceof Error ? err.message : err,
        );
      }
      continue;
    }

    try {
      const config = schedule.config as ReportTemplateConfig;
      // Reference = UTC-midnat på dansk dato: giver samme dato med lokale
      // getters både i UTC og Europe/Copenhagen (#649).
      const { start, end } = resolveDateRange(
        config.filters,
        entryDateFromStr(copenhagenToday(now)),
      );
      const entries = await loadReportEntries(db, {
        userId: schedule.userId,
        organizationId: schedule.organizationId,
        config,
        restrictToOwnEntries: schedule.restrictToOwnEntries,
      });

      if (entries.length > 10_000) {
        console.warn(
          `[Report Schedules] ${schedule.id}: over 10.000 poster — springes over`,
        );
        failed++;
        continue;
      }

      const budget = showsBudgetColumn(config)
        ? await loadReportBudgetUsage(db, {
            entries,
            userId: schedule.userId,
            organizationId: schedule.organizationId,
            start,
            end,
          })
        : null;
      const mb = await resolveMailBrand({ userId: schedule.userId });
      const locale = await getRecipientLocale({
        userId: schedule.userId,
        fallback: mb?.locale,
      });
      const aggregates = aggregateReport(entries, config.grouping, {
        locale,
        budgetUsageByProject: budget?.usageByProject,
        budgetMonth: budget?.month,
        includePauses: config.branding.showPauses,
      });
      const exportGroups = showsBudgetColumn(config)
        ? aggregates.groups
        : undefined;
      const periodLabel = `${toLocalDateStr(start)}–${toLocalDateStr(end)}`;

      // Generér vedhæftning
      const attachment = await runWithLocale(locale, () =>
        runWithOwnerCurrency(schedule, async () => {
          const safeName = schedule.templateName.replace(/[^\wæøåÆØÅ -]/g, "");
          if (schedule.format === "csv") {
            return {
              filename: `${safeName}.csv`,
              content: Buffer.from(
                generateCSV(entries, {
                  columns: config.columns,
                  groups: exportGroups,
                  groupingNote: aggregates.groupingNote,
                  pauses: aggregates.pauses,
                }),
                "utf-8",
              ),
            };
          }
          if (schedule.format === "xlsx") {
            const buf = await generateXLSX(entries, {
              columns: config.columns,
              groups: exportGroups,
              groupingNote: aggregates.groupingNote,
            });
            return {
              filename: `${safeName}.xlsx`,
              content: Buffer.from(buf),
            };
          }
          const company = await db.query.companyProfiles.findFirst({
            where: schedule.organizationId
              ? eq(companyProfiles.organizationId, schedule.organizationId)
              : eq(companyProfiles.userId, schedule.userId),
            columns: { name: true, logoUrl: true },
          });
          const pdfBuffer = await renderToBuffer(
            <ReportPDF
              config={config}
              aggregates={aggregates}
              entries={entries}
              startDate={toLocalDateStr(start)}
              endDate={toLocalDateStr(end)}
              logoUrl={company?.logoUrl ?? null}
              companyName={company?.name ?? ""}
            />,
          );
          return {
            filename: `${safeName}.pdf`,
            content: Buffer.from(pdfBuffer),
          };
        }),
      );

      const t = mailT("emailsReports", locale, mb?.key);
      const subject =
        schedule.subject ||
        t("schedule.timeSubject", {
          name: schedule.templateName,
          period: periodLabel,
        });
      const bodyText =
        schedule.message ||
        t("schedule.timeBody", {
          name: schedule.templateName,
          period: periodLabel,
          hours: aggregates.summary.totalHours.toLocaleString(
            toIntlLocale(locale),
            { minimumFractionDigits: 1, maximumFractionDigits: 1 },
          ),
        });

      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to: schedule.recipients,
        subject,
        text: bodyText,
        attachments: [attachment],
      });
      if (response.error) {
        throw new Error(`Resend: ${JSON.stringify(response.error)}`);
      }

      await db
        .update(reportSchedules)
        .set({ lastSentAt: now })
        .where(eq(reportSchedules.id, schedule.id));
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[Report Schedules] ${schedule.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    itemsProcessed: sent + failed,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { skippedNotDue: skipped },
  };
});
