import {
  aliasedTable,
  and,
  count,
  desc,
  eq,
  gte,
  lt,
  lte,
  notInArray,
  type SQLWrapper,
  sql,
  sum,
} from "drizzle-orm";
import { z } from "zod";
import { sessionOrganizationIdSql } from "@/lib/auth/active-org";
import {
  adminActivityLogs,
  calendarConnections,
  clients,
  extensionTokens,
  invoices,
  organizations,
  prepaidPackages,
  projects,
  sessions,
  subscriptions,
  tasks,
  timeEntries,
  timerStates,
  users,
} from "@/lib/db/schema";
import { syntheticUserIds } from "@/lib/synthetic-users";
import { excludeTestOrganization, excludeTestUsers } from "@/lib/test-accounts";
import {
  addMonthsToDateStr,
  copenhagenDayStart,
  copenhagenToday,
  monthStartDateStr,
} from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

const metricsInput = z
  .object({ includeTestAccounts: z.boolean().optional() })
  .optional();
const metricsProcedure = supporterProcedure.input(metricsInput);

function accountFilters(input?: { includeTestAccounts?: boolean }) {
  const include = input?.includeTestAccounts;
  return {
    realUsers: excludeTestUsers(include),
    realOrganization: (id: SQLWrapper) => excludeTestOrganization(id, include),
  };
}

// Alias for target user in activity logs
const targetUser = aliasedTable(users, "targetUser");

