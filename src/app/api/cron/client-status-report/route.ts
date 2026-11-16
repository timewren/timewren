import { render } from "@react-email/render";
import { and, eq, gte, isNotNull, lt, ne, sql } from "drizzle-orm";
import { createElement } from "react";
import { MonthlyClientStatusEmail } from "@/components/email/MonthlyClientStatusEmail";
import { toIntlLocale } from "@/i18n/format-locale";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  clients,
  companyProfiles,
  prepaidPackages,
  projects,
  timeApprovalRequests,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { mailT } from "@/lib/email/locale";
import { resolveMailBrand } from "@/lib/email/mail-brand";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { getClientPortalUrl } from "@/lib/portal/client-url";
import { DEFAULT_FROM_EMAIL, resend } from "@/lib/resend";
import {
  addDaysToDateStr,
  addMonthsToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  entryDateFromStr,
  isoWeekdayOfDateStr,
  monthStartDateStr,
} from "@/lib/time/copenhagen";

// Månedlig kunde-statusrapport (#96): branded status-mail på freelancerens
// vegne — første hverdag i måneden, opt-in pr. kunde. Deterministisk
// data-aggregering (timer pr. projekt, klippekort-saldi, godkendelser).
// Kører dagligt 08:10; sender kun på første hverdag + 3-dages catch-up
// (samme mønster som report-schedules, #189).

const CATCHUP_DAYS = 3;

/** Første hverdag (man-fre) i den danske måned for et givet tidspunkt */
function firstBusinessDayOfMonth(d: Date): string {
  let first = monthStartDateStr(copenhagenToday(d));
  while (isoWeekdayOfDateStr(first) >= 6) {
    first = addDaysToDateStr(first, 1);
  }
  return first;
}

function isDue(lastSentAt: Date | null, now: Date): boolean {
  const dueStr = firstBusinessDayOfMonth(now);
  const due = copenhagenDayStart(dueStr);
  const windowEnd = copenhagenDayStart(addDaysToDateStr(dueStr, CATCHUP_DAYS));
  if (now < due || now >= windowEnd) return false;
  return !lastSentAt || new Date(lastSentAt) < due;
}

