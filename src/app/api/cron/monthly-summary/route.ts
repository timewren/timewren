import { and, between, eq, gte, lte, or } from "drizzle-orm";
import { PREPAID_LOW_BALANCE_THRESHOLD } from "@/lib/config";
import { getUserOrgId } from "@/lib/cron/get-user-org";
import { withCronLogging } from "@/lib/cron/log-cron-run";
import { db } from "@/lib/db";
import {
  clients,
  emailPreferences,
  invoices,
  prepaidPackages,
  timeEntries,
  users,
} from "@/lib/db/schema";
import { wasEmailSentRecently } from "@/lib/email/logger";
import { sendMonthlySummaryEmail } from "@/lib/email/reports";
import { prepaidDaysUntilExpiry } from "@/lib/prepaid/expiry";
import {
  addMonthsToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  entryDateFromStr,
  monthStartDateStr,
} from "@/lib/time/copenhagen";
import { captureRouteError } from "@/lib/utils/sentry";

// Cron schedule: 0 8 1 * * (1st of each month at 08:00)

/**
 * Dansk kalendermåned uanset processens TZ (#649). `start`/`end` er de
 * præcise øjeblikke til forespørgsler; `label` er UTC-midnat den 1., som
 * giver samme måned/år både i UTC og i Europe/Copenhagen.
 */
function getMonthBounds(monthsAgo: number): {
  start: Date;
  end: Date;
  label: Date;
} {
  const first = addMonthsToDateStr(
    monthStartDateStr(copenhagenToday()),
    -monthsAgo,
  );
  const nextFirst = addMonthsToDateStr(first, 1);
  return {
    start: copenhagenDayStart(first),
    end: new Date(copenhagenDayStart(nextFirst).getTime() - 1),
    label: entryDateFromStr(first),
  };
}

