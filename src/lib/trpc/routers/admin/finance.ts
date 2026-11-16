import { eq } from "drizzle-orm";
import { z } from "zod";
import { type AluntaTransaction, alunta } from "@/lib/alunta";
import {
  cycleListPriceForSubscription,
  FOUNDING_MEMBER,
  LEGACY_SUBSCRIPTION_PRICE_MONTHLY,
  LEGACY_SUBSCRIPTION_PRICE_YEARLY,
  monthlyListPriceForSubscription,
  SUBSCRIPTION_PRICE_MONTHLY,
  SUBSCRIPTION_PRICE_YEARLY,
} from "@/lib/config";
import type { db as DbHandle } from "@/lib/db";
import { subscriptions, users } from "@/lib/db/schema";
import { isStoreManaged } from "@/lib/store-billing/state";

type FinanceDb = typeof DbHandle;

import {
  addMonthsToDateStr,
  copenhagenDayStart,
  copenhagenParts,
  copenhagenToday,
  monthStartDateStr,
  toCopenhagenDateStr,
} from "@/lib/time/copenhagen";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

// ── Sync helpers ──────────────────────────────────────────────────────

interface AluntaSubscriptionFull {
  uuid: string;
  status: string;
  start_date?: string | null;
  end_date?: string | null;
  interval?: number;
  external_customer_id?: string | null;
  plan?: { uuid: string; name?: string; slug?: string };
  customer?: {
    uuid: string;
    external_customer_id?: string | null;
  };
  [key: string]: unknown;
}

function mapAluntaStatusSync(status: string): string {
  switch (status) {
    case "trialing":
      return "trialing";
    case "active":
      return "active";
    case "past_due":
      return "past_due";
    case "cancelled":
    case "canceled":
    case "expired":
      return "canceled";
    default:
      return "active";
  }
}

function guessBillingCycle(sub: AluntaSubscriptionFull): "monthly" | "yearly" {
  // Check interval field (months)
  if (sub.interval === 12) return "yearly";
  if (sub.interval === 1) return "monthly";
  // Check plan name
  const planName = (sub.plan?.name || sub.plan?.slug || "").toLowerCase();
  if (planName.includes("year") || planName.includes("årlig")) return "yearly";
  return "monthly";
}

/**
 * All subscriptions with demo/seed/test accounts (kunde C seed data) excluded.
 * Shared by every finance procedure so MRR/ARR, breakdowns, history, forecasts
 * and the bookkeeping guide all agree instead of some tabs counting demo rows.
 */
async function fetchNonDemoSubscriptions(db: FinanceDb) {
  const demoUsers = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.isDemo, true));
  const demoUserIds = new Set(demoUsers.map((u) => u.id));
  const all = await db.query.subscriptions.findMany();
  return all.filter((s) => !demoUserIds.has(s.userId));
}