export const GET = withCronLogging("client-status-report", async () => {
  const now = new Date();

  const enabledClients = await db.query.clients.findMany({
    where: and(
      eq(clients.monthlyStatusReportEnabled, true),
      eq(clients.isArchived, false),
      isNotNull(clients.email),
      ne(clients.email, ""),
    ),
    columns: {
      id: true,
      name: true,
      email: true,
      userId: true,
      organizationId: true,
      monthlyStatusNote: true,
      statusReportLastSentAt: true,
    },
  });

  let sent = 0;
  let failed = 0;
  let skipped = 0;

  // Forrige måned
  // Forrige danske måned uanset processens TZ (#649)
  const thisMonthStr = monthStartDateStr(copenhagenToday(now));
  const prevMonthStr = addMonthsToDateStr(thisMonthStr, -1);
  const monthStart = copenhagenDayStart(prevMonthStr);
  const monthEnd = copenhagenDayStart(thisMonthStr);
  const monthDate = entryDateFromStr(prevMonthStr);

  for (const client of enabledClients) {
    if (!isDue(client.statusReportLastSentAt, now)) {
      skipped++;
      continue;
    }

    try {
      // Kunden har ingen profil: mailen følger afsenderens (freelancerens) sprog.
      // Brandet er afsenderens (freelancerens konto).
      const mb = await resolveMailBrand({ userId: client.userId });
      const locale = await getRecipientLocale({
        userId: client.userId,
        email: client.email,
        fallback: mb?.locale,
      });
      const t = mailT("emailsReports", locale, mb?.key);
      const monthLabel = monthDate.toLocaleDateString(toIntlLocale(locale), {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      });
      const effectiveClientId = sql<
        string | null
      >`COALESCE(${projects.clientId}, ${timeEntries.clientId})`;

      const [projectRows, packages, [approvalRow], profile, freelancer] =
        await Promise.all([
          db
            .select({
              projectName: sql<string>`COALESCE(${projects.name}, '')`,
              hours: sql<string>`COALESCE(SUM(${timeEntries.hours}), 0)`,
            })
            .from(timeEntries)
            .leftJoin(projects, eq(timeEntries.projectId, projects.id))
            .where(
              and(
                client.organizationId
                  ? eq(timeEntries.organizationId, client.organizationId)
                  : eq(timeEntries.userId, client.userId),
                gte(timeEntries.date, monthStart),
                lt(timeEntries.date, monthEnd),
                ne(timeEntries.approvalStatus, "rejected"),
                sql`${effectiveClientId} = ${client.id}`,
              ),
            )
            .groupBy(sql`COALESCE(${projects.name}, '')`),
          db.query.prepaidPackages.findMany({
            where: and(
              eq(prepaidPackages.clientId, client.id),
              eq(prepaidPackages.isActive, true),
            ),
            columns: {
              name: true,
              remainingHours: true,
              totalHours: true,
              overdraftHours: true,
            },
          }),
          db
            .select({ value: sql<number>`COUNT(*)::int` })
            .from(timeApprovalRequests)
            .where(
              and(
                eq(timeApprovalRequests.clientId, client.id),
                eq(timeApprovalRequests.status, "pending"),
              ),
            ),
          db.query.companyProfiles.findFirst({
            where: client.organizationId
              ? eq(companyProfiles.organizationId, client.organizationId)
              : eq(companyProfiles.userId, client.userId),
            columns: { name: true, logoUrl: true },
          }),
          db.query.users.findFirst({
            where: eq(users.id, client.userId),
            columns: { name: true },
          }),
        ]);

      const projectStats = projectRows
        .map((r) => ({
          name: r.projectName || t("clientStatus.noProject"),
          hours: Number.parseFloat(r.hours),
        }))
        .filter((p) => p.hours > 0)
        .sort((a, b) => b.hours - a.hours);
      const totalHours = projectStats.reduce((s, p) => s + p.hours, 0);
      const packageStats = packages.map((p) => ({
        name: p.name,
        remainingHours: Number.parseFloat(p.remainingHours || "0"),
        totalHours: Number.parseFloat(p.totalHours || "0"),
        overdraftHours: Number.parseFloat(p.overdraftHours || "0"),
      }));

      // Intet at fortælle → spring måneden over (ingen tom spam-mail)
      if (totalHours === 0 && packageStats.length === 0) {
        skipped++;
        continue;
      }

      const senderName =
        profile?.name || freelancer?.name || t("clientStatus.fallbackSender");
      const portalUrl = await getClientPortalUrl(db, client.id);

      const html = await render(
        createElement(MonthlyClientStatusEmail, {
          mailBrand: mb,
          clientName: client.name,
          senderName,
          monthLabel,
          totalHours,
          projects: projectStats,
          packages: packageStats,
          pendingApprovals: approvalRow?.value ?? 0,
          personalNote: client.monthlyStatusNote,
          portalUrl,
          logoUrl: profile?.logoUrl ?? null,
          locale,
        }),
      );

      const response = await resend.emails.send({
        from: mb?.from ?? DEFAULT_FROM_EMAIL,
        to: client.email as string,
        subject: t("clientStatus.subjectMail", {
          sender: senderName,
          month: monthLabel,
        }),
        html,
      });
      if (response.error) {
        throw new Error(`Resend: ${JSON.stringify(response.error)}`);
      }

      await db
        .update(clients)
        .set({ statusReportLastSentAt: now })
        .where(eq(clients.id, client.id));
      sent++;
    } catch (err) {
      failed++;
      console.error(
        `[Client Status Report] ${client.id} fejlede:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return {
    itemsProcessed: sent + failed,
    itemsSucceeded: sent,
    itemsFailed: failed,
    metadata: { skippedNotDueOrEmpty: skipped },
  };
});
