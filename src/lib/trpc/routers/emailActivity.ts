import {
  and,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  ne,
  notInArray,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { emailEvents, invoices, sentEmails } from "@/lib/db/schema";
import { PERSONAL_EMAIL_TYPES } from "@/lib/email/email-types";
import {
  accessSatisfies,
  resolveModuleAccess,
} from "@/lib/permissions/role-access";
import { memoize, type RequestMemo } from "../request-memo";
import { protectedProcedure, router } from "../trpc";
import { getAccessibleClientIds } from "./clientAccess";

/**
 * Which `sent_emails` rows the caller may see. Every procedure below filters
 * on this, so web and desktop (`extension.invoices.emailStatus`) get the same
 * answer.
 *
 * - No org: the user's own rows (unchanged).
 * - Org: the org's rows, but an invoice mail needs read access to the
 *   invoices module, and a mail tied to a client (directly or through its
 *   invoice) needs client access, like `invoices.getById`. Org rows without
 *   an invoice or a client stay visible to the whole org.
 * - Plus the user's own mails without an org: invoice mails sent before
 *   they were tagged with the org, and work mails that are still logged
 *   without one (timesheets, absence, klippekort, portal). Only the sender
 *   sees them, and only with the same module and client access. The user's
 *   personal account mails (`PERSONAL_EMAIL_TYPES`: welcome, drip, dunning,
 *   login alerts, magic links) have no org either and stay out of the org's
 *   activity and stats, unless tied to a client or an invoice. Every other
 *   type stays visible, so a new type never disappears silently.
 */
async function visibleEmails(ctx: {
  db: typeof db;
  orgId: string | null;
  session: { user: { id: string } };
  memo?: RequestMemo;
}): Promise<SQL> {
  const userId = ctx.session.user.id;
  if (!ctx.orgId) return eq(sentEmails.userId, userId);
  const orgId = ctx.orgId;

  // The module key matches the guard in trpc.ts, so a batch shares lookups.
  const [moduleLevel, accessibleIds] = await Promise.all([
    memoize(ctx.memo, `moduleAccess:${userId}:${orgId}:invoices`, () =>
      resolveModuleAccess(ctx.db, userId, orgId, "invoices"),
    ),
    memoize(ctx.memo, `accessibleClientIds:${userId}:${orgId}`, () =>
      getAccessibleClientIds(ctx.db, userId, orgId),
    ),
  ]);

  const invoiceOk = accessSatisfies(moduleLevel, "read")
    ? undefined
    : and(isNull(sentEmails.invoiceId), ne(sentEmails.emailType, "invoice"));

  let clientOk: SQL | undefined;
  if (accessibleIds !== null) {
    const noClient = and(
      isNull(sentEmails.clientId),
      isNull(sentEmails.invoiceId),
    );
    clientOk =
      accessibleIds.length === 0
        ? noClient
        : or(
            noClient,
            inArray(sentEmails.clientId, accessibleIds),
            and(
              isNull(sentEmails.clientId),
              inArray(
                sentEmails.invoiceId,
                ctx.db
                  .select({ id: invoices.id })
                  .from(invoices)
                  .where(inArray(invoices.clientId, accessibleIds)),
              ),
            ),
          );
  }

  return or(
    and(eq(sentEmails.organizationId, orgId), invoiceOk, clientOk),
    and(
      isNull(sentEmails.organizationId),
      eq(sentEmails.userId, userId),
      or(
        notInArray(sentEmails.emailType, PERSONAL_EMAIL_TYPES),
        isNotNull(sentEmails.invoiceId),
        isNotNull(sentEmails.clientId),
      ),
      invoiceOk,
      clientOk,
    ),
  ) as SQL;
}

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
      const conditions = [await visibleEmails(ctx)];

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
    const visible = await visibleEmails(ctx);

    const result = await db
      .select({
        total: count(),
        delivered: sql<number>`COUNT(CASE WHEN ${sentEmails.deliveredAt} IS NOT NULL THEN 1 END)`,
        opened: sql<number>`COUNT(CASE WHEN ${sentEmails.openedAt} IS NOT NULL THEN 1 END)`,
        bounced: sql<number>`COUNT(CASE WHEN ${sentEmails.bouncedAt} IS NOT NULL THEN 1 END)`,
      })
      .from(sentEmails)
      .where(and(visible, gte(sentEmails.sentAt, thirtyDaysAgo)));

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
      // Verify access to the email before returning its events
      const email = await db.query.sentEmails.findFirst({
        where: and(
          eq(sentEmails.resendEmailId, input.resendEmailId),
          await visibleEmails(ctx),
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
          await visibleEmails(ctx),
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
