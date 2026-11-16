import { and, count, desc, eq, gte, isNotNull, sql } from "drizzle-orm";
import { z } from "zod";
import {
  aiProcessingLogs,
  emailFilterRules,
  emailIntegrations,
  emailThreads,
  tasks,
} from "@/lib/db/schema";
import { copenhagenDayStart, copenhagenToday } from "@/lib/time/copenhagen";
import { copenhagenDateSql } from "@/lib/time/date-bounds";
import { protectedProcedure, router } from "../trpc";

export const emailAnalyticsRouter = router({
  getHitRate: protectedProcedure
    .input(
      z.object({
        period: z.enum(["7d", "30d", "90d"]).default("30d"),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const days = input.period === "7d" ? 7 : input.period === "30d" ? 30 : 90;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      // Emails processed (all stored in emailThreads)
      const totalEmails = await ctx.db
        .select({ count: count() })
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.userId, userId),
            gte(emailThreads.receivedDate, since),
          ),
        );

      // Tasks created from email
      const tasksCreated = await ctx.db
        .select({ count: count() })
        .from(tasks)
        .where(
          and(
            ctx.orgId
              ? eq(tasks.organizationId, ctx.orgId)
              : eq(tasks.userId, userId),
            eq(tasks.sourceType, "email"),
            gte(tasks.createdAt, since),
          ),
        );

      // Emails filtered (processed but no task)
      const emailsWithTasks = await ctx.db
        .select({ count: count() })
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.userId, userId),
            isNotNull(emailThreads.taskId),
            gte(emailThreads.receivedDate, since),
          ),
        );

      // Daily breakdown
      const dailyBreakdown = await ctx.db
        .select({
          date: copenhagenDateSql(emailThreads.receivedDate).as("date"),
          total: count(),
          withTask: sql<number>`COUNT(${emailThreads.taskId})`.as("with_task"),
        })
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.userId, userId),
            gte(emailThreads.receivedDate, since),
          ),
        )
        .groupBy(copenhagenDateSql(emailThreads.receivedDate))
        .orderBy(copenhagenDateSql(emailThreads.receivedDate));

      return {
        totalEmails: totalEmails[0]?.count ?? 0,
        tasksCreated: tasksCreated[0]?.count ?? 0,
        emailsFiltered:
          (totalEmails[0]?.count ?? 0) - (emailsWithTasks[0]?.count ?? 0),
        dailyBreakdown,
      };
    }),

  getTopSenders: protectedProcedure
    .input(z.object({ limit: z.number().min(1).max(50).default(10) }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const senders = await ctx.db
        .select({
          fromEmail: emailThreads.fromEmail,
          emailCount: count(),
          taskCount: sql<number>`COUNT(${emailThreads.taskId})`.as(
            "task_count",
          ),
        })
        .from(emailThreads)
        .where(
          and(
            eq(emailThreads.userId, userId),
            gte(emailThreads.receivedDate, thirtyDaysAgo),
          ),
        )
        .groupBy(emailThreads.fromEmail)
        .orderBy(desc(count()))
        .limit(input.limit);

      return senders;
    }),

  getFalsePositiveRate: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const total = await ctx.db
      .select({ count: count() })
      .from(tasks)
      .where(
        and(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, userId),
          eq(tasks.sourceType, "email"),
          isNotNull(tasks.emailRelevanceFeedback),
        ),
      );

    const irrelevant = await ctx.db
      .select({ count: count() })
      .from(tasks)
      .where(
        and(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, userId),
          eq(tasks.sourceType, "email"),
          eq(tasks.emailRelevanceFeedback, "irrelevant"),
        ),
      );

    const totalCount = total[0]?.count ?? 0;
    const irrelevantCount = irrelevant[0]?.count ?? 0;

    return {
      totalReviewed: totalCount,
      irrelevantCount,
      falsePositiveRate:
        totalCount > 0 ? Math.round((irrelevantCount / totalCount) * 100) : 0,
    };
  }),

  getFilterEffectiveness: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const rules = await ctx.db.query.emailFilterRules.findMany({
      where: eq(emailFilterRules.userId, userId),
      columns: {
        id: true,
        ruleType: true,
        pattern: true,
        matchCount: true,
        isActive: true,
        lastMatchedAt: true,
      },
      orderBy: desc(emailFilterRules.matchCount),
    });

    return rules;
  }),

  getConfidenceDistribution: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const distribution = await ctx.db
      .select({
        bucket: sql<string>`CASE
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.9 THEN '0.9-1.0'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.8 THEN '0.8-0.9'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.7 THEN '0.7-0.8'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.6 THEN '0.6-0.7'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.5 THEN '0.5-0.6'
          ELSE '0.0-0.5'
        END`.as("bucket"),
        count: count(),
      })
      .from(aiProcessingLogs)
      .where(
        and(
          eq(aiProcessingLogs.userId, userId),
          eq(aiProcessingLogs.sourceType, "email"),
          isNotNull(aiProcessingLogs.confidence),
          gte(aiProcessingLogs.createdAt, thirtyDaysAgo),
        ),
      )
      .groupBy(
        sql`CASE
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.9 THEN '0.9-1.0'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.8 THEN '0.8-0.9'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.7 THEN '0.7-0.8'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.6 THEN '0.6-0.7'
          WHEN CAST(${aiProcessingLogs.confidence} AS numeric) >= 0.5 THEN '0.5-0.6'
          ELSE '0.0-0.5'
        END`,
      );

    return distribution;
  }),

  getSyncOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const integration = await ctx.db.query.emailIntegrations.findFirst({
      where: eq(emailIntegrations.userId, userId),
    });

    if (!integration) return null;

    // Count today's emails
    // Dansk midnat uanset processens TZ (#649)
    const todayStart = copenhagenDayStart(copenhagenToday());

    const todayEmails = await ctx.db
      .select({ count: count() })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          gte(emailThreads.receivedDate, todayStart),
        ),
      );

    const todayTasks = await ctx.db
      .select({ count: count() })
      .from(tasks)
      .where(
        and(
          ctx.orgId
            ? eq(tasks.organizationId, ctx.orgId)
            : eq(tasks.userId, userId),
          eq(tasks.sourceType, "email"),
          gte(tasks.createdAt, todayStart),
        ),
      );

    // Count high-priority (known customer) emails
    const highPriorityCount = await ctx.db
      .select({ count: count() })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.senderPriority, "high"),
          gte(emailThreads.receivedDate, todayStart),
        ),
      );

    return {
      syncEnabled: integration.syncEnabled,
      lastSyncedAt: integration.lastSyncedAt,
      lastSyncStatus: integration.lastSyncStatus,
      lastSyncError: integration.lastSyncError,
      lastHeartbeat: integration.lastHeartbeat,
      consecutiveSyncFailures: integration.consecutiveSyncFailures,
      uidValidity: integration.uidValidity,
      highestProcessedUid: integration.highestProcessedUid,
      totalProcessed: integration.processedEmailsCount,
      todayEmails: todayEmails[0]?.count ?? 0,
      todayTasks: todayTasks[0]?.count ?? 0,
      todayHighPriority: highPriorityCount[0]?.count ?? 0,
    };
  }),
});
