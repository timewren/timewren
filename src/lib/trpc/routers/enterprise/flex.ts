import { TRPCError } from "@trpc/server";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { employeeProfiles, flexEntries } from "@/lib/db/schema";
import {
  getEarnedOvertimeByUser,
  recalculateFlexDay,
} from "@/lib/enterprise/flex";
import { isValidDateString } from "@/lib/enterprise/period";
import { getVisibleScope, profileScopeCondition } from "@/lib/enterprise/scope";
import { router } from "../../trpc";
import { organizationProcedure, orgManagerReadProcedure } from "./middleware";

export const enterpriseFlexRouter = router({
  /**
   * getEntries — get flex entries for a date range (own entries).
   */
  getEntries: organizationProcedure
    .input(
      z.object({
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      return ctx.db.query.flexEntries.findMany({
        where: and(
          eq(flexEntries.userId, ctx.session.user.id),
          eq(flexEntries.organizationId, ctx.orgId),
          gte(flexEntries.date, input.startDate),
          lte(flexEntries.date, input.endDate),
        ),
        orderBy: (e, { asc }) => [asc(e.date)],
      });
    }),

  /**
   * getBalance — get current flex balance using SQL SUM aggregation.
   * Uses a single SQL query instead of fetching all rows and summing in JS.
   * Med `asOf` (YYYY-MM-DD) medregnes kun flex-dage og optjent overtid til
   * og med den dato — "saldo pr. dato".
   */
  getBalance: organizationProcedure
    .input(
      z
        .object({
          asOf: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .refine(isValidDateString, { error: () => st("zod.invalidDate") })
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const asOf = input?.asOf;
      const result = await ctx.db
        .select({
          totalDelta: sql<string>`COALESCE(SUM(${flexEntries.delta}::numeric), 0)`,
          totalEntries: sql<number>`COUNT(*)`,
        })
        .from(flexEntries)
        .where(
          and(
            eq(flexEntries.userId, ctx.session.user.id),
            eq(flexEntries.organizationId, ctx.orgId),
            asOf ? lte(flexEntries.date, asOf) : undefined,
          ),
        );

      const row = result[0];
      // Timer flyttet til overtidssaldoen tæller ikke i flex
      const earned = await getEarnedOvertimeByUser(
        ctx.db,
        ctx.orgId,
        [ctx.session.user.id],
        { end: asOf },
      );
      const earnedSum = earned.get(ctx.session.user.id) ?? 0;
      return {
        balance:
          Math.round((Number(row?.totalDelta ?? 0) - earnedSum) * 100) / 100,
        totalEntries: Number(row?.totalEntries ?? 0),
        asOf: asOf ?? null,
      };
    }),

  /**
   * recalculateDay — recalculate flex for a specific day.
   * Own entries: always allowed.
   * Other users: requires manager+ AND target.organizationId === ctx.orgId.
   */
  recalculateDay: organizationProcedure
    .input(
      z.object({
        userId: z.string(),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const isSelf = input.userId === ctx.session.user.id;

      // If not self, verify manager+ role and target belongs to this org
      if (!isSelf) {
        if (
          ctx.orgRole !== "manager" &&
          ctx.orgRole !== "admin" &&
          ctx.orgRole !== "owner"
        ) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "enterprise.flex.recalcScope"),
          });
        }

        // SECURITY: verify target user belongs to this org
        const targetProfile = await ctx.db.query.employeeProfiles.findFirst({
          where: and(
            eq(employeeProfiles.userId, input.userId),
            eq(employeeProfiles.organizationId, ctx.orgId),
          ),
        });
        if (!targetProfile) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr(
              "serverErrors",
              "enterprise.flex.profileNotInOrg",
            ),
          });
        }
      }

      // Shared calculation — also used by the timesheet grid after cell edits
      return recalculateFlexDay(ctx.db, {
        userId: input.userId,
        orgId: ctx.orgId,
        date: input.date,
      });
    }),

  /**
   * getTeamBalances — manager view of team flex balances.
   * Single SQL query with GROUP BY — no N+1.
   */
  getTeamBalances: orgManagerReadProcedure.query(async ({ ctx }) => {
    // Get team member user IDs (fælles scope, #464)
    const scope = await getVisibleScope(ctx.db, ctx);
    const teamMembers = await ctx.db.query.employeeProfiles.findMany({
      where: and(
        eq(employeeProfiles.organizationId, ctx.orgId),
        profileScopeCondition(scope),
      ),
      columns: { userId: true },
      with: {
        user: { columns: { id: true, name: true, image: true } },
      },
    });

    if (teamMembers.length === 0) return [];

    // Single aggregation query for all team members
    const balances = await ctx.db
      .select({
        userId: flexEntries.userId,
        totalDelta: sql<string>`COALESCE(SUM(${flexEntries.delta}::numeric), 0)`,
        totalEntries: sql<number>`COUNT(*)`,
      })
      .from(flexEntries)
      .where(
        and(
          eq(flexEntries.organizationId, ctx.orgId),
          sql`${flexEntries.userId} IN (${sql.join(
            teamMembers.map((m) => sql`${m.userId}`),
            sql`, `,
          )})`,
        ),
      )
      .groupBy(flexEntries.userId);

    // Merge with user info — minus optjent overtid (tæller i egen saldo)
    const earnedByUser = await getEarnedOvertimeByUser(
      ctx.db,
      ctx.orgId,
      teamMembers.map((m) => m.userId),
    );
    const balanceMap = new Map(
      balances.map((b) => [
        b.userId,
        {
          balance:
            Math.round(
              (Number(b.totalDelta) - (earnedByUser.get(b.userId) ?? 0)) * 100,
            ) / 100,
          totalEntries: Number(b.totalEntries),
        },
      ]),
    );

    return teamMembers.map((m) => ({
      userId: m.userId,
      user: m.user,
      ...(balanceMap.get(m.userId) ?? { balance: 0, totalEntries: 0 }),
    }));
  }),
});