export const GET = withCronLogging("monthly-summary", async (_request) => {
  // Get all users who want monthly reports
  const usersWithPrefs = await db
    .select({
      user: users,
      prefs: emailPreferences,
    })
    .from(users)
    .leftJoin(emailPreferences, eq(users.id, emailPreferences.userId));

  const lastMonth = getMonthBounds(1);
  const monthBeforeLast = getMonthBounds(2);
  const year = lastMonth.label.getUTCFullYear();

  // Get year-to-date bounds
  const yearStart = copenhagenDayStart(`${year}-01-01`);

  let sentCount = 0;
  const errors: string[] = [];

  for (const { user, prefs } of usersWithPrefs) {
    // Skip if user has no email or has disabled monthly reports
    if (!user.email) continue;
    if (prefs && prefs.monthlyReport === false) continue;

    // Dedup: at most one monthly summary per ~month, even on re-trigger.
    if (
      await wasEmailSentRecently(
        user.id,
        "monthly_summary",
        25 * 24 * 60 * 60 * 1000,
      )
    ) {
      continue;
    }

    try {
      // Per-user cron: filters by userId (personal digest), orgId added for index efficiency
      const orgId = await getUserOrgId(user.id);

      // Get time entries for last month
      const lastMonthEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
          clientId: timeEntries.clientId,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            between(timeEntries.date, lastMonth.start, lastMonth.end),
          ),
        );

      // Get time entries for month before last
      const previousMonthEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            between(
              timeEntries.date,
              monthBeforeLast.start,
              monthBeforeLast.end,
            ),
          ),
        );

      // Calculate stats
      const hoursThisMonth = lastMonthEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );
      const hoursLastMonth = previousMonthEntries.reduce(
        (sum, e) => sum + parseFloat(e.hours || "0"),
        0,
      );

      const revenueThisMonth = lastMonthEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );
      const revenueLastMonth = previousMonthEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );

      // Client breakdown
      const clientHours: Record<string, { hours: number; revenue: number }> =
        {};
      for (const entry of lastMonthEntries) {
        if (!entry.clientId) continue;
        if (!clientHours[entry.clientId]) {
          clientHours[entry.clientId] = { hours: 0, revenue: 0 };
        }
        clientHours[entry.clientId].hours += parseFloat(entry.hours || "0");
        clientHours[entry.clientId].revenue +=
          parseFloat(entry.hours || "0") *
          parseFloat(entry.billableRate || "0");
      }

      const clientIds = Object.keys(clientHours);
      const clientData =
        clientIds.length > 0
          ? await db
              .select({ id: clients.id, name: clients.name })
              .from(clients)
              .where(
                and(
                  or(...clientIds.map((id) => eq(clients.id, id))),
                  ...(orgId ? [eq(clients.organizationId, orgId)] : []),
                ),
              )
          : [];

      const clientBreakdown = Object.entries(clientHours)
        .map(([clientId, data]) => ({
          name: clientData.find((c) => c.id === clientId)?.name || "",
          hours: data.hours,
          revenue: data.revenue,
        }))
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 5);

      // Invoice stats for the month
      const monthInvoices = await db
        .select({
          status: invoices.status,
          amount: invoices.amount,
        })
        .from(invoices)
        .where(
          and(
            eq(invoices.userId, user.id),
            ...(orgId ? [eq(invoices.organizationId, orgId)] : []),
            between(invoices.issueDate, lastMonth.start, lastMonth.end),
          ),
        );

      const paidInvoices = monthInvoices.filter((i) => i.status === "paid");
      const outstandingInvoices = monthInvoices.filter(
        (i) => i.status !== "paid" && i.status !== "cancelled",
      );

      const invoiceStats = {
        paid: paidInvoices.length,
        paidAmount: paidInvoices.reduce(
          (sum, i) => sum + parseFloat(i.amount || "0"),
          0,
        ),
        outstanding: outstandingInvoices.length,
        outstandingAmount: outstandingInvoices.reduce(
          (sum, i) => sum + parseFloat(i.amount || "0"),
          0,
        ),
      };

      // Prepaid stats
      const now = new Date();

      const userPrepaid = await db
        .select({
          id: prepaidPackages.id,
          remainingHours: prepaidPackages.remainingHours,
          totalHours: prepaidPackages.totalHours,
          expiryDate: prepaidPackages.expiryDate,
        })
        .from(prepaidPackages)
        .where(
          and(
            eq(prepaidPackages.userId, user.id),
            ...(orgId ? [eq(prepaidPackages.organizationId, orgId)] : []),
            eq(prepaidPackages.isActive, true),
          ),
        );

      const prepaidStats = {
        activePackages: userPrepaid.length,
        lowBalancePackages: userPrepaid.filter((p) => {
          const remaining = parseFloat(p.remainingHours || "0");
          const total = parseFloat(p.totalHours || "1");
          return remaining / total < PREPAID_LOW_BALANCE_THRESHOLD;
        }).length,
        // Udløbsdato senest om 7 danske kalenderdage (#736)
        expiringPackages: userPrepaid.filter((p) => {
          const days = prepaidDaysUntilExpiry(p.expiryDate, now);
          return days !== null && days <= 7;
        }).length,
      };

      // Year to date revenue
      const ytdEntries = await db
        .select({
          hours: timeEntries.hours,
          billableRate: timeEntries.billableRate,
        })
        .from(timeEntries)
        .where(
          and(
            eq(timeEntries.userId, user.id),
            ...(orgId ? [eq(timeEntries.organizationId, orgId)] : []),
            gte(timeEntries.date, yearStart),
            lte(timeEntries.date, lastMonth.end),
          ),
        );

      const yearToDateRevenue = ytdEntries.reduce(
        (sum, e) =>
          sum + parseFloat(e.hours || "0") * parseFloat(e.billableRate || "0"),
        0,
      );

      // Skip if no activity this month and no invoices
      if (lastMonthEntries.length === 0 && monthInvoices.length === 0) continue;

      // Send email
      await sendMonthlySummaryEmail({
        to: user.email,
        userName: user.name,
        monthDate: lastMonth.label,
        year,
        hoursThisMonth,
        hoursLastMonth,
        revenueThisMonth,
        revenueLastMonth,
        clientBreakdown,
        invoiceStats,
        prepaidStats,
        yearToDateRevenue,
        userId: user.id,
      });

      sentCount++;
    } catch (error) {
      console.error(
        `Failed to send monthly summary for user ${user.id}:`,
        error,
      );
      errors.push(`User ${user.id}: ${(error as Error).message}`);
    }
  }

  if (errors.length > 0) {
    captureRouteError(new Error(errors.join("; ")), {
      route: "/api/cron/monthly-summary",
      type: "cron",
    });
  }

  return {
    itemsProcessed: usersWithPrefs.length,
    itemsSucceeded: sentCount,
    itemsFailed: errors.length,
    metadata: errors.length > 0 ? { errors } : undefined,
  };
});
