import { and, avg, count, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  EXPECTED_INTERVAL_MINUTES,
  EXPECTED_JOB_NAMES,
  isJobSilent,
} from "@/lib/cron/expected-schedule";
import {
  cronJobLogs,
  emailDeliveryLogs,
  sessions,
  timerStates,
} from "@/lib/db/schema";
import { parseDbTimestamp } from "@/lib/time/db-timestamp";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminMonitoringRouter = router({
  // ============================================
  // Cron Job Monitoring
  // Supporters can view
  // ============================================

  getCronJobLogs: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        jobName: z.string().optional(),
        status: z.enum(["success", "error", "partial"]).optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_cron_job_logs",
        null,
        { limit: input.limit, jobName: input.jobName },
        ctx.headers,
      );

      const conditions = [];
      if (input.jobName) {
        conditions.push(eq(cronJobLogs.jobName, input.jobName));
      }
      if (input.status) {
        conditions.push(eq(cronJobLogs.status, input.status));
      }

      const whereClause =
        conditions.length > 0 ? and(...conditions) : undefined;

      const logs = await ctx.db
        .select()
        .from(cronJobLogs)
        .where(whereClause)
        .orderBy(desc(cronJobLogs.startedAt))
        .limit(input.limit)
        .offset(input.offset);

      const totalQuery = ctx.db.select({ count: count() }).from(cronJobLogs);
      const totalCount = whereClause
        ? await totalQuery.where(whereClause)
        : await totalQuery;

      // Get unique job names for filter dropdown
      const jobNames = await ctx.db
        .selectDistinct({ jobName: cronJobLogs.jobName })
        .from(cronJobLogs);

      return {
        logs,
        total: totalCount[0]?.count ?? 0,
        jobNames: jobNames.map((j) => j.jobName),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ============================================
  // Email Delivery Stats
  // Supporters can view
  // ============================================

  getEmailDeliveryStats: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
        templateType: z.string().optional(),
        status: z.enum(["sent", "delivered", "bounced", "failed"]).optional(),
        daysBack: z.number().min(1).max(90).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      // Log this action
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_email_delivery_stats",
        null,
        { limit: input.limit, templateType: input.templateType },
        ctx.headers,
      );

      const conditions = [
        gte(
          emailDeliveryLogs.sentAt,
          new Date(Date.now() - input.daysBack * 24 * 60 * 60 * 1000),
        ),
      ];
      if (input.templateType) {
        conditions.push(eq(emailDeliveryLogs.templateType, input.templateType));
      }
      if (input.status) {
        conditions.push(eq(emailDeliveryLogs.status, input.status));
      }

      const whereClause = and(...conditions);

      const logs = await ctx.db
        .select({
          id: emailDeliveryLogs.id,
          to: emailDeliveryLogs.to,
          subject: emailDeliveryLogs.subject,
          templateType: emailDeliveryLogs.templateType,
          status: emailDeliveryLogs.status,
          errorMessage: emailDeliveryLogs.errorMessage,
          sentAt: emailDeliveryLogs.sentAt,
          deliveredAt: emailDeliveryLogs.deliveredAt,
          bouncedAt: emailDeliveryLogs.bouncedAt,
        })
        .from(emailDeliveryLogs)
        .where(whereClause)
        .orderBy(desc(emailDeliveryLogs.sentAt))
        .limit(input.limit)
        .offset(input.offset);

      // Get aggregated stats
      const [totalCount, statusCounts] = await Promise.all([
        ctx.db
          .select({ count: count() })
          .from(emailDeliveryLogs)
          .where(whereClause),
        ctx.db
          .select({
            status: emailDeliveryLogs.status,
            count: count(),
          })
          .from(emailDeliveryLogs)
          .where(whereClause)
          .groupBy(emailDeliveryLogs.status),
      ]);

      // Get template types for filter
      const templateTypes = await ctx.db
        .selectDistinct({ templateType: emailDeliveryLogs.templateType })
        .from(emailDeliveryLogs);

      return {
        logs,
        total: totalCount[0]?.count ?? 0,
        stats: {
          sent: statusCounts.find((s) => s.status === "sent")?.count ?? 0,
          delivered:
            statusCounts.find((s) => s.status === "delivered")?.count ?? 0,
          bounced: statusCounts.find((s) => s.status === "bounced")?.count ?? 0,
          failed: statusCounts.find((s) => s.status === "failed")?.count ?? 0,
        },
        templateTypes: templateTypes.map((t) => t.templateType),
        limit: input.limit,
        offset: input.offset,
      };
    }),

  // ============================================
  // Active Sessions Monitoring
  // Supporters can view
  // ============================================

  getActiveSessions: supporterProcedure.query(async ({ ctx }) => {
    // Log this action
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_active_sessions",
      null,
      null,
      ctx.headers,
    );

    const now = new Date();
    const last24Hours = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    // Get active sessions (not expired)
    const [activeCount, recentActivity, activeTimers] = await Promise.all([
      ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(gte(sessions.expiresAt, now)),

      // Sessions created in last 24 hours
      ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(gte(sessions.createdAt, last24Hours)),

      // Active timers
      ctx.db
        .select({ count: count() })
        .from(timerStates)
        .where(eq(timerStates.isRunning, true)),
    ]);

    return {
      activeSessions: activeCount[0]?.count ?? 0,
      sessionsLast24Hours: recentActivity[0]?.count ?? 0,
      activeTimers: activeTimers[0]?.count ?? 0,
    };
  }),

  // ============================================
  // System Health
  // ============================================

  getSystemHealth: supporterProcedure.query(async ({ ctx }) => {
    const twentyFourHoursAgo = new Date();
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

    const [cronResults, emailResults, sessionResults] = await Promise.all([
      // Last 10 cron jobs
      ctx.db
        .select({
          status: cronJobLogs.status,
          count: count(),
        })
        .from(cronJobLogs)
        .where(gte(cronJobLogs.startedAt, twentyFourHoursAgo))
        .groupBy(cronJobLogs.status),
      // Email delivery last 24h
      ctx.db
        .select({
          status: emailDeliveryLogs.status,
          count: count(),
        })
        .from(emailDeliveryLogs)
        .where(gte(emailDeliveryLogs.sentAt, twentyFourHoursAgo))
        .groupBy(emailDeliveryLogs.status),
      // Active sessions
      ctx.db
        .select({ count: count() })
        .from(sessions)
        .where(gte(sessions.expiresAt, new Date())),
    ]);

    const cronTotal = cronResults.reduce((s, r) => s + Number(r.count), 0);
    const cronErrors = cronResults.find((r) => r.status === "error");
    const cronErrorCount = Number(cronErrors?.count ?? 0);

    const emailTotal = emailResults.reduce((s, r) => s + Number(r.count), 0);
    const emailFailed = emailResults.find((r) => r.status === "failed");
    const emailBounced = emailResults.find((r) => r.status === "bounced");
    const emailFailCount =
      Number(emailFailed?.count ?? 0) + Number(emailBounced?.count ?? 0);

    const cronHealthPct =
      cronTotal > 0
        ? Math.round(((cronTotal - cronErrorCount) / cronTotal) * 100)
        : 100;
    const emailHealthPct =
      emailTotal > 0
        ? Math.round(((emailTotal - emailFailCount) / emailTotal) * 100)
        : 100;

    const overallScore = Math.round((cronHealthPct + emailHealthPct) / 2);

    return {
      overallScore,
      cronHealthPct,
      emailHealthPct,
      cronTotal,
      cronErrors: cronErrorCount,
      emailTotal,
      emailFails: emailFailCount,
      activeSessions: Number(sessionResults[0]?.count ?? 0),
      status:
        overallScore >= 90
          ? ("healthy" as const)
          : overallScore >= 70
            ? ("degraded" as const)
            : ("unhealthy" as const),
    };
  }),

  getCronJobHealth: supporterProcedure.query(async ({ ctx }) => {
    const result = await ctx.db.execute(sql`
      SELECT
        job_name,
        COUNT(*) as total_runs,
        COUNT(*) FILTER (WHERE status = 'success') as successes,
        COUNT(*) FILTER (WHERE status = 'error') as errors,
        AVG(duration_ms) as avg_duration,
        MAX(started_at) as last_run
      FROM cron_job_logs
      WHERE started_at >= NOW() - INTERVAL '7 days'
      GROUP BY job_name
      ORDER BY job_name
    `);

    return (
      result as unknown as Array<{
        job_name: string;
        total_runs: number;
        successes: number;
        errors: number;
        avg_duration: number;
        last_run: Date | string | null;
      }>
    ).map((r) => ({
      jobName: r.job_name,
      totalRuns: Number(r.total_runs),
      successes: Number(r.successes),
      errors: Number(r.errors),
      successRate:
        Number(r.total_runs) > 0
          ? Math.round((Number(r.successes) / Number(r.total_runs)) * 100)
          : 0,
      avgDurationMs: Math.round(Number(r.avg_duration ?? 0)),
      lastRun: parseDbTimestamp(r.last_run),
    }));
  }),

  getErrorSummary: supporterProcedure
    .input(z.object({ daysBack: z.number().min(1).max(90).default(7) }))
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const [cronErrors, emailErrors] = await Promise.all([
        ctx.db
          .select({
            jobName: cronJobLogs.jobName,
            errorMessage: cronJobLogs.errorMessage,
            count: count(),
            lastOccurrence: sql<Date>`MAX(${cronJobLogs.startedAt})`.mapWith(
              cronJobLogs.startedAt,
            ),
          })
          .from(cronJobLogs)
          .where(
            and(
              gte(cronJobLogs.startedAt, since),
              eq(cronJobLogs.status, "error"),
            ),
          )
          .groupBy(cronJobLogs.jobName, cronJobLogs.errorMessage),
        ctx.db
          .select({
            status: emailDeliveryLogs.status,
            count: count(),
            lastOccurrence: sql<Date>`MAX(${emailDeliveryLogs.sentAt})`.mapWith(
              emailDeliveryLogs.sentAt,
            ),
          })
          .from(emailDeliveryLogs)
          .where(
            and(
              gte(emailDeliveryLogs.sentAt, since),
              inArray(emailDeliveryLogs.status, ["failed", "bounced"]),
            ),
          )
          .groupBy(emailDeliveryLogs.status),
      ]);

      return {
        cronErrors: cronErrors.map((e) => ({
          source: `Cron: ${e.jobName}`,
          message: e.errorMessage ?? "Ukendt fejl",
          count: Number(e.count),
          lastOccurrence: e.lastOccurrence,
        })),
        emailErrors: emailErrors.map((e) => ({
          source: `Email: ${e.status}`,
          message: `${e.status} emails`,
          count: Number(e.count),
          lastOccurrence: e.lastOccurrence,
        })),
      };
    }),

  // =========================================================================
  // New: Admin-only cron overview with silent-job detection
  // =========================================================================

  /**
   * Returns one row per *expected* cron job (from EXPECTED_INTERVAL_MINUTES).
   * Includes last-run time, 24-hour run/error counts, avg duration, and a
   * "isSilent" flag for jobs that haven't run within 2× their expected interval.
   */
  getCronJobsOverview: adminProcedure.query(async ({ ctx }) => {
    const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    // Per-job aggregates for the last 24 h
    const recentStats = await ctx.db
      .select({
        jobName: cronJobLogs.jobName,
        runsLast24h: count(),
        errorsLast24h: sql<number>`COUNT(*) FILTER (WHERE ${cronJobLogs.status} = 'error')`,
        avgDurationMs: avg(cronJobLogs.durationMs),
      })
      .from(cronJobLogs)
      .where(gte(cronJobLogs.startedAt, twentyFourHoursAgo))
      .groupBy(cronJobLogs.jobName);

    // Latest run (any time) per job
    const latestRuns = await ctx.db
      .select({
        jobName: cronJobLogs.jobName,
        lastRunAt: sql<Date>`MAX(${cronJobLogs.startedAt})`.mapWith(
          cronJobLogs.startedAt,
        ),
      })
      .from(cronJobLogs)
      .groupBy(cronJobLogs.jobName);

    // Latest status per job — fetch the single most recent row per job name
    const latestStatuses = await ctx.db
      .select({
        jobName: cronJobLogs.jobName,
        status: cronJobLogs.status,
        startedAt: cronJobLogs.startedAt,
        errorMessage: cronJobLogs.errorMessage,
      })
      .from(cronJobLogs)
      .where(
        sql`(${cronJobLogs.jobName}, ${cronJobLogs.startedAt}) IN (
          SELECT job_name, MAX(started_at)
          FROM cron_job_logs
          GROUP BY job_name
        )`,
      );

    // Index by job name
    const statsByJob = Object.fromEntries(
      recentStats.map((r) => [r.jobName, r]),
    );
    const latestRunByJob = Object.fromEntries(
      latestRuns.map((r) => [r.jobName, r.lastRunAt]),
    );
    const latestStatusByJob = Object.fromEntries(
      latestStatuses.map((r) => [r.jobName, r]),
    );

    return EXPECTED_JOB_NAMES.map((jobName) => {
      const stats = statsByJob[jobName];
      const lastRunAt = latestRunByJob[jobName] ?? null;
      const latestStatus = latestStatusByJob[jobName] ?? null;
      const expectedIntervalMinutes = EXPECTED_INTERVAL_MINUTES[jobName] ?? 0;

      return {
        jobName,
        expectedIntervalMinutes,
        lastRunAt: lastRunAt ? new Date(lastRunAt) : null,
        lastStatus: latestStatus?.status ?? null,
        lastErrorMessage: latestStatus?.errorMessage ?? null,
        runsLast24h: Number(stats?.runsLast24h ?? 0),
        errorsLast24h: Number(stats?.errorsLast24h ?? 0),
        avgDurationMs: stats?.avgDurationMs
          ? Math.round(Number(stats.avgDurationMs))
          : null,
        isSilent: isJobSilent(jobName, lastRunAt ? new Date(lastRunAt) : null),
        isEverRun: lastRunAt !== null,
      };
    });
  }),

  /**
   * Returns the last N log rows for a specific cron job.
   */
  getCronJobRuns: adminProcedure
    .input(
      z.object({
        jobName: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db
        .select()
        .from(cronJobLogs)
        .where(eq(cronJobLogs.jobName, input.jobName))
        .orderBy(desc(cronJobLogs.startedAt))
        .limit(input.limit);
    }),

  // =========================================================================
  // Calendar Health Overview
  // =========================================================================

  getCalendarHealth: supporterProcedure.query(async ({ ctx }) => {
    const allConnections = await ctx.db.query.calendarConnections.findMany();

    const now = new Date();
    const healthy = allConnections.filter((c) => c.syncEnabled && !c.syncError);
    const errored = allConnections.filter(
      (c) => c.syncEnabled && !!c.syncError,
    );
    const disabled = allConnections.filter((c) => !c.syncEnabled);
    const inBackoff = allConnections.filter(
      (c) => c.syncDisabledUntil && new Date(c.syncDisabledUntil) > now,
    );

    return {
      total: allConnections.length,
      healthy: healthy.length,
      errored: errored.length,
      disabled: disabled.length,
      inBackoff: inBackoff.length,
      errors: errored.map((c) => ({
        userId: c.userId,
        provider: c.provider,
        providerAccountId: c.providerAccountId,
        error: c.syncError,
        failures: c.consecutiveSyncFailures || 0,
        lastSynced: c.lastSynced,
      })),
    };
  }),
});