export const adminFinanceRouter = router({
  // =========================================================================
  // Finance Dashboard Procedures
  // =========================================================================

  getFinanceOverview: supporterProcedure.query(async ({ ctx }) => {
    // Demo users (kunde C seed, test accounts) excluded via the shared helper.
    const allSubs = await fetchNonDemoSubscriptions(ctx.db);

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    const activeSubs = allSubs.filter((s) => s.status === "active");
    const trialingSubs = allSubs.filter((s) => s.status === "trialing");
    const canceledSubs = allSubs.filter((s) => s.status === "canceled");
    const pastDueSubs = allSubs.filter((s) => s.status === "past_due");

    // MRR calculation (actual, with discounts)
    let mrrActual = 0;
    let mrrFullPrice = 0;
    for (const sub of activeSubs) {
      const base = monthlyListPriceForSubscription(sub);
      const discount = sub.discountPercent || 0;
      mrrActual += base * (1 - discount / 100);
      mrrFullPrice += base;
    }

    // Potential MRR from trials (if they all convert)
    let potentialMrr = 0;
    for (const sub of trialingSubs) {
      const base = monthlyListPriceForSubscription(sub);
      const discount = sub.discountPercent || 0;
      potentialMrr += base * (1 - discount / 100);
    }
    potentialMrr = Math.round(potentialMrr * 100) / 100;

    // Trial conversion timeline — when each trial ends
    const trialConversions = trialingSubs
      .filter((s) => s.trialEndsAt)
      .map((s) => ({
        trialEndsAt: s.trialEndsAt.toISOString(),
        billingCycle: s.billingCycle,
        discountPercent: s.discountPercent || 0,
      }))
      .sort(
        (a, b) =>
          new Date(a.trialEndsAt).getTime() - new Date(b.trialEndsAt).getTime(),
      );

    mrrActual = Math.round(mrrActual * 100) / 100;
    mrrFullPrice = Math.round(mrrFullPrice * 100) / 100;
    const discountLoss = Math.round((mrrFullPrice - mrrActual) * 100) / 100;

    // Weighted average discount
    const avgDiscount =
      activeSubs.length > 0
        ? Math.round(
            (activeSubs.reduce((sum, s) => sum + (s.discountPercent || 0), 0) /
              activeSubs.length) *
              100,
          ) / 100
        : 0;

    const arr = Math.round(mrrActual * 12 * 100) / 100;
    const arpu =
      activeSubs.length > 0
        ? Math.round((mrrActual / activeSubs.length) * 100) / 100
        : 0;

    // Churn rate (last 30 days)
    const recentlyCanceled = canceledSubs.filter(
      (s) => s.canceledAt && s.canceledAt >= thirtyDaysAgo,
    );
    const churnBase = activeSubs.length + recentlyCanceled.length;
    const churnRate =
      churnBase > 0
        ? Math.round((recentlyCanceled.length / churnBase) * 10000) / 100
        : 0;

    // Conversion rate
    const conversionBase = activeSubs.length + canceledSubs.length;
    const conversionRate =
      conversionBase > 0
        ? Math.round((activeSubs.length / conversionBase) * 10000) / 100
        : 0;

    return {
      mrrActual,
      mrrFullPrice,
      potentialMrr,
      discountLoss,
      avgDiscount,
      arr,
      arpu,
      churnRate,
      conversionRate,
      trialConversions,
      counts: {
        active: activeSubs.length,
        trialing: trialingSubs.length,
        canceled: canceledSubs.length,
        pastDue: pastDueSubs.length,
      },
    };
  }),

  // Actual invoiced revenue from Alunta transactions
  getAluntaRevenue: supporterProcedure.query(async () => {
    try {
      // Fetch invoiced transactions (last 12 months)
      const fromDate = addMonthsToDateStr(copenhagenToday(), -12);

      // Paginate through ALL matching transactions — a single per_page=100 page
      // silently truncates revenue once a customer base exceeds 100 tx/12mo.
      const listAllTransactions = async (params: Record<string, string>) => {
        const out: AluntaTransaction[] = [];
        let page = 1;
        while (true) {
          const res = await alunta.transactions.list({
            ...params,
            per_page: "100",
            page: String(page),
          });
          out.push(...res.data);
          if (!res.meta || page >= res.meta.last_page) break;
          page++;
        }
        return out;
      };

      const invoicedTx = await listAllTransactions({
        invoiced: "true",
        period_start_from: fromDate,
      });

      // Group by month
      const monthlyRevenue: Record<string, number> = {};
      let totalRevenue = 0;

      for (const tx of invoicedTx) {
        const month = tx.period_start.slice(0, 7); // "2026-03"
        monthlyRevenue[month] = (monthlyRevenue[month] || 0) + tx.price;
        totalRevenue += tx.price;
      }

      // Sort by month
      const months = Object.entries(monthlyRevenue)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([month, amount]) => ({
          month,
          amount: Math.round(amount) / 100, // øre → DKK
        }));

      // Upcoming uninvoiced transactions
      const upcomingTx = await listAllTransactions({ invoiced: "false" });
      const upcomingRevenue = upcomingTx.reduce((sum, tx) => sum + tx.price, 0);

      return {
        months,
        totalRevenue: Math.round(totalRevenue) / 100,
        upcomingRevenue: Math.round(upcomingRevenue) / 100,
        transactionCount: invoicedTx.length,
      };
    } catch {
      return null;
    }
  }),

  getSubscriptionBreakdown: supporterProcedure.query(async ({ ctx }) => {
    const allSubs = await fetchNonDemoSubscriptions(ctx.db);
    const now = new Date();

    // Billing cycle x status breakdown
    const breakdown: Record<string, Record<string, number>> = {};
    for (const sub of allSubs) {
      const cycle = sub.billingCycle || "monthly";
      if (!breakdown[cycle]) breakdown[cycle] = {};
      breakdown[cycle][sub.status] = (breakdown[cycle][sub.status] || 0) + 1;
    }

    // Founding member details (include trialing — they still hold a slot)
    const activeSubs = allSubs.filter((s) => s.status === "active");
    const foundingMembers = allSubs.filter(
      (s) =>
        s.foundingTier === "founding_member" &&
        (s.status === "active" || s.status === "trialing"),
    );
    let foundingMrrContribution = 0;
    let foundingMrrLoss = 0;
    for (const sub of foundingMembers) {
      const base = monthlyListPriceForSubscription(sub);
      const discount = sub.discountPercent || 0;
      foundingMrrContribution += base * (1 - discount / 100);
      foundingMrrLoss += base * (discount / 100);
    }
    const foundingDetails = [
      {
        tierKey: "founding_member" as const,
        label: FOUNDING_MEMBER.label,
        discountPercent: FOUNDING_MEMBER.discountPercent,
        maxSlots: FOUNDING_MEMBER.maxSlots,
        occupied: foundingMembers.length,
        mrrContribution: Math.round(foundingMrrContribution * 100) / 100,
        mrrLoss: Math.round(foundingMrrLoss * 100) / 100,
      },
    ];

    // Discount distribution
    const discountGroups: Record<number, { count: number; mrrImpact: number }> =
      {};
    for (const sub of activeSubs) {
      const pct = sub.discountPercent || 0;
      if (!discountGroups[pct])
        discountGroups[pct] = { count: 0, mrrImpact: 0 };
      discountGroups[pct].count++;
      const base = monthlyListPriceForSubscription(sub);
      discountGroups[pct].mrrImpact += base * (pct / 100);
    }
    const discountDistribution = Object.entries(discountGroups)
      .map(([pct, data]) => ({
        discountPercent: Number(pct),
        count: data.count,
        mrrImpact: Math.round(data.mrrImpact * 100) / 100,
      }))
      .sort((a, b) => a.discountPercent - b.discountPercent);

    // Upcoming churn (cancelAtPeriodEnd = true)
    const pendingCancellations = allSubs.filter(
      (s) => s.cancelAtPeriodEnd && s.status === "active",
    );

    // Expiring trials (next 14 days)
    const fourteenDaysOut = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
    const expiringTrials = allSubs
      .filter(
        (s) =>
          s.status === "trialing" &&
          s.trialEndsAt >= now &&
          s.trialEndsAt <= fourteenDaysOut,
      )
      .reduce(
        (acc, s) => {
          const day = toCopenhagenDateStr(s.trialEndsAt);
          acc[day] = (acc[day] || 0) + 1;
          return acc;
        },
        {} as Record<string, number>,
      );

    // Fill in empty days for next 14 days
    const trialsByDay: { label: string; value: number }[] = [];
    for (let i = 0; i < 14; i++) {
      const d = new Date(now.getTime() + i * 24 * 60 * 60 * 1000);
      const key = toCopenhagenDateStr(d);
      const dayLabel = `${Number(key.slice(8, 10))}/${Number(key.slice(5, 7))}`;
      trialsByDay.push({ label: dayLabel, value: expiringTrials[key] || 0 });
    }

    return {
      breakdown,
      foundingDetails,
      discountDistribution,
      pendingCancellations: pendingCancellations.length,
      pendingCancellationDetails: pendingCancellations.map((s) => ({
        userId: s.userId,
        billingCycle: s.billingCycle,
        currentPeriodEnd: s.currentPeriodEnd,
        discountPercent: s.discountPercent || 0,
      })),
      expiringTrials: trialsByDay,
    };
  }),

  getMrrHistory: supporterProcedure
    .input(z.object({ monthsBack: z.number().min(1).max(36).default(12) }))
    .query(async ({ ctx, input }) => {
      const allSubs = await fetchNonDemoSubscriptions(ctx.db);
      const now = new Date();
      const months: {
        month: string;
        mrr: number;
        potentialMrr: number;
        subscribers: number;
        trialingSubs: number;
        newSubs: number;
        churned: number;
      }[] = [];

      // Danske måneder uanset processens TZ (#734)
      const thisMonth = monthStartDateStr(copenhagenToday(now));
      for (let i = input.monthsBack - 1; i >= 0; i--) {
        const monthStr = addMonthsToDateStr(thisMonth, -i);
        const monthStart = copenhagenDayStart(monthStr);
        const monthEnd = new Date(
          copenhagenDayStart(addMonthsToDateStr(monthStr, 1)).getTime() - 1,
        );

        // Active in this month: created before month end, not canceled before month start, not trialing
        const activeInMonth = allSubs.filter((s) => {
          if (s.createdAt > monthEnd) return false;
          if (
            s.status === "canceled" &&
            s.canceledAt &&
            s.canceledAt < monthStart
          )
            return false;
          if (s.status === "trialing" && s.trialEndsAt > monthEnd) return false;
          // Include active, past_due, and trialing that converted
          return (
            s.status === "active" ||
            s.status === "past_due" ||
            (s.status === "canceled" &&
              (!s.canceledAt || s.canceledAt >= monthStart)) ||
            (s.status === "trialing" && s.trialEndsAt <= monthEnd)
          );
        });

        // Trials whose trial ends within this month (potential conversions)
        const trialsConvertingInMonth = allSubs.filter((s) => {
          if (s.status !== "trialing") return false;
          return s.trialEndsAt >= monthStart && s.trialEndsAt <= monthEnd;
        });

        let mrr = 0;
        for (const sub of activeInMonth) {
          const base = monthlyListPriceForSubscription(sub);
          const discount = sub.discountPercent || 0;
          mrr += base * (1 - discount / 100);
        }

        // Potential MRR = actual MRR + what trials would add when they convert
        let trialMrr = 0;
        for (const sub of trialsConvertingInMonth) {
          const base = monthlyListPriceForSubscription(sub);
          const discount = sub.discountPercent || 0;
          trialMrr += base * (1 - discount / 100);
        }

        // New this month
        const newThisMonth = allSubs.filter(
          (s) =>
            s.createdAt >= monthStart &&
            s.createdAt <= monthEnd &&
            s.status !== "trialing",
        ).length;

        // Churned this month
        const churnedThisMonth = allSubs.filter(
          (s) =>
            s.status === "canceled" &&
            s.canceledAt &&
            s.canceledAt >= monthStart &&
            s.canceledAt <= monthEnd,
        ).length;

        const label = monthStr.slice(0, 7);
        months.push({
          month: label,
          mrr: Math.round(mrr * 100) / 100,
          potentialMrr: Math.round((mrr + trialMrr) * 100) / 100,
          subscribers: activeInMonth.length,
          trialingSubs: trialsConvertingInMonth.length,
          newSubs: newThisMonth,
          churned: churnedThisMonth,
        });
      }

      return months;
    }),

  getAccrualSchedule: adminProcedure
    .input(z.object({ year: z.number().min(2020).max(2040) }))
    .query(async ({ ctx, input }) => {
      const allSubs = await fetchNonDemoSubscriptions(ctx.db);
      const { year } = input;

      const monthlySchedule: {
        month: string;
        yearlyRecognized: number;
        monthlyRecognized: number;
        total: number;
        deferredRevenue: number;
      }[] = [];

      // Track yearly accrual entries
      const yearlyAccruals: {
        userId: string;
        totalPaid: number;
        monthlyRecognition: number;
        periodStart: Date;
        periodEnd: Date;
      }[] = [];

      // Yearly subscriptions accrual
      const yearlySubs = allSubs.filter(
        (s) =>
          s.billingCycle === "yearly" &&
          (s.status === "active" || s.status === "past_due"),
      );

      for (const sub of yearlySubs) {
        const pStart = sub.currentPeriodStart || sub.createdAt;
        const pEnd =
          sub.currentPeriodEnd ||
          new Date(pStart.getTime() + 365 * 24 * 60 * 60 * 1000);
        const discount = sub.discountPercent || 0;
        const totalPaid =
          cycleListPriceForSubscription(sub) * (1 - discount / 100);
        const monthlyRecognition = totalPaid / 12;
        yearlyAccruals.push({
          userId: sub.userId,
          totalPaid,
          monthlyRecognition,
          periodStart: pStart,
          periodEnd: pEnd,
        });
      }

      // Monthly subs active count per month
      const monthlySubs = allSubs.filter(
        (s) =>
          s.billingCycle === "monthly" &&
          (s.status === "active" || s.status === "past_due"),
      );

      let totalDeferredCarry = 0;

      for (let m = 0; m < 12; m++) {
        const mStart = new Date(year, m, 1);
        const mEnd = new Date(year, m + 1, 0, 23, 59, 59);
        const monthLabel = `${year}-${String(m + 1).padStart(2, "0")}`;

        // Yearly recognized this month
        let yearlyRec = 0;
        let yearlyCashThisMonth = 0;
        for (const accrual of yearlyAccruals) {
          // Does this accrual overlap with this month?
          if (accrual.periodStart <= mEnd && accrual.periodEnd >= mStart) {
            yearlyRec += accrual.monthlyRecognition;
          }
          // Cash received this month (period start in this month)
          if (accrual.periodStart >= mStart && accrual.periodStart <= mEnd) {
            yearlyCashThisMonth += accrual.totalPaid;
          }
        }

        // Monthly recognized this month (count active monthly subs)
        const activeMonthly = monthlySubs.filter((s) => {
          if (s.createdAt > mEnd) return false;
          if (s.status === "canceled" && s.canceledAt && s.canceledAt < mStart)
            return false;
          return true;
        });
        let monthlyRec = 0;
        for (const sub of activeMonthly) {
          const discount = sub.discountPercent || 0;
          monthlyRec +=
            cycleListPriceForSubscription(sub) * (1 - discount / 100);
        }

        const total = yearlyRec + monthlyRec;
        // Deferred = cash received - recognized (cumulative)
        totalDeferredCarry += yearlyCashThisMonth - yearlyRec;

        monthlySchedule.push({
          month: monthLabel,
          yearlyRecognized: Math.round(yearlyRec * 100) / 100,
          monthlyRecognized: Math.round(monthlyRec * 100) / 100,
          total: Math.round(total * 100) / 100,
          deferredRevenue: Math.round(totalDeferredCarry * 100) / 100,
        });
      }

      const totalRecognized = monthlySchedule.reduce((s, m) => s + m.total, 0);
      const totalDeferred =
        monthlySchedule[monthlySchedule.length - 1]?.deferredRevenue || 0;
      const totalCash = totalRecognized + totalDeferred;

      return {
        year,
        months: monthlySchedule,
        summary: {
          totalRecognized: Math.round(totalRecognized * 100) / 100,
          totalDeferred: Math.round(totalDeferred * 100) / 100,
          totalCash: Math.round(totalCash * 100) / 100,
        },
      };
    }),

  getRevenueForecasts: supporterProcedure
    .input(z.object({ monthsForward: z.number().min(1).max(36).default(12) }))
    .query(async ({ ctx, input }) => {
      const allSubs = await fetchNonDemoSubscriptions(ctx.db);
      const now = new Date();

      const activeSubs = allSubs.filter((s) => s.status === "active");

      // Current MRR
      let currentMrr = 0;
      for (const sub of activeSubs) {
        const base = monthlyListPriceForSubscription(sub);
        const discount = sub.discountPercent || 0;
        currentMrr += base * (1 - discount / 100);
      }

      // Average rates over last 3 months
      const threeMonthsAgo = copenhagenDayStart(
        addMonthsToDateStr(monthStartDateStr(copenhagenToday(now)), -3),
      );
      const recentCanceled = allSubs.filter(
        (s) =>
          s.status === "canceled" &&
          s.canceledAt &&
          s.canceledAt >= threeMonthsAgo,
      ).length;
      const avgMonthlyChurn =
        activeSubs.length > 0
          ? recentCanceled / 3 / (activeSubs.length + recentCanceled / 3)
          : 0;

      const recentNew = allSubs.filter(
        (s) =>
          s.createdAt >= threeMonthsAgo &&
          s.status !== "trialing" &&
          s.status !== "canceled",
      ).length;
      const avgMonthlyNewSubs = recentNew / 3;

      // Average revenue per new sub (use current ARPU)
      const arpu =
        activeSubs.length > 0
          ? currentMrr / activeSubs.length
          : SUBSCRIPTION_PRICE_MONTHLY;

      type Scenario = {
        month: string;
        mrr: number;
        arr: number;
        subscribers: number;
      };

      function projectScenario(
        churnMultiplier: number,
        growthMultiplier: number,
      ): Scenario[] {
        const results: Scenario[] = [];
        let mrr = currentMrr;
        let subs = activeSubs.length;

        for (let i = 1; i <= input.monthsForward; i++) {
          const label = addMonthsToDateStr(
            monthStartDateStr(copenhagenToday(now)),
            i,
          ).slice(0, 7);

          const churned = Math.round(subs * avgMonthlyChurn * churnMultiplier);
          const newSubs = Math.round(avgMonthlyNewSubs * growthMultiplier);

          subs = Math.max(0, subs - churned + newSubs);
          mrr = Math.max(0, mrr - churned * arpu + newSubs * arpu);

          results.push({
            month: label,
            mrr: Math.round(mrr * 100) / 100,
            arr: Math.round(mrr * 12 * 100) / 100,
            subscribers: subs,
          });
        }
        return results;
      }

      const optimistic = projectScenario(0.5, 1.25);
      const baseline = projectScenario(1, 1);
      const pessimistic = projectScenario(1.5, 0.75);

      // Milestones (baseline)
      const milestones: { target: number; month: string | null }[] = [];
      for (const target of [10000, 50000, 100000]) {
        const hit = baseline.find((m) => m.mrr >= target);
        milestones.push({ target, month: hit?.month || null });
      }

      return {
        currentMrr: Math.round(currentMrr * 100) / 100,
        avgMonthlyChurnRate: Math.round(avgMonthlyChurn * 10000) / 100,
        avgMonthlyNewSubs: Math.round(avgMonthlyNewSubs * 100) / 100,
        scenarios: { optimistic, baseline, pessimistic },
        milestones,
      };
    }),

  getBookkeepingGuide: adminProcedure.query(async ({ ctx }) => {
    const allSubs = await fetchNonDemoSubscriptions(ctx.db);
    const now = new Date();
    const year = now.getFullYear();

    const activeSubs = allSubs.filter((s) => s.status === "active");
    const activeMonthly = activeSubs.filter(
      (s) => s.billingCycle === "monthly",
    );
    const activeYearly = activeSubs.filter((s) => s.billingCycle === "yearly");

    // Cash inflow calculations
    let monthlyCashPerMonth = 0;
    for (const sub of activeMonthly) {
      const discount = sub.discountPercent || 0;
      monthlyCashPerMonth +=
        cycleListPriceForSubscription(sub) * (1 - discount / 100);
    }
    let yearlyCashTotal = 0;
    for (const sub of activeYearly) {
      const discount = sub.discountPercent || 0;
      yearlyCashTotal +=
        cycleListPriceForSubscription(sub) * (1 - discount / 100);
    }

    const annualMonthlyCash = monthlyCashPerMonth * 12;
    const totalCashInflow = annualMonthlyCash + yearlyCashTotal;

    // Deferred revenue (yearly subs, unrecognized months)
    let deferredRevenue = 0;
    for (const sub of activeYearly) {
      const pStart = copenhagenParts(sub.currentPeriodStart || sub.createdAt);
      const nowParts = copenhagenParts(now);
      const monthsElapsed = Math.max(
        0,
        (nowParts.year - pStart.year) * 12 + (nowParts.month - pStart.month),
      );
      const discount = sub.discountPercent || 0;
      const totalPaid =
        cycleListPriceForSubscription(sub) * (1 - discount / 100);
      const recognized = (totalPaid / 12) * Math.min(12, monthsElapsed);
      deferredRevenue += totalPaid - recognized;
    }

    // Payment processor fees estimate (1.4% + 1.80 DKK per transaction)
    const monthlyTransactions = activeMonthly.length;
    const yearlyTransactions = activeYearly.length; // per year
    const processorFeesMonthly =
      monthlyCashPerMonth * 0.014 + monthlyTransactions * 1.8;
    const processorFeesYearly =
      yearlyCashTotal * 0.014 + yearlyTransactions * 1.8;
    const totalProcessorFees = processorFeesMonthly * 12 + processorFeesYearly;

    // Discount loss
    let totalDiscountLoss = 0;
    for (const sub of activeSubs) {
      // Annualised full price = monthly-normalised list × 12 (works for both
      // cycles, tier + seats included).
      const base = monthlyListPriceForSubscription(sub) * 12;
      totalDiscountLoss += base * ((sub.discountPercent || 0) / 100);
    }

    // Founding member example — founding-planerne er bygget på den gamle
    // solo-pris (grandfathered), ikke prisstige v2.
    const fm = FOUNDING_MEMBER;
    const fmMonthlyPrice =
      Math.round(
        LEGACY_SUBSCRIPTION_PRICE_MONTHLY *
          (1 - fm.discountPercent / 100) *
          100,
      ) / 100;
    const fmYearlyPrice =
      Math.round(
        LEGACY_SUBSCRIPTION_PRICE_YEARLY * (1 - fm.discountPercent / 100) * 100,
      ) / 100;
    const foundingExamples = [
      {
        tierKey: "founding_member" as const,
        label: fm.label,
        discountPercent: fm.discountPercent,
        freeMonths: fm.freeMonths,
        monthlyPrice: fmMonthlyPrice,
        yearlyPrice: fmYearlyPrice,
        monthlyRecognition: Math.round((fmYearlyPrice / 12) * 100) / 100,
      },
    ];

    return {
      year,
      accounts: [
        {
          number: "1000",
          name: "SaaS-indtægt",
          description: "Abonnementsindtægt",
        },
        {
          number: "1860",
          name: "Betalingsindbetaling",
          description: "Bank/Alunta konto",
        },
        {
          number: "2700",
          name: "Forudbetalt abonnement",
          description: "Periodeafgrænsningsposter (passiv)",
        },
        {
          number: "5840",
          name: "Betalingsgebyrer",
          description: "Transaktionsomkostninger",
        },
      ],
      postingExamples: [
        {
          title: "Månedligt abonnement (fuld pris)",
          debit: {
            account: "1860",
            amount: SUBSCRIPTION_PRICE_MONTHLY,
            label: "Alunta",
          },
          credit: {
            account: "1000",
            amount: SUBSCRIPTION_PRICE_MONTHLY,
            label: "SaaS-indtægt",
          },
        },
        {
          title: "Årligt abonnement (periodisering)",
          steps: [
            {
              description: "Ved betaling",
              debit: {
                account: "1860",
                amount: SUBSCRIPTION_PRICE_YEARLY,
                label: "Alunta",
              },
              credit: {
                account: "2700",
                amount: SUBSCRIPTION_PRICE_YEARLY,
                label: "Forudbetalt",
              },
            },
            {
              description: "Månedlig frigivelse (1/12)",
              debit: {
                account: "2700",
                amount:
                  Math.round((SUBSCRIPTION_PRICE_YEARLY / 12) * 100) / 100,
                label: "Forudbetalt",
              },
              credit: {
                account: "1000",
                amount:
                  Math.round((SUBSCRIPTION_PRICE_YEARLY / 12) * 100) / 100,
                label: "SaaS-indtægt",
              },
            },
          ],
        },
        {
          title: "Refundering",
          debit: {
            account: "1000",
            amount: SUBSCRIPTION_PRICE_MONTHLY,
            label: "SaaS-indtægt",
          },
          credit: {
            account: "1860",
            amount: SUBSCRIPTION_PRICE_MONTHLY,
            label: "Alunta",
          },
        },
      ],
      foundingExamples,
      financials: {
        monthlyCashPerMonth: Math.round(monthlyCashPerMonth * 100) / 100,
        annualMonthlyCash: Math.round(annualMonthlyCash * 100) / 100,
        yearlyCashTotal: Math.round(yearlyCashTotal * 100) / 100,
        totalCashInflow: Math.round(totalCashInflow * 100) / 100,
        deferredRevenue: Math.round(deferredRevenue * 100) / 100,
        processorFeesMonthly: Math.round(processorFeesMonthly * 100) / 100,
        processorFeesYearly: Math.round(processorFeesYearly * 100) / 100,
        totalProcessorFees: Math.round(totalProcessorFees * 100) / 100,
        totalDiscountLoss: Math.round(totalDiscountLoss * 100) / 100,
      },
      vatInfo: {
        rate: 25,
        description:
          "Dansk moms 25%. Ved salg til EU-virksomheder med gyldigt CVR/VAT-nr: omvendt betalingspligt (reverse charge).",
      },
    };
  }),

  /**
   * Sync subscriptions from Alunta API -> local database.
   * Fetches all Alunta subscriptions and reconciles with local records
   * using external_customer_id (userId).
   */
  syncFromAlunta: adminProcedure.mutation(async ({ ctx }) => {
    let synced = 0;
    let created = 0;
    let skipped = 0;
    const errors: string[] = [];

    // Fetch all subscriptions from Alunta (paginated)
    let page = 1;
    let allAluntaSubs: AluntaSubscriptionFull[] = [];
    while (true) {
      const res = await alunta.subscriptions.list({
        page: String(page),
        per_page: "100",
      });
      // The response data items may have extended fields
      allAluntaSubs = allAluntaSubs.concat(
        res.data as unknown as AluntaSubscriptionFull[],
      );
      if (!res.meta || page >= res.meta.last_page) break;
      page++;
    }

    // Get all local subscriptions for quick lookup
    const localSubs = await ctx.db.query.subscriptions.findMany();
    const subByUserId = new Map(localSubs.map((s) => [s.userId, s]));
    const subByAluntaId = new Map(
      localSubs.flatMap((s) =>
        s.aluntaSubscriptionId
          ? [[s.aluntaSubscriptionId, s] as [string, typeof s]]
          : [],
      ),
    );

    for (const aSub of allAluntaSubs) {
      try {
        const userId =
          aSub.customer?.external_customer_id || aSub.external_customer_id;
        const aluntaSubId = aSub.uuid;

        // Find local subscription: by Alunta ID first, then by userId
        let localSub = subByAluntaId.get(aluntaSubId);
        if (!localSub && userId) {
          localSub = subByUserId.get(userId);
        }
        // Betalt i appen: et (gammelt) Alunta-abonnement må ikke overskrive
        // den status og periode butikken styrer.
        if (localSub && isStoreManaged(localSub)) {
          skipped++;
          continue;
        }

        if (!localSub) {
          // No local subscription — can't create without a valid userId
          if (!userId) {
            skipped++;
            continue;
          }
          // Verify user exists
          const user = await ctx.db.query.users.findFirst({
            where: eq(users.id, userId),
            columns: { id: true },
          });
          if (!user) {
            skipped++;
            continue;
          }

          // Determine billing cycle from interval or plan name
          const billingCycle = guessBillingCycle(aSub);
          const status = mapAluntaStatusSync(aSub.status);

          await ctx.db.insert(subscriptions).values({
            userId,
            billingCycle,
            status,
            isTrial: status === "trialing",
            trialEndsAt: new Date(), // Already past trial if from Alunta
            aluntaSubscriptionId: aluntaSubId,
            aluntaCustomerId: aSub.customer?.uuid || null,
            aluntaPlanId: aSub.plan?.uuid || null,
            currentPeriodStart: aSub.start_date
              ? new Date(aSub.start_date)
              : null,
            currentPeriodEnd: aSub.end_date ? new Date(aSub.end_date) : null,
          });
          created++;
          continue;
        }

        // Update existing local subscription
        const status = mapAluntaStatusSync(aSub.status);
        // Detect billing cycle from Alunta's interval/plan and persist if
        // it differs — covers the case where a user upgrades mo→yearly in
        // the Alunta portal.
        const detectedCycle = guessBillingCycle(aSub);
        await ctx.db
          .update(subscriptions)
          .set({
            aluntaSubscriptionId: aluntaSubId,
            aluntaCustomerId: aSub.customer?.uuid || localSub.aluntaCustomerId,
            aluntaPlanId: aSub.plan?.uuid || localSub.aluntaPlanId,
            billingCycle: detectedCycle,
            status,
            isTrial: status === "trialing",
            currentPeriodStart: aSub.start_date
              ? new Date(aSub.start_date)
              : localSub.currentPeriodStart,
            currentPeriodEnd: aSub.end_date
              ? new Date(aSub.end_date)
              : localSub.currentPeriodEnd,
            canceledAt:
              status === "canceled" ? localSub.canceledAt || new Date() : null,
            pastDueSince:
              status === "past_due"
                ? localSub.pastDueSince || new Date()
                : null,
            updatedAt: new Date(),
          })
          .where(eq(subscriptions.id, localSub.id));
        synced++;
      } catch (err) {
        errors.push(
          `Sub ${aSub.uuid}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      total: allAluntaSubs.length,
      synced,
      created,
      skipped,
      errors,
    };
  }),

  // ============================================
  // Alunta Webhook Management
  // ============================================

  listWebhookDeliveries: adminProcedure
    .input(
      z
        .object({
          status: z.string().optional(),
          event: z.string().optional(),
          page: z.number().optional(),
        })
        .optional(),
    )
    .query(async ({ input }) => {
      const params: Record<string, string> = {};
      if (input?.status) params.status = input.status;
      if (input?.event) params.event = input.event;
      if (input?.page) params.page = String(input.page);
      return alunta.webhooks.list(params);
    }),

  getWebhookDelivery: adminProcedure
    .input(z.object({ uuid: z.string() }))
    .query(async ({ input }) => {
      const result = await alunta.webhooks.get(input.uuid);
      return result.data;
    }),

  replayWebhook: adminProcedure
    .input(z.object({ uuid: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "replay_webhook",
        null,
        { webhookUuid: input.uuid },
        ctx.headers,
      );

      const result = await alunta.webhooks.replay(input.uuid);
      return { success: true, data: result.data };
    }),
});
