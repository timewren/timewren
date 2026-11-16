import { and, eq, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { changelogs, users } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

export const changelogRouter = router({
  /**
   * Get changelogs the user hasn't seen yet.
   * Limited to 5 most recent to avoid overwhelming first-time users
   * (who have lastSeenChangelogId = null and would otherwise see all).
   */
  getUnseen: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;
    const now = new Date();

    const user = await ctx.db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { lastSeenChangelogId: true },
    });

    // Compare against the last-seen row's timestamp directly IN SQL to preserve
    // full (microsecond) precision. Reading published_at into a JS Date first
    // truncates it to milliseconds, so the newest changelog would satisfy
    // `> (truncated lastSeen)` and reappear in an endless loop after dismissal.
    const where = user?.lastSeenChangelogId
      ? and(
          lte(changelogs.publishedAt, now),
          sql`${changelogs.publishedAt} > (
            SELECT published_at FROM changelogs WHERE id = ${user.lastSeenChangelogId}
          )`,
        )
      : lte(changelogs.publishedAt, now);

    return ctx.db.query.changelogs.findMany({
      where,
      orderBy: (c, { desc }) => [desc(c.publishedAt)],
      limit: 5,
    });
  }),

  /**
   * Get all published changelogs (for "Nyheder" menu).
   */
  getAll: protectedProcedure.query(async ({ ctx }) => {
    const now = new Date();
    return ctx.db.query.changelogs.findMany({
      where: lte(changelogs.publishedAt, now),
      orderBy: (c, { desc }) => [desc(c.publishedAt)],
    });
  }),

  /**
   * Mark changelogs as seen. Only advances the pointer forward (never
   * regresses), and validates that the changelog ID actually exists.
   */
  markSeen: protectedProcedure
    .input(z.object({ changelogId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify the changelog exists
      const changelog = await ctx.db.query.changelogs.findFirst({
        where: eq(changelogs.id, input.changelogId),
        columns: { publishedAt: true },
      });
      if (!changelog) return { success: false };

      // Only advance, never regress — prevents multi-tab race conditions
      const user = await ctx.db.query.users.findFirst({
        where: eq(users.id, ctx.session.user.id),
        columns: { lastSeenChangelogId: true },
      });
      if (user?.lastSeenChangelogId) {
        const current = await ctx.db.query.changelogs.findFirst({
          where: eq(changelogs.id, user.lastSeenChangelogId),
          columns: { publishedAt: true },
        });
        if (current && current.publishedAt >= changelog.publishedAt) {
          return { success: true };
        }
      }

      await ctx.db
        .update(users)
        .set({ lastSeenChangelogId: input.changelogId })
        .where(eq(users.id, ctx.session.user.id));
      return { success: true };
    }),
});
