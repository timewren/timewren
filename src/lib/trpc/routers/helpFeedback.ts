import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { helpFeedback } from "@/lib/db/schema";
import { adminProcedure, protectedProcedure, router } from "../trpc";

export const helpFeedbackRouter = router({
  // Get user's feedback for all questions
  myFeedback: protectedProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db.query.helpFeedback.findMany({
      where: eq(helpFeedback.userId, ctx.session.user.id),
      columns: { questionKey: true, value: true },
    });
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.questionKey] = row.value;
    }
    return result;
  }),

  // Submit or toggle feedback
  submit: protectedProcedure
    .input(
      z.object({
        questionKey: z.string().max(500),
        value: z.enum(["up", "down"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.helpFeedback.findFirst({
        where: and(
          eq(helpFeedback.userId, ctx.session.user.id),
          eq(helpFeedback.questionKey, input.questionKey),
        ),
      });

      if (existing) {
        if (existing.value === input.value) {
          // Toggle off - delete
          await ctx.db
            .delete(helpFeedback)
            .where(eq(helpFeedback.id, existing.id));
          return { value: null };
        }
        // Change value
        await ctx.db
          .update(helpFeedback)
          .set({ value: input.value, updatedAt: new Date() })
          .where(eq(helpFeedback.id, existing.id));
        return { value: input.value };
      }

      // Insert new
      await ctx.db.insert(helpFeedback).values({
        userId: ctx.session.user.id,
        questionKey: input.questionKey,
        value: input.value,
      });
      return { value: input.value };
    }),

  // Admin: get aggregated feedback stats
  summary: adminProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        questionKey: helpFeedback.questionKey,
        value: helpFeedback.value,
        count: count(),
      })
      .from(helpFeedback)
      .groupBy(helpFeedback.questionKey, helpFeedback.value);

    const summary: Record<string, { up: number; down: number; total: number }> =
      {};
    for (const row of rows) {
      if (!summary[row.questionKey]) {
        summary[row.questionKey] = { up: 0, down: 0, total: 0 };
      }
      const c = Number(row.count);
      if (row.value === "up") summary[row.questionKey].up = c;
      if (row.value === "down") summary[row.questionKey].down = c;
      summary[row.questionKey].total += c;
    }
    return summary;
  }),
});
