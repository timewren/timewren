import { and, count, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import {
  emailDeliveryLogs,
  emailEvents,
  integrationSyncLogs,
  webhookEvents,
} from "@/lib/db/schema";
import { adminProcedure, router } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminWebhooksRouter = router({
  /**
   * List recent webhook events from billing providers (Alunta, Stripe legacy).
   */
  listBillingWebhooks: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: z.enum(["success", "error", "needs_review"]).optional(),
        source: z.string().optional(),
        daysBack: z.number().min(1).max(90).default(30),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_webhook_events",
        null,
        { filters: input },
        ctx.headers,
      );

      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const whereConditions = [gte(webhookEvents.createdAt, since)];
      if (input.status) {
        whereConditions.push(eq(webhookEvents.status, input.status));
      }
      if (input.source) {
        whereConditions.push(eq(webhookEvents.source, input.source));
      }

      const [rows, totalCount, statusCounts] = await Promise.all([
        ctx.db
          .select()
          .from(webhookEvents)
          .where(and(...whereConditions))
          .orderBy(desc(webhookEvents.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: count() })
          .from(webhookEvents)
          .where(and(...whereConditions)),
        ctx.db
          .select({
            status: webhookEvents.status,
            count: count(),
          })
          .from(webhookEvents)
          .where(gte(webhookEvents.createdAt, since))
          .groupBy(webhookEvents.status),
      ]);

      const summary = {
        success: 0,
        error: 0,
        needsReview: 0,
      };
      for (const row of statusCounts) {
        if (row.status === "success") summary.success = row.count;
        if (row.status === "error") summary.error = row.count;
        if (row.status === "needs_review") summary.needsReview = row.count;
      }

      return {
        events: rows,
        total: totalCount[0]?.count ?? 0,
        summary,
      };
    }),

  /**
   * List recent email delivery logs (Resend).
   */
  listEmailDeliveries: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        status: z.enum(["sent", "delivered", "bounced", "failed"]).optional(),
        templateType: z.string().optional(),
        daysBack: z.number().min(1).max(90).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "view_email_deliveries",
        null,
        { filters: input },
        ctx.headers,
      );

      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const whereConditions = [gte(emailDeliveryLogs.sentAt, since)];
      if (input.status) {
        whereConditions.push(eq(emailDeliveryLogs.status, input.status));
      }
      if (input.templateType) {
        whereConditions.push(
          eq(emailDeliveryLogs.templateType, input.templateType),
        );
      }

      const [rows, totalCount, statusCounts, templateCounts] =
        await Promise.all([
          ctx.db
            .select()
            .from(emailDeliveryLogs)
            .where(and(...whereConditions))
            .orderBy(desc(emailDeliveryLogs.sentAt))
            .limit(input.limit)
            .offset(input.offset),
          ctx.db
            .select({ count: count() })
            .from(emailDeliveryLogs)
            .where(and(...whereConditions)),
          ctx.db
            .select({
              status: emailDeliveryLogs.status,
              count: count(),
            })
            .from(emailDeliveryLogs)
            .where(gte(emailDeliveryLogs.sentAt, since))
            .groupBy(emailDeliveryLogs.status),
          ctx.db
            .select({
              templateType: emailDeliveryLogs.templateType,
              count: count(),
            })
            .from(emailDeliveryLogs)
            .where(gte(emailDeliveryLogs.sentAt, since))
            .groupBy(emailDeliveryLogs.templateType)
            .orderBy(desc(count())),
        ]);

      const statusSummary = {
        sent: 0,
        delivered: 0,
        bounced: 0,
        failed: 0,
      };
      for (const row of statusCounts) {
        if (row.status in statusSummary) {
          statusSummary[row.status as keyof typeof statusSummary] = row.count;
        }
      }

      return {
        events: rows,
        total: totalCount[0]?.count ?? 0,
        statusSummary,
        templateSummary: templateCounts,
      };
    }),

  /**
   * List Resend webhook events (delivered, bounced, opened, clicked etc).
   */
  listResendEvents: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        eventType: z.string().optional(),
        daysBack: z.number().min(1).max(90).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const whereConditions = [gte(emailEvents.occurredAt, since)];
      if (input.eventType) {
        whereConditions.push(eq(emailEvents.eventType, input.eventType));
      }

      const [rows, totalCount, eventTypeCounts] = await Promise.all([
        ctx.db
          .select()
          .from(emailEvents)
          .where(and(...whereConditions))
          .orderBy(desc(emailEvents.occurredAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: count() })
          .from(emailEvents)
          .where(and(...whereConditions)),
        ctx.db
          .select({
            eventType: emailEvents.eventType,
            count: count(),
          })
          .from(emailEvents)
          .where(gte(emailEvents.occurredAt, since))
          .groupBy(emailEvents.eventType)
          .orderBy(desc(count())),
      ]);

      return {
        events: rows,
        total: totalCount[0]?.count ?? 0,
        eventTypeSummary: eventTypeCounts,
      };
    }),

  /**
   * List integration sync logs (Billy, Dinero, e-conomic).
   */
  listIntegrationSyncs: adminProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(200).default(50),
        offset: z.number().min(0).default(0),
        integrationType: z.string().optional(),
        status: z.string().optional(),
        daysBack: z.number().min(1).max(90).default(14),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const whereConditions = [gte(integrationSyncLogs.createdAt, since)];
      if (input.integrationType) {
        whereConditions.push(
          eq(integrationSyncLogs.integrationType, input.integrationType),
        );
      }
      if (input.status) {
        whereConditions.push(eq(integrationSyncLogs.status, input.status));
      }

      const [rows, totalCount] = await Promise.all([
        ctx.db
          .select()
          .from(integrationSyncLogs)
          .where(and(...whereConditions))
          .orderBy(desc(integrationSyncLogs.createdAt))
          .limit(input.limit)
          .offset(input.offset),
        ctx.db
          .select({ count: count() })
          .from(integrationSyncLogs)
          .where(and(...whereConditions)),
      ]);

      return {
        events: rows,
        total: totalCount[0]?.count ?? 0,
      };
    }),
});
