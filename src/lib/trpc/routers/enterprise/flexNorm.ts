import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { employeeProfiles, organizations } from "@/lib/db/schema";
import {
  FLEX_NORM_PRESET_DEFS,
  NORM_PERIODS,
  NORM_YEAR_STARTS,
} from "@/lib/enterprise/norm-period";
import {
  loadFlexNormSettings,
  loadFlexNormStatus,
} from "@/lib/enterprise/norm-period-load";
import {
  assertUserInScope,
  getVisibleScope,
  profileScopeCondition,
} from "@/lib/enterprise/scope";
import { auditDiff, logOrgAudit } from "@/lib/org-audit";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { isDateStr } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerReadProcedure,
} from "./middleware";

const hoursOrNull = z.number().min(0).max(2000).nullable();

/**
 * Normperiode og flexsaldo (#507): org'en vælger periode og overførselsregel;
 * saldoen beregnes af src/lib/enterprise/norm-period(-load).
 */
export const enterpriseFlexNormRouter = router({
  getFlexNormSettings: organizationProcedure.query(async ({ ctx }) => {
    return {
      settings: await loadFlexNormSettings(ctx.db, ctx.orgId),
      presets: FLEX_NORM_PRESET_DEFS,
    };
  }),

  updateFlexNormSettings: orgAdminProcedure
    .input(
      z.object({
        period: z.enum(NORM_PERIODS),
        yearStart: z.enum(NORM_YEAR_STARTS),
        annualHours: z.number().min(1).max(4000).nullable(),
        carryoverMaxHours: hoursOrNull,
        carryoverMaxDeficitHours: hoursOrNull,
        startDate: z
          .string()
          .refine(isDateStr, { error: () => st("zod.invalidDate") })
          .nullable(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await loadFlexNormSettings(ctx.db, ctx.orgId);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(organizations)
          .set({
            flexNormPeriod: input.period,
            flexNormYearStart: input.yearStart,
            flexNormAnnualHours:
              input.annualHours == null ? null : input.annualHours.toFixed(1),
            flexCarryoverMaxHours:
              input.carryoverMaxHours == null
                ? null
                : input.carryoverMaxHours.toFixed(1),
            flexCarryoverMaxDeficitHours:
              input.carryoverMaxDeficitHours == null
                ? null
                : input.carryoverMaxDeficitHours.toFixed(1),
            flexNormStartDate: input.startDate,
          })
          .where(eq(organizations.id, ctx.orgId));
        const diff = auditDiff({ ...before }, { ...input });
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "flex_norm_settings_updated",
            { metadata: { diff } },
          );
        }
      });
      return loadFlexNormSettings(ctx.db, ctx.orgId);
    }),

  /**
   * Saldo i uge, måned og normperiode (egen, eller en medarbejders for
   * ledere/HR inden for scope). null = ingen medarbejderprofil.
   */
  getFlexNormBalance: organizationProcedure
    .input(z.object({ userId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = input?.userId ?? ctx.session.user.id;
      if (userId !== ctx.session.user.id) {
        if (!roleSatisfies(ctx.orgRole, "manager") && ctx.orgRole !== "hr") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "enterprise.flex.ownBalanceOnly"),
          });
        }
        await assertUserInScope(ctx.db, ctx, userId);
      }
      const status = await loadFlexNormStatus(ctx.db, {
        orgId: ctx.orgId,
        userIds: [userId],
      });
      return status.get(userId) ?? null;
    }),

  /** Holdets saldo i den aktuelle normperiode (leder/HR, scope). */
  getTeamFlexNormBalances: orgManagerReadProcedure.query(async ({ ctx }) => {
    const scope = await getVisibleScope(ctx.db, ctx);
    const members = await ctx.db.query.employeeProfiles.findMany({
      where: and(
        eq(employeeProfiles.organizationId, ctx.orgId),
        eq(employeeProfiles.isActive, true),
        profileScopeCondition(scope),
      ),
      columns: { userId: true },
      with: { user: { columns: { id: true, name: true, email: true } } },
    });
    if (members.length === 0) return [];
    const status = await loadFlexNormStatus(ctx.db, {
      orgId: ctx.orgId,
      userIds: members.map((m) => m.userId),
      history: 1,
    });
    return members
      .map((m) => {
        const s = status.get(m.userId);
        if (!s) return null;
        return {
          userId: m.userId,
          name: m.user?.name || m.user?.email || "Ukendt",
          periodLabel: s.current.label,
          carryIn: s.current.carryIn,
          periodFlex: s.current.totals.flex,
          balance: s.current.balance,
          weekFlex: s.week.flex,
          monthFlex: s.month.flex,
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null)
      .sort((a, b) => a.name.localeCompare(b.name, "da"));
  }),
});
