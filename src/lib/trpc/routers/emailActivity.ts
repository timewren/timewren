import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailEvents, sentEmails } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

export const emailActivityRouter = router({
  /**
   * Paginated list of sent emails with filters
   */
  list: protectedProcedure
    .input(
      z.object({
        emailType: z.string().optional(),
        status: z.string().optional(),
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [
        ctx.orgId
          ? eq(sentEmails.organizationId, ctx.orgId)
          : eq(sentEmails.userId, ctx.session.user.id),
      ];

      if (input.emailType) {
        conditions.push(eq(sentEmails.emailType, input.emailType));
      }
      if (input.status) {
        conditions.push(eq(sentEmails.latestStatus, input.status));
      }

      const [items, totalResult] = await Promise.all([
        db.query.sentEmails.findMany({
          where: and(...conditions),
          orderBy: [desc(sentEmails.sentAt)],
          limit: input.limit,
          offset: input.offset,
          with: {
            client: { columns: { name: true } },
            invoice: { columns: { invoiceNumber: true } },
          },
        }),
        db
          .select({ count: count() })
          .from(sentEmails)
          .where(and(...conditions)),
      ]);

      return {
        items,
        total: totalResult[0]?.count || 0,
        hasMore: input.offset + input.limit < (totalResult[0]?.count || 0),
      };
    }),

  /**
   * Aggregated email stats for the last 30 days
   */
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const result = await db
      .select({
        total: count(),
        delivered: sql<number>`COUNT(CASE WHEN ${sentEmails.deliveredAt} IS NOT NULL THEN 1 END)`,
        opened: sql<number>`COUNT(CASE WHEN ${sentEmails.openedAt} IS NOT NULL THEN 1 END)`,
        bounced: sql<number>`COUNT(CASE WHEN ${sentEmails.bouncedAt} IS NOT NULL THEN 1 END)`,
      })
      .from(sentEmails)
      .where(
        and(
          ctx.orgId
            ? eq(sentEmails.organizationId, ctx.orgId)
            : eq(sentEmails.userId, ctx.session.user.id),
          gte(sentEmails.sentAt, thirtyDaysAgo),
        ),
      );

    const stats = result[0] || {
      total: 0,
      delivered: 0,
      opened: 0,
      bounced: 0,
    };

    return {
      totalSent: stats.total,
      deliveryRate:
        stats.total > 0
          ? Math.round((Number(stats.delivered) / stats.total) * 100)
          : 0,
      openRate:
        stats.total > 0
          ? Math.round((Number(stats.opened) / stats.total) * 100)
          : 0,
      bounceRate:
        stats.total > 0
          ? Math.round((Number(stats.bounced) / stats.total) * 100)
          : 0,
    };
  }),

  /**
   * Event timeline for a specific email
   */
  getTimeline: protectedProcedure
    .input(z.object({ resendEmailId: z.string() }))
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const email = await db.query.sentEmails.findFirst({
        where: and(
          eq(sentEmails.resendEmailId, input.resendEmailId),
          ctx.orgId
            ? eq(sentEmails.organizationId, ctx.orgId)
            : eq(sentEmails.userId, ctx.session.user.id),
        ),
      });

      if (!email) {
        return [];
      }

      const events = await db.query.emailEvents.findMany({
        where: eq(emailEvents.resendEmailId, input.resendEmailId),
        orderBy: [desc(emailEvents.occurredAt)],
      });

      return events;
    }),

  /**
   * Get delivery status for a specific invoice's email
   */
  getInvoiceStatus: protectedProcedure
    .input(z.object({ invoiceId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const email = await db.query.sentEmails.findFirst({
        where: and(
          eq(sentEmails.invoiceId, input.invoiceId),
          ctx.orgId
            ? eq(sentEmails.organizationId, ctx.orgId)
            : eq(sentEmails.userId, ctx.session.user.id),
        ),
        orderBy: [desc(sentEmails.sentAt)],
      });

      if (!email) {
        return null;
      }

      return {
        resendEmailId: email.resendEmailId,
        recipientEmail: email.recipientEmail,
        latestStatus: email.latestStatus,
        sentAt: email.sentAt,
        deliveredAt: email.deliveredAt,
        openedAt: email.openedAt,
        bouncedAt: email.bouncedAt,
      };
    }),
});
