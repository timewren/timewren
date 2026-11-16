import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import {
  type ForecastPrepaidPackage,
  forecastCashflow,
} from "@/lib/cashflow/forecast";
import { invoices, prepaidPackages, prepaidUsage } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

/**
 * Cashflow forecast router.
 *
 * Returns a 30-day cashflow forecast split into 4 weekly buckets.
 * Dates are serialized as ISO strings for tRPC transport.
 */
export const cashflowRouter = router({
  getCashflowForecast: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();
    const twelveMonthsAgo = new Date(now);
    twelveMonthsAgo.setMonth(now.getMonth() - 12);

    // -------------------------------------------------------------------------
    // 1. Fetch outstanding invoices (sent + overdue), excluding deleted/paid
    // -------------------------------------------------------------------------
    const outstandingRows = await ctx.db.query.invoices.findMany({
      where: and(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        inArray(invoices.status, ["sent", "overdue"]),
      ),
      columns: {
        id: true,
        invoiceNumber: true,
        amount: true,
        dueDate: true,
        clientId: true,
        status: true,
        issueDate: true,
      },
    });

    const outstandingInvoices = outstandingRows.map((inv) => ({
      id: inv.id,
      invoiceNumber: inv.invoiceNumber,
      amount: parseFloat(inv.amount),
      dueDate: inv.dueDate ?? null,
      clientId: inv.clientId,
    }));

    // -------------------------------------------------------------------------
    // 2. Build per-client payment history (sent → paid lag in days)
    //    Limited to last 12 months to keep the estimate current.
    // -------------------------------------------------------------------------
    const paidRows = await ctx.db.query.invoices.findMany({
      where: and(
        ctx.orgId
          ? eq(invoices.organizationId, ctx.orgId)
          : eq(invoices.userId, userId),
        eq(invoices.status, "paid"),
        gte(invoices.issueDate, twelveMonthsAgo),
      ),
      columns: {
        clientId: true,
        issueDate: true,
        paidDate: true,
      },
    });

    const clientPaymentHistory = new Map<string, number[]>();
    let userTotalLagSum = 0;
    let userTotalLagCount = 0;

    for (const row of paidRows) {
      if (!row.paidDate) continue;
      const lagDays = Math.max(
        0,
        Math.round(
          (row.paidDate.getTime() - row.issueDate.getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      );
      const existing = clientPaymentHistory.get(row.clientId) ?? [];
      existing.push(lagDays);
      clientPaymentHistory.set(row.clientId, existing);
      userTotalLagSum += lagDays;
      userTotalLagCount += 1;
    }

    const userAvgPaymentDays =
      userTotalLagCount > 0
        ? Math.round(userTotalLagSum / userTotalLagCount)
        : 14; // Fallback: 14 days

    // -------------------------------------------------------------------------
    // 3. Fetch active prepaid packages + their history per client
    // -------------------------------------------------------------------------
    const activePackages = await ctx.db.query.prepaidPackages.findMany({
      where: and(
        ctx.orgId
          ? eq(prepaidPackages.organizationId, ctx.orgId)
          : eq(prepaidPackages.userId, userId),
        eq(prepaidPackages.isActive, true),
        eq(prepaidPackages.isArchived, false),
      ),
      with: {
        client: {
          columns: { id: true, name: true },
        },
      },
    });

    // For each client with an active package, fetch historical packages
    // (all non-archived) and compute avg hours burned per month
    const activePrepaid: ForecastPrepaidPackage[] = [];

    const clientIds = [...new Set(activePackages.map((p) => p.clientId))];

    const scopeFilter = ctx.orgId
      ? eq(prepaidPackages.organizationId, ctx.orgId)
      : eq(prepaidPackages.userId, userId);

    // Historik og forbrug hentes for alle kunder i ét kald hver (før: to
    // kald pr. kunde). Historikken er stadig begrænset til de 20 nyeste
    // pakker pr. kunde, det sker nedenfor.
    const historicalRows =
      clientIds.length > 0
        ? await ctx.db.query.prepaidPackages.findMany({
            where: and(
              scopeFilter,
              inArray(prepaidPackages.clientId, clientIds),
            ),
            orderBy: [desc(prepaidPackages.purchaseDate)],
            columns: {
              clientId: true,
              renewalBaseHours: true,
              hourlyRate: true,
              totalValue: true,
              purchaseDate: true,
              totalHours: true,
            },
          })
        : [];
    const historyByClient = new Map<string, typeof historicalRows>();
    for (const row of historicalRows) {
      const list = historyByClient.get(row.clientId) ?? [];
      if (list.length < 20) list.push(row);
      historyByClient.set(row.clientId, list);
    }

    // Compute avg hours burned per month via usage records
    // Look at usage in the last 3 months to get a rolling average
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(now.getMonth() - 3);

    const usageRows =
      clientIds.length > 0
        ? await ctx.db
            .select({
              clientId: prepaidPackages.clientId,
              totalHoursUsed: sql<string>`COALESCE(SUM(CAST(${prepaidUsage.hoursUsed} AS DECIMAL)), 0)`,
            })
            .from(prepaidUsage)
            .innerJoin(
              prepaidPackages,
              eq(prepaidUsage.prepaidPackageId, prepaidPackages.id),
            )
            .where(
              and(
                scopeFilter,
                inArray(prepaidPackages.clientId, clientIds),
                gte(prepaidUsage.createdAt, threeMonthsAgo),
              ),
            )
            .groupBy(prepaidPackages.clientId)
        : [];
    const usedByClient = new Map(
      usageRows.map((r) => [r.clientId, parseFloat(r.totalHoursUsed ?? "0")]),
    );

    for (const clientId of clientIds) {
      // Find the active package for this client (pick the one with most remaining hours)
      const clientActivePackages = activePackages.filter(
        (p) => p.clientId === clientId,
      );
      const activePkg = clientActivePackages.reduce((best, p) =>
        parseFloat(p.remainingHours ?? "0") >
        parseFloat(best.remainingHours ?? "0")
          ? p
          : best,
      );

      const clientName =
        activePkg.client?.name ??
        (await tr("serverErrors", "common.unknownClient"));

      const historicalPkgs = historyByClient.get(clientId) ?? [];
      const totalUsedInLast3Months = usedByClient.get(clientId) ?? 0;
      const avgHoursPerMonth = totalUsedInLast3Months / 3;

      activePrepaid.push({
        clientId,
        clientName,
        currentSaldoHours: parseFloat(activePkg.remainingHours ?? "0"),
        historicalPackages: historicalPkgs.map((p) => ({
          // Periodiske pakker (#79): forventet periodebeløb er kædens
          // grundtimer × sats — totalValue inkluderer overført rest og
          // ville overvurdere fremtidig cash-in.
          priceExVat: p.renewalBaseHours
            ? parseFloat(p.renewalBaseHours) * parseFloat(p.hourlyRate || "0")
            : parseFloat(p.totalValue),
          purchasedAt: p.purchaseDate,
          hoursAtPurchase: parseFloat(p.totalHours),
        })),
        avgHoursPerMonth,
      });
    }

    // -------------------------------------------------------------------------
    // 4. Run the pure forecast function
    // -------------------------------------------------------------------------
    const forecast = forecastCashflow({
      now,
      outstandingInvoices,
      clientPaymentHistory,
      userAvgPaymentDays,
      activePrepaid,
    });

    // -------------------------------------------------------------------------
    // 5. Serialize dates → ISO strings for tRPC transport
    // -------------------------------------------------------------------------
    return {
      weeks: forecast.weeks.map((week) => ({
        weekNumber: week.weekNumber,
        from: week.from.toISOString(),
        to: week.to.toISOString(),
        expectedAmount: week.expectedAmount,
        overdueAmount: week.overdueAmount,
        breakdown: {
          invoices: week.breakdown.invoices,
          prepaidRenewals: week.breakdown.prepaidRenewals,
        },
      })),
      totalExpected: forecast.totalExpected,
      totalOverdue: forecast.totalOverdue,
    };
  }),
});