export const adminAnalyticsRouter = router({
  // ============================================
  // System Statistics (Aggregated, GDPR-safe)
  // Supporters can view
  // ============================================

  getSystemStats: metricsProcedure.query(async ({ ctx, input }) => {
    const { realUsers, realOrganization } = accountFilters(input);
    // Log this action
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_system_stats",
      null,
      null,
      ctx.headers,
    );

    // Get counts in parallel for performance.
    // User/client/project/invoice counts now exclude demo users so admin
    // metrics reflect real customers.
    const [
      userCount,
      activeOrganizationCount,
      clientCount,
      projectCount,
      taskCount,
      timeEntryCount,
      invoiceCount,
      totalRevenue,
      // Growth metrics - new users this month
      newUsersThisMonth,
      // Flagged users
      flaggedUserCount,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.isDemo, false), realUsers)),
      ctx.db
        .select({ count: sql<number>`count(distinct ${organizations.id})` })
        .from(sessions)
        .innerJoin(
          organizations,
          eq(sessionOrganizationIdSql(), organizations.id),
        )
        .innerJoin(users, eq(sessions.userId, users.id))
        .where(
          and(
            gte(sessions.createdAt, new Date(Date.now() - 30 * 86_400_000)),
            eq(users.isDemo, false),
            realUsers,
            realOrganization(organizations.id),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(clients)
        .leftJoin(users, eq(clients.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(clients.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(projects)
        .leftJoin(users, eq(projects.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(projects.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(tasks)
        .leftJoin(users, eq(tasks.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(tasks.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(timeEntries)
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(timeEntries.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(invoices)
        .leftJoin(users, eq(invoices.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(invoices.organizationId),
          ),
        ),
      // Platform GMV (users' paid client invoices), excluding demo users
      // so seed / test data doesn't skew the number.
      ctx.db
        .select({ total: sum(invoices.amount) })
        .from(invoices)
        .leftJoin(users, eq(invoices.userId, users.id))
        .where(
          and(
            eq(invoices.status, "paid"),
            eq(users.isDemo, false),
            realUsers,
            realOrganization(invoices.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            gte(
              users.createdAt,
              copenhagenDayStart(monthStartDateStr(copenhagenToday())),
            ),
            and(eq(users.isDemo, false), realUsers),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.isFlagged, true),
            and(eq(users.isDemo, false), realUsers),
          ),
        ),
    ]);

    return {
      totalUsers: userCount[0]?.count ?? 0,
      activeOrganizations: Number(activeOrganizationCount[0]?.count ?? 0),
      totalClients: clientCount[0]?.count ?? 0,
      totalProjects: projectCount[0]?.count ?? 0,
      totalTasks: taskCount[0]?.count ?? 0,
      totalTimeEntries: timeEntryCount[0]?.count ?? 0,
      totalInvoices: invoiceCount[0]?.count ?? 0,
      totalRevenue: totalRevenue[0]?.total ?? "0",
      newUsersThisMonth: newUsersThisMonth[0]?.count ?? 0,
      flaggedUsers: flaggedUserCount[0]?.count ?? 0,
    };
  }),

  // ============================================
  // Admin Activity Log
  // Supporters can view
  // ============================================

  getActivityLog: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        adminUserId: z.string().optional(),
        targetUserId: z.string().optional(),
        action: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action (meta!)
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_activity_log",
        null,
        {
          limit: input.limit,
          offset: input.offset,
          filters: {
            adminUserId: input.adminUserId,
            targetUserId: input.targetUserId,
            action: input.action,
          },
        },
        ctx.headers,
      );

      // Build where conditions
      const conditions = [];
      if (input.adminUserId) {
        conditions.push(eq(adminActivityLogs.adminUserId, input.adminUserId));
      }
      if (input.targetUserId) {
        conditions.push(eq(adminActivityLogs.targetUserId, input.targetUserId));
      }
      if (input.action) {
        conditions.push(eq(adminActivityLogs.action, input.action));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const logs = await ctx.db
        .select({
          id: adminActivityLogs.id,
          action: adminActivityLogs.action,
          targetUserId: adminActivityLogs.targetUserId,
          details: adminActivityLogs.details,
          ipAddress: adminActivityLogs.ipAddress,
          userAgent: adminActivityLogs.userAgent,
          createdAt: adminActivityLogs.createdAt,
          adminId: users.id,
          adminName: users.name,
          targetUserName: targetUser.name,
        })
        .from(adminActivityLogs)
        .leftJoin(users, eq(adminActivityLogs.adminUserId, users.id))
        .leftJoin(targetUser, eq(adminActivityLogs.targetUserId, targetUser.id))
        .where(whereClause)
        .orderBy(desc(adminActivityLogs.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get total count
      const totalQuery = ctx.db
        .select({ count: count() })
        .from(adminActivityLogs);

      const totalCount = whereClause
        ? await totalQuery.where(whereClause)
        : await totalQuery;

      return {
        logs: logs.map((log) => ({
          ...log,
          admin: log.adminId ? { id: log.adminId, name: log.adminName } : null,
          targetUser: log.targetUserId
            ? { id: log.targetUserId, name: log.targetUserName }
            : null,
        })),
        total: totalCount[0]?.count ?? 0,
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ============================================
  // Activity Log Export
  // ============================================

  exportActivityLog: adminProcedure
    .input(
      z.object({
        format: z.enum(["json", "csv"]).default("json"),
        dateFrom: z.date().optional(),
        dateTo: z.date().optional(),
        action: z.string().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "export_activity_log",
        null,
        { format: input.format },
        ctx.headers,
      );

      const conditions = [];
      if (input.dateFrom) {
        conditions.push(gte(adminActivityLogs.createdAt, input.dateFrom));
      }
      if (input.dateTo) {
        conditions.push(lte(adminActivityLogs.createdAt, input.dateTo));
      }
      if (input.action) {
        conditions.push(eq(adminActivityLogs.action, input.action));
      }

      const logs = await ctx.db
        .select({
          id: adminActivityLogs.id,
          action: adminActivityLogs.action,
          adminUserId: adminActivityLogs.adminUserId,
          targetUserId: adminActivityLogs.targetUserId,
          details: adminActivityLogs.details,
          ipAddress: adminActivityLogs.ipAddress,
          createdAt: adminActivityLogs.createdAt,
        })
        .from(adminActivityLogs)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(adminActivityLogs.createdAt))
        .limit(10000);

      if (input.format === "csv") {
        const header =
          "id,action,adminUserId,targetUserId,ipAddress,createdAt\n";
        const rows = logs.map(
          (l) =>
            `${l.id},${l.action},${l.adminUserId},${l.targetUserId ?? ""},${l.ipAddress ?? ""},${l.createdAt.toISOString()}`,
        );
        return { data: header + rows.join("\n"), format: "csv" as const };
      }

      return { data: JSON.stringify(logs, null, 2), format: "json" as const };
    }),

  // ============================================
  // Analytics - User Growth
  // Supporters can view
  // ============================================

  getUserGrowthData: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        monthsBack: z.number().min(1).max(24).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const realUsers = excludeTestUsers(input.includeTestAccounts);
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_user_growth",
        null,
        { monthsBack: input.monthsBack },
        ctx.headers,
      );

      // Get user signups grouped by month
      // Dansk månedsstart uanset processens TZ (#734)
      const startDate = copenhagenDayStart(
        addMonthsToDateStr(
          monthStartDateStr(copenhagenToday()),
          -input.monthsBack,
        ),
      );

      const growth = await ctx.db
        .select({
          month:
            sql<string>`TO_CHAR(${copenhagenDateSql(users.createdAt)}, 'YYYY-MM')`.as(
              "month",
            ),
          count: count(),
        })
        .from(users)
        .where(
          and(
            gte(users.createdAt, startDate),
            and(eq(users.isDemo, false), realUsers),
          ),
        )
        .groupBy(sql`TO_CHAR(${copenhagenDateSql(users.createdAt)}, 'YYYY-MM')`)
        .orderBy(
          sql`TO_CHAR(${copenhagenDateSql(users.createdAt)}, 'YYYY-MM')`,
        );

      return growth;
    }),

  // ============================================
  // Analytics - Feature Usage
  // Supporters can view
  // ============================================

  getFeatureUsageStats: metricsProcedure.query(async ({ ctx, input }) => {
    const { realUsers, realOrganization } = accountFilters(input);
    // Log this action
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_feature_usage",
      null,
      null,
      ctx.headers,
    );

    const [
      activeTimersCount,
      prepaidPackagesCount,
      invoicesCount,
      calendarConnectionsCount,
      extensionUsersCount,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(timerStates)
        .innerJoin(users, eq(timerStates.userId, users.id))
        .where(
          and(
            eq(timerStates.isRunning, true),
            realUsers,
            realOrganization(timerStates.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(prepaidPackages)
        .innerJoin(users, eq(prepaidPackages.userId, users.id))
        .where(
          and(
            eq(prepaidPackages.isActive, true),
            realUsers,
            realOrganization(prepaidPackages.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(invoices)
        .innerJoin(users, eq(invoices.userId, users.id))
        .where(
          and(
            eq(invoices.status, "paid"),
            realUsers,
            realOrganization(invoices.organizationId),
          ),
        ),
      ctx.db
        .select({ count: count() })
        .from(calendarConnections)
        .innerJoin(users, eq(calendarConnections.userId, users.id))
        .where(
          and(
            eq(calendarConnections.syncEnabled, true),
            realUsers,
            realOrganization(calendarConnections.organizationId),
          ),
        ),
      ctx.db
        .selectDistinct({ userId: extensionTokens.userId })
        .from(extensionTokens)
        .innerJoin(users, eq(extensionTokens.userId, users.id))
        .where(realUsers),
    ]);

    return {
      activeTimers: activeTimersCount[0]?.count ?? 0,
      activePrepaidPackages: prepaidPackagesCount[0]?.count ?? 0,
      paidInvoices: invoicesCount[0]?.count ?? 0,
      calendarConnections: calendarConnectionsCount[0]?.count ?? 0,
      extensionUsers: extensionUsersCount.length,
    };
  }),

  // ============================================
  // Analytics - Revenue Trends
  // Supporters can view
  // ============================================

  getRevenueTrends: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        monthsBack: z.number().min(1).max(24).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { realUsers, realOrganization } = accountFilters(input);
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_revenue_trends",
        null,
        { monthsBack: input.monthsBack },
        ctx.headers,
      );

      // Dansk månedsstart uanset processens TZ (#734)
      const startDate = copenhagenDayStart(
        addMonthsToDateStr(
          monthStartDateStr(copenhagenToday()),
          -input.monthsBack,
        ),
      );

      // Exclude demo users so seed/test invoices (like the 9.9M test
      // invoice on a test account) don't spike the chart.
      const revenue = await ctx.db
        .select({
          month:
            sql<string>`TO_CHAR(${copenhagenDateSql(invoices.paidDate)}, 'YYYY-MM')`.as(
              "month",
            ),
          total: sum(invoices.amount),
          count: count(),
        })
        .from(invoices)
        .leftJoin(users, eq(invoices.userId, users.id))
        .where(
          and(
            eq(invoices.status, "paid"),
            gte(invoices.paidDate, startDate),
            realOrganization(invoices.organizationId),
            and(eq(users.isDemo, false), realUsers),
          ),
        )
        .groupBy(
          sql`TO_CHAR(${copenhagenDateSql(invoices.paidDate)}, 'YYYY-MM')`,
        )
        .orderBy(
          sql`TO_CHAR(${copenhagenDateSql(invoices.paidDate)}, 'YYYY-MM')`,
        );

      return revenue;
    }),

  // ============================================
  // Engagement & Retention Analytics
  // ============================================

  getActiveUserCounts: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        daysBack: z.number().min(1).max(365).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { realUsers, realOrganization } = accountFilters(input);
      const now = new Date();

      const dauDate = new Date(now);
      dauDate.setDate(dauDate.getDate() - 1);

      const wauDate = new Date(now);
      wauDate.setDate(wauDate.getDate() - 7);

      const mauDate = new Date(now);
      mauDate.setDate(mauDate.getDate() - 30);

      // Syntetiske overvågningskonti logger ind hver time — tæl dem ikke med
      const synthetic = syntheticUserIds();
      const notSynthetic = synthetic.length
        ? notInArray(sessions.userId, synthetic)
        : undefined;

      const [dau, wau, mau] = await Promise.all([
        ctx.db
          .select({ count: sql<number>`count(distinct ${sessions.userId})` })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(
            and(
              gte(sessions.createdAt, dauDate),
              notSynthetic,
              realUsers,
              realOrganization(sessionOrganizationIdSql()),
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(distinct ${sessions.userId})` })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(
            and(
              gte(sessions.createdAt, wauDate),
              notSynthetic,
              realUsers,
              realOrganization(sessionOrganizationIdSql()),
            ),
          ),
        ctx.db
          .select({ count: sql<number>`count(distinct ${sessions.userId})` })
          .from(sessions)
          .innerJoin(users, eq(sessions.userId, users.id))
          .where(
            and(
              gte(sessions.createdAt, mauDate),
              notSynthetic,
              realUsers,
              realOrganization(sessionOrganizationIdSql()),
            ),
          ),
      ]);

      return {
        dau: Number(dau[0]?.count ?? 0),
        wau: Number(wau[0]?.count ?? 0),
        mau: Number(mau[0]?.count ?? 0),
      };
    }),

  /**
   * Customer journey stages: how many users are currently in each
   * lifecycle stage, and how long they've been there. A snapshot view
   * of the population across the funnel, not a cohort analysis.
   *
   * Stages (mutually exclusive, in order):
   *  1. Brand new: signup <24h ago
   *  2. Onboarding: onboarding not completed
   *  3. Trial (no activity): in trial, no time entries
   *  4. Trial (active): in trial + has time entries
   *  5. Paying: active subscription
   *  6. Lapsed: canceled or past_due
   *  7. Dormant: active but no login in >30 days
   */
  getJourneyStages: metricsProcedure.query(async ({ ctx, input }) => {
    const { realUsers, realOrganization } = accountFilters(input);
    const now = new Date();
    const oneDayAgo = new Date(now);
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const rows = await ctx.db
      .select({
        userId: users.id,
        userName: users.name,
        userEmail: users.email,
        createdAt: users.createdAt,
        onboardingCompleted: users.onboardingCompleted,
        // NB: subqueries must qualify the outer users.id as "user"."id" —
        // Drizzle renders ${users.id} as bare "id" inside nested sql\`\`
        // templates, which postgres resolves to the subquery table's own
        // id column (uuid in time_entries/subscriptions) → text=uuid error.
        lastSessionAt: sql<Date | null>`(
          SELECT MAX(${sessions.createdAt})
          FROM ${sessions}
          WHERE "session"."userId" = "user"."id"
            AND ${realOrganization(sessionOrganizationIdSql(sql`"session"."userId"`, sql`"session"."activeOrganizationId"`)) ?? sql`true`}
        )`
          .mapWith(sessions.createdAt)
          .as("lastSessionAt"),
        subStatus: sql<string | null>`(
          SELECT status FROM ${subscriptions}
          WHERE subscriptions.user_id = "user"."id"
            AND ${realOrganization(sql`subscriptions.organization_id`) ?? sql`true`}
          LIMIT 1
        )`.as("subStatus"),
        hasTimeEntries: sql<boolean>`EXISTS (
          SELECT 1 FROM time_entries
          WHERE time_entries.user_id = "user"."id"
            AND ${realOrganization(sql`time_entries.organization_id`) ?? sql`true`}
          LIMIT 1
        )`.as("hasTimeEntries"),
      })
      .from(users)
      .where(and(eq(users.isDemo, false), realUsers));

    const buckets = {
      brand_new: [] as typeof rows,
      onboarding: [] as typeof rows,
      trial_idle: [] as typeof rows,
      trial_active: [] as typeof rows,
      paying: [] as typeof rows,
      lapsed: [] as typeof rows,
      dormant: [] as typeof rows,
    };

    for (const row of rows) {
      if (row.subStatus === "canceled" || row.subStatus === "past_due") {
        buckets.lapsed.push(row);
        continue;
      }
      if (row.subStatus === "active") {
        const last = row.lastSessionAt ? new Date(row.lastSessionAt) : null;
        if (!last || last.getTime() < thirtyDaysAgo.getTime()) {
          buckets.dormant.push(row);
        } else {
          buckets.paying.push(row);
        }
        continue;
      }
      // Trialing or no subscription
      if (row.createdAt.getTime() > oneDayAgo.getTime()) {
        buckets.brand_new.push(row);
        continue;
      }
      if (!row.onboardingCompleted) {
        buckets.onboarding.push(row);
        continue;
      }
      if (row.hasTimeEntries) {
        buckets.trial_active.push(row);
      } else {
        buckets.trial_idle.push(row);
      }
    }

    const stages = [
      {
        key: "brand_new",
        label: "Helt ny",
        description: "Signup <24 timer",
        count: buckets.brand_new.length,
        users: buckets.brand_new.slice(0, 10),
      },
      {
        key: "onboarding",
        label: "Onboarding",
        description: "Ikke fuldført onboarding",
        count: buckets.onboarding.length,
        users: buckets.onboarding.slice(0, 10),
      },
      {
        key: "trial_idle",
        label: "Trial inaktiv",
        description: "Ingen tidsregistreringer endnu",
        count: buckets.trial_idle.length,
        users: buckets.trial_idle.slice(0, 10),
      },
      {
        key: "trial_active",
        label: "Trial aktiv",
        description: "Har logget tid",
        count: buckets.trial_active.length,
        users: buckets.trial_active.slice(0, 10),
      },
      {
        key: "paying",
        label: "Betalende",
        description: "Aktiv subscription + nylig login",
        count: buckets.paying.length,
        users: buckets.paying.slice(0, 10),
      },
      {
        key: "dormant",
        label: "Dvalende",
        description: "Betaler men har ikke logget ind i 30d",
        count: buckets.dormant.length,
        users: buckets.dormant.slice(0, 10),
      },
      {
        key: "lapsed",
        label: "Tabt",
        description: "Canceled eller past due",
        count: buckets.lapsed.length,
        users: buckets.lapsed.slice(0, 10),
      },
    ];

    return {
      stages,
      total: rows.length,
    };
  }),

  /**
   * Signup attribution breakdown: where did users come from?
   * Groups by utm_source with a fallback to "direct" when nothing is set.
   */
  getAttributionBreakdown: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        daysBack: z.number().min(1).max(365).default(90),
      }),
    )
    .query(async ({ ctx, input }) => {
      const realUsers = excludeTestUsers(input.includeTestAccounts);
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const rows = await ctx.db
        .select({
          source: sql<string>`COALESCE(${users.attrSource}, 'direct')`.as(
            "source",
          ),
          count: count(),
        })
        .from(users)
        .where(
          and(
            gte(users.createdAt, since),
            and(eq(users.isDemo, false), realUsers),
          ),
        )
        .groupBy(sql`COALESCE(${users.attrSource}, 'direct')`)
        .orderBy(desc(count()));

      const campaignRows = await ctx.db
        .select({
          campaign: users.attrCampaign,
          count: count(),
        })
        .from(users)
        .where(
          and(
            gte(users.createdAt, since),
            sql`${users.attrCampaign} IS NOT NULL`,
            and(eq(users.isDemo, false), realUsers),
          ),
        )
        .groupBy(users.attrCampaign)
        .orderBy(desc(count()))
        .limit(10);

      const totalSignups = rows.reduce((sum, r) => sum + Number(r.count), 0);

      return {
        sources: rows.map((r) => ({
          source: r.source,
          count: Number(r.count),
          percent:
            totalSignups > 0 ? (Number(r.count) / totalSignups) * 100 : 0,
        })),
        topCampaigns: campaignRows.map((r) => ({
          campaign: r.campaign ?? "Unknown",
          count: Number(r.count),
        })),
        totalSignups,
      };
    }),

  getOnboardingFunnel: metricsProcedure.query(async ({ ctx, input }) => {
    const { realUsers, realOrganization } = accountFilters(input);
    const [
      totalUsers,
      completedOnboarding,
      usersWithClients,
      usersWithProjects,
      usersWithTimeEntries,
      usersWithInvoices,
    ] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(users)
        .where(and(eq(users.isDemo, false), realUsers)),
      ctx.db
        .select({ count: count() })
        .from(users)
        .where(
          and(
            eq(users.onboardingCompleted, true),
            and(eq(users.isDemo, false), realUsers),
          ),
        ),
      ctx.db
        .select({ count: sql<number>`count(distinct ${clients.userId})` })
        .from(clients)
        .leftJoin(users, eq(clients.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(clients.organizationId),
          ),
        ),
      ctx.db
        .select({ count: sql<number>`count(distinct ${projects.userId})` })
        .from(projects)
        .leftJoin(users, eq(projects.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(projects.organizationId),
          ),
        ),
      ctx.db
        .select({ count: sql<number>`count(distinct ${timeEntries.userId})` })
        .from(timeEntries)
        .leftJoin(users, eq(timeEntries.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(timeEntries.organizationId),
          ),
        ),
      ctx.db
        .select({ count: sql<number>`count(distinct ${invoices.userId})` })
        .from(invoices)
        .leftJoin(users, eq(invoices.userId, users.id))
        .where(
          and(
            eq(users.isDemo, false),
            realUsers,
            realOrganization(invoices.organizationId),
          ),
        ),
    ]);

    return [
      { label: "Signup", value: Number(totalUsers[0]?.count ?? 0) },
      {
        label: "Onboarding fuldført",
        value: Number(completedOnboarding[0]?.count ?? 0),
      },
      {
        label: "Oprettet kunde",
        value: Number(usersWithClients[0]?.count ?? 0),
      },
      {
        label: "Oprettet projekt",
        value: Number(usersWithProjects[0]?.count ?? 0),
      },
      {
        label: "Registreret tid",
        value: Number(usersWithTimeEntries[0]?.count ?? 0),
      },
      {
        label: "Oprettet faktura",
        value: Number(usersWithInvoices[0]?.count ?? 0),
      },
    ];
  }),

  getFeatureAdoptionRates: metricsProcedure.query(async ({ ctx, input }) => {
    const { realUsers, realOrganization } = accountFilters(input);
    const [
      totalUsers,
      timeUsers,
      invoiceUsers,
      klippekortUsers,
      calendarUsers,
      extensionUsers,
      taskUsers,
    ] = await Promise.all([
      ctx.db.select({ count: count() }).from(users).where(realUsers),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${timeEntries.userId})`,
        })
        .from(timeEntries)
        .innerJoin(users, eq(timeEntries.userId, users.id))
        .where(and(realUsers, realOrganization(timeEntries.organizationId))),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${invoices.userId})`,
        })
        .from(invoices)
        .innerJoin(users, eq(invoices.userId, users.id))
        .where(and(realUsers, realOrganization(invoices.organizationId))),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${prepaidPackages.userId})`,
        })
        .from(prepaidPackages)
        .innerJoin(users, eq(prepaidPackages.userId, users.id))
        .where(
          and(realUsers, realOrganization(prepaidPackages.organizationId)),
        ),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${calendarConnections.userId})`,
        })
        .from(calendarConnections)
        .innerJoin(users, eq(calendarConnections.userId, users.id))
        .where(
          and(realUsers, realOrganization(calendarConnections.organizationId)),
        ),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${extensionTokens.userId})`,
        })
        .from(extensionTokens)
        .innerJoin(users, eq(extensionTokens.userId, users.id))
        .where(realUsers),
      ctx.db
        .select({
          count: sql<number>`count(distinct ${tasks.userId})`,
        })
        .from(tasks)
        .innerJoin(users, eq(tasks.userId, users.id))
        .where(and(realUsers, realOrganization(tasks.organizationId))),
    ]);

    const total = Number(totalUsers[0]?.count ?? 1);

    return [
      {
        feature: "Tidsregistrering",
        users: Number(timeUsers[0]?.count ?? 0),
        total,
      },
      {
        feature: "Fakturering",
        users: Number(invoiceUsers[0]?.count ?? 0),
        total,
      },
      {
        feature: "Klippekort",
        users: Number(klippekortUsers[0]?.count ?? 0),
        total,
      },
      {
        feature: "Kalender sync",
        users: Number(calendarUsers[0]?.count ?? 0),
        total,
      },
      {
        feature: "Browser extension",
        users: Number(extensionUsers[0]?.count ?? 0),
        total,
      },
      {
        feature: "Opgavestyring",
        users: Number(taskUsers[0]?.count ?? 0),
        total,
      },
    ];
  }),

  getUserRetentionCohorts: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        months: z.number().min(1).max(12).default(6),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { realUsers, realOrganization } = accountFilters(input);
      const cohorts: Array<{
        cohortMonth: string;
        signupCount: number;
        retention: number[];
      }> = [];

      // Danske måneder med eksklusiv slutgrænse (#734)
      const thisMonth = monthStartDateStr(copenhagenToday());

      for (let i = input.months - 1; i >= 0; i--) {
        const cohortMonthStr = addMonthsToDateStr(thisMonth, -i);
        const cohortStart = copenhagenDayStart(cohortMonthStr);
        const cohortEnd = copenhagenDayStart(
          addMonthsToDateStr(cohortMonthStr, 1),
        );
        const cohortMonth = cohortMonthStr.slice(0, 7);

        // Users who signed up in this month
        const cohortUsers = await ctx.db
          .select({
            count: count(),
          })
          .from(users)
          .where(
            and(
              gte(users.createdAt, cohortStart),
              lt(users.createdAt, cohortEnd),
              realUsers,
            ),
          );

        const signupCount = Number(cohortUsers[0]?.count ?? 0);
        if (signupCount === 0) {
          cohorts.push({ cohortMonth, signupCount: 0, retention: [] });
          continue;
        }

        // Check retention for each subsequent month
        const retention: number[] = [];
        const maxRetentionMonths = Math.min(i + 1, 6);

        for (let m = 1; m < maxRetentionMonths; m++) {
          const retStart = copenhagenDayStart(
            addMonthsToDateStr(cohortMonthStr, m),
          );
          const retEnd = copenhagenDayStart(
            addMonthsToDateStr(cohortMonthStr, m + 1),
          );

          const activeInMonth = await ctx.db
            .select({
              count: sql<number>`count(distinct ${sessions.userId})`,
            })
            .from(sessions)
            .innerJoin(users, eq(sessions.userId, users.id))
            .where(
              and(
                gte(sessions.createdAt, retStart),
                lt(sessions.createdAt, retEnd),
                gte(users.createdAt, cohortStart),
                lt(users.createdAt, cohortEnd),
                realUsers,
                realOrganization(sessionOrganizationIdSql()),
              ),
            );

          retention.push(Number(activeInMonth[0]?.count ?? 0));
        }

        cohorts.push({ cohortMonth, signupCount, retention });
      }

      return cohorts;
    }),

  getCohortRetention: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        months: z.number().min(3).max(24).default(12),
      }),
    )
    .query(async ({ ctx, input }) => {
      const { realUsers, realOrganization } = accountFilters(input);
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_cohort_retention",
        null,
        { months: input.months },
        ctx.headers,
      );

      const cutoffStr = addMonthsToDateStr(
        monthStartDateStr(copenhagenToday()),
        -input.months,
      );

      // Dansk oprettelsesdato (createdAt er UTC uden tidszone)
      const CPH_CREATED_AT = sql.raw(
        `(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Copenhagen')`,
      );
      const result = await ctx.db.execute(sql`
        WITH cohorts AS (
          SELECT id, date_trunc('month', ${CPH_CREATED_AT}) AS cohort_month
          FROM "user"
          WHERE role = 'user' AND (is_demo IS NULL OR is_demo = false)
            AND ${realUsers ?? sql`true`}
            AND date_trunc('month', ${CPH_CREATED_AT}) >= ${cutoffStr}::date
        ),
        activity AS (
          SELECT user_id, date_trunc('month', date) AS activity_month
          FROM time_entries
          WHERE ${realOrganization(timeEntries.organizationId) ?? sql`true`}
          GROUP BY user_id, date_trunc('month', date)
        )
        SELECT
          to_char(c.cohort_month, 'YYYY-MM') AS cohort,
          (EXTRACT(YEAR FROM age(a.activity_month, c.cohort_month)) * 12
           + EXTRACT(MONTH FROM age(a.activity_month, c.cohort_month)))::int AS month_offset,
          COUNT(DISTINCT c.id) FILTER (WHERE a.user_id IS NOT NULL)::int AS active_count,
          COUNT(DISTINCT c.id)::int AS cohort_size
        FROM cohorts c
        LEFT JOIN activity a ON a.user_id = c.id AND a.activity_month >= c.cohort_month
        GROUP BY cohort, month_offset
        HAVING (EXTRACT(YEAR FROM age(a.activity_month, c.cohort_month)) * 12
                + EXTRACT(MONTH FROM age(a.activity_month, c.cohort_month))) >= 0
            OR a.activity_month IS NULL
        ORDER BY cohort, month_offset
      `);

      // Build response
      const rows = result as unknown as Array<{
        cohort: string;
        month_offset: number | null;
        active_count: number;
        cohort_size: number;
      }>;
      const cohortMap = new Map<
        string,
        {
          cohortSize: number;
          retention: Array<{
            monthOffset: number;
            activeCount: number;
            percentage: number;
          }>;
        }
      >();

      for (const row of rows) {
        let entry = cohortMap.get(row.cohort);
        if (!entry) {
          entry = { cohortSize: row.cohort_size, retention: [] };
          cohortMap.set(row.cohort, entry);
        }
        if (row.month_offset !== null && row.month_offset >= 0) {
          entry.retention.push({
            monthOffset: row.month_offset,
            activeCount: row.active_count,
            percentage:
              entry.cohortSize > 0
                ? Math.round((row.active_count / entry.cohortSize) * 100)
                : 0,
          });
        }
      }

      return {
        cohorts: Array.from(cohortMap.entries()).map(([month, data]) => ({
          month,
          cohortSize: data.cohortSize,
          retention: data.retention.sort(
            (a, b) => a.monthOffset - b.monthOffset,
          ),
        })),
      };
    }),

  getUserEngagementStats: supporterProcedure
    .input(
      z.object({
        includeTestAccounts: z.boolean().optional(),
        limit: z.number().min(1).max(50).default(20),
      }),
    )
    .query(async ({ ctx, input }) => {
      const realUsers = excludeTestUsers(
        input.includeTestAccounts,
        sql`u.id`,
        sql`u.email`,
      );
      // Calculate engagement score: sessions*2 + timeEntries*3 + tasks
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
      const thirtyDaysAgoISO = thirtyDaysAgo.toISOString();

      const result = await ctx.db.execute(sql`
        SELECT
          u.id,
          u.name,
          u.role,
          u."createdAt" as created_at,
          COALESCE(s.session_count, 0) as session_count,
          COALESCE(te.time_entry_count, 0) as time_entry_count,
          COALESCE(t.task_count, 0) as task_count,
          (COALESCE(s.session_count, 0) * 2 + COALESCE(te.time_entry_count, 0) * 3 + COALESCE(t.task_count, 0)) as engagement_score
        FROM "user" u
        LEFT JOIN (
          SELECT "userId", COUNT(*) as session_count
          FROM session
          WHERE "createdAt" >= ${thirtyDaysAgoISO}
            AND ${excludeTestOrganization(sessionOrganizationIdSql(), input.includeTestAccounts) ?? sql`true`}
          GROUP BY "userId"
        ) s ON s."userId" = u.id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as time_entry_count
          FROM time_entries
          WHERE created_at >= ${thirtyDaysAgoISO}
            AND ${excludeTestOrganization(timeEntries.organizationId, input.includeTestAccounts) ?? sql`true`}
          GROUP BY user_id
        ) te ON te.user_id = u.id
        LEFT JOIN (
          SELECT user_id, COUNT(*) as task_count
          FROM tasks
          WHERE created_at >= ${thirtyDaysAgoISO}
            AND ${excludeTestOrganization(tasks.organizationId, input.includeTestAccounts) ?? sql`true`}
          GROUP BY user_id
        ) t ON t.user_id = u.id
        WHERE ${realUsers ?? sql`true`}
        ORDER BY engagement_score DESC
        LIMIT ${input.limit}
      `);

      return (
        result as unknown as Array<{
          id: string;
          name: string;
          role: string;
          created_at: Date | string;
          session_count: number;
          time_entry_count: number;
          task_count: number;
          engagement_score: number;
        }>
      ).map((r) => ({
        id: r.id,
        name: r.name,
        role: r.role,
        createdAt: parseDbTimestamp(r.created_at),
        sessionCount: Number(r.session_count),
        timeEntryCount: Number(r.time_entry_count),
        taskCount: Number(r.task_count),
        engagementScore: Number(r.engagement_score),
      }));
    }),
});
