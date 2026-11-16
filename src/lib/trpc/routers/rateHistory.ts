import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { rateHistory } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";
import { assertClientAccess } from "./clientAccess";

export const rateHistoryRouter = router({
  // Get rate history for a specific entity (global, client, or project)
  getHistory: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid().optional(),
        projectId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Project/client rate history is shared org context (one rate per
      // project/client). Global rate history is the PERSONAL hourly rate, so it
      // stays own-scoped even in an org — never expose colleagues' rate changes.
      const orgOrUserScope =
        ctx.orgId && (input.projectId || input.clientId)
          ? eq(rateHistory.organizationId, ctx.orgId)
          : eq(rateHistory.userId, userId);
      const conditions = [orgOrUserScope];

      if (input.projectId) {
        // Project-specific rate history
        conditions.push(eq(rateHistory.projectId, input.projectId));
      } else if (input.clientId) {
        // Client-specific rate history (excluding project-level changes)
        conditions.push(eq(rateHistory.clientId, input.clientId));
        conditions.push(isNull(rateHistory.projectId));
      } else {
        // Global user rate history — personal, own-scoped above
        conditions.push(isNull(rateHistory.clientId));
        conditions.push(isNull(rateHistory.projectId));
      }

      const history = await ctx.db.query.rateHistory.findMany({
        where: and(...conditions),
        orderBy: [desc(rateHistory.effectiveDate)],
        limit: 50, // Limit to last 50 changes
      });

      return history;
    }),

  // Get all rate history for a client (including project-level changes)
  getClientHistory: protectedProcedure
    .input(
      z.object({
        clientId: z.string().uuid(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      await assertClientAccess(ctx.db, userId, ctx.orgId, input.clientId);

      // Get both client-level and project-level rate changes for this client
      const history = await ctx.db.query.rateHistory.findMany({
        where: and(
          ctx.orgId
            ? eq(rateHistory.organizationId, ctx.orgId)
            : eq(rateHistory.userId, userId),
          eq(rateHistory.clientId, input.clientId),
        ),
        with: {
          project: true,
        },
        orderBy: [desc(rateHistory.effectiveDate)],
        limit: 100,
      });

      return history;
    }),
});
