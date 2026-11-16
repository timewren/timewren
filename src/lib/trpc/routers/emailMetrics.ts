import { and, eq, isNull, sql } from "drizzle-orm";
import { emailIntegrations, emailThreads } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

export const emailMetricsRouter = router({
  getOverview: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    const integration = await ctx.db.query.emailIntegrations.findFirst({
      where: eq(emailIntegrations.userId, userId),
    });

    const totalThreads = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(emailThreads)
      .where(eq(emailThreads.userId, userId));

    const unmatched = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          isNull(emailThreads.matchedClientId),
        ),
      );

    const lowConfidence = await ctx.db
      .select({ count: sql<number>`count(*)` })
      .from(emailThreads)
      .where(
        and(
          eq(emailThreads.userId, userId),
          eq(emailThreads.isProcessed, true),
          isNull(emailThreads.matchedClientId),
        ),
      );

    return {
      totalThreads: totalThreads[0]?.count ?? 0,
      unmatchedThreads: unmatched[0]?.count ?? 0,
      lowConfidenceThreads: lowConfidence[0]?.count ?? 0,
      lastSyncedAt: integration?.lastSyncedAt || null,
      processedEmailsCount: integration?.processedEmailsCount || 0,
      lastSyncStatus: integration?.lastSyncStatus || null,
    };
  }),
});
