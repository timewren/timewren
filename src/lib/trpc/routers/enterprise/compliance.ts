import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { employeeProfiles, organizations } from "@/lib/db/schema";
import {
  COMPLIANCE_RULE_MODES,
  type DatedTimeEntry,
  getComplianceStatus,
  sumHoursByDay,
} from "@/lib/enterprise/compliance";
import {
  checkEntryCompliance,
  loadComplianceRuleSettings,
  referencePeriodStart,
} from "@/lib/enterprise/compliance-guard";
import { loadComplianceInputs } from "@/lib/enterprise/compliance-inputs";
import {
  canSeeUser,
  getVisibleScope,
  profileScopeCondition,
} from "@/lib/enterprise/scope";
import { copenhagenTodayAnchor } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerReadProcedure,
} from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const MAX_PERIOD_DAYS = 400;

/** Valgfri periode (E11): udeladt = referenceperioden frem til i dag. */
const periodInput = z
  .object({ from: dateString.optional(), to: dateString.optional() })
  .optional();

function toDateStr(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function resolvePeriod(
  input: { from?: string; to?: string } | undefined,
  referencePeriodMonths: number,
): { from: string; to: string } {
  // Dansk dato som anker uanset processens TZ (#649)
  const today = copenhagenTodayAnchor();
  const to = input?.to ?? toDateStr(today);
  const from =
    input?.from ??
    toDateStr(referencePeriodStart(referencePeriodMonths, today));
  if (from > to) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: st("enterprise.fromBeforeTo"),
    });
  }
  const days =
    (parseLocalDate(to).getTime() - parseLocalDate(from).getTime()) /
      86_400_000 +
    1;
  if (days > MAX_PERIOD_DAYS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: st("enterprise.periodMaxDays", { days: MAX_PERIOD_DAYS }),
    });
  }
  return { from, to };
}

function statusFor(
  profile: { isSelfScheduler: boolean },
  entries: DatedTimeEntry[],
  absenceDates: Set<string>,
  neutralAbsenceDates: Set<string>,
) {
  // Poster uden klokkeslæt (timeseddel-celler) skal stadig ligge i en uge
  // for 48 t-gennemsnittet; uden slut-tid deltager de ikke i hvile-målingen.
  const forEngine = entries.map((e) =>
    e.startTime
      ? e
      : { ...e, startTime: parseLocalDate(e.date), endTime: null },
  );
  return getComplianceStatus(
    { isSelfScheduler: profile.isSelfScheduler },
    forEngine,
    { absenceDates, neutralAbsenceDates, dayTotals: sumHoursByDay(entries) },
  );
}

export const enterpriseComplianceRouter = router({
  /**
   * getComplianceOverview — compliance-status for alle aktive medarbejdere
   * i perioden (default: referenceperioden). Manager+ only.
   */
  getComplianceOverview: orgManagerReadProcedure
    .input(periodInput)
    .query(async ({ ctx, input }) => {
      // HR/admin ser alle; afdelingsledere kun deres scope (E6)
      const [settings, scope] = await Promise.all([
        loadComplianceRuleSettings(ctx.db, ctx.orgId),
        getVisibleScope(ctx.db, ctx),
      ]);
      const period = resolvePeriod(input, settings.referencePeriodMonths);

      const profiles = await ctx.db.query.employeeProfiles.findMany({
        where: and(
          eq(employeeProfiles.organizationId, ctx.orgId),
          eq(employeeProfiles.isActive, true),
          profileScopeCondition(scope),
        ),
        with: {
          user: {
            columns: { id: true, name: true, email: true, image: true },
          },
        },
      });

      const { entriesByUser, absenceByUser, neutralAbsenceByUser } =
        await loadComplianceInputs(ctx.db, {
          orgId: ctx.orgId,
          userIds: profiles.map((p) => p.userId),
          from: period.from,
          to: period.to,
        });

      const employees = profiles.map((profile) => ({
        profile,
        compliance: statusFor(
          profile,
          entriesByUser.get(profile.userId) ?? [],
          absenceByUser.get(profile.userId) ?? new Set<string>(),
          neutralAbsenceByUser.get(profile.userId) ?? new Set<string>(),
        ),
        absenceDays: absenceByUser.get(profile.userId)?.size ?? 0,
      }));

      return {
        employees,
        period,
        settings: {
          enforceComplianceBlocking: settings.enforceComplianceBlocking,
          referencePeriodMonths: settings.referencePeriodMonths,
          rules: settings.rules,
        },
      };
    }),

  /**
   * getEmployeeCompliance — compliance-status for én medarbejder.
   */
  getEmployeeCompliance: organizationProcedure
    .input(
      z.object({
        employeeProfileId: z.string().uuid(),
        from: dateString.optional(),
        to: dateString.optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: eq(employeeProfiles.id, input.employeeProfileId),
      });

      if (!profile || profile.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }

      // Egen status må alle se; andre kun inden for kalderens scope
      // (medlem: ingen; afdelingsleder: egen afdeling; HR/admin: alle)
      if (profile.userId !== ctx.session.user.id) {
        const scope =
          ctx.orgRole === "member" ? null : await getVisibleScope(ctx.db, ctx);
        if (!scope || !canSeeUser(scope, profile.userId)) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "enterprise.compliance.ownOnly"),
          });
        }
      }

      const settings = await loadComplianceRuleSettings(ctx.db, ctx.orgId);
      const period = resolvePeriod(input, settings.referencePeriodMonths);
      const { entriesByUser, absenceByUser, neutralAbsenceByUser } =
        await loadComplianceInputs(ctx.db, {
          orgId: ctx.orgId,
          userIds: [profile.userId],
          from: period.from,
          to: period.to,
        });

      return statusFor(
        profile,
        entriesByUser.get(profile.userId) ?? [],
        absenceByUser.get(profile.userId) ?? new Set<string>(),
        neutralAbsenceByUser.get(profile.userId) ?? new Set<string>(),
      );
    }),

  /**
   * validateTimeEntry — vurdér en påtænkt registrering mod alle tre regler
   * (48 t-gennemsnit, 11 t hvile, 24 t ugehvile) med org'ens off/warn/block.
   * Samme motor som mutationerne bruger (compliance-guard.ts).
   */
  validateTimeEntry: organizationProcedure
    .input(
      z.object({
        date: z.string(),
        hours: z.number(),
        startTime: z.string().datetime({ offset: true }).optional(),
        endTime: z.string().datetime({ offset: true }).optional(),
        /** Post der redigeres (udelades fra beregningen) */
        excludeEntryId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const result = await checkEntryCompliance(ctx.db, {
        orgId: ctx.orgId,
        userId: ctx.session.user.id,
        candidate: {
          date: input.date,
          hours: input.hours,
          startTime: input.startTime,
          endTime: input.endTime,
        },
        excludeEntryIds: input.excludeEntryId ? [input.excludeEntryId] : [],
      });
      return {
        allowed: result.allowed,
        warnings: result.warnings,
        blocked: result.blocked,
        findings: result.findings,
      };
    }),

  /**
   * updateComplianceSettings — org-indstillinger. Admin/owner only.
   * enforceComplianceBlocking bevares som legacy-alias for rule48h=block.
   */
  updateComplianceSettings: orgAdminProcedure
    .input(
      z.object({
        enforceComplianceBlocking: z.boolean().optional(),
        complianceReferencePeriodMonths: z.enum(["4", "12"]).optional(),
        rule48h: z.enum(COMPLIANCE_RULE_MODES).optional(),
        dailyRest: z.enum(COMPLIANCE_RULE_MODES).optional(),
        weeklyRest: z.enum(COMPLIANCE_RULE_MODES).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const patch: Partial<typeof organizations.$inferInsert> = {};

      if (input.rule48h !== undefined) {
        patch.complianceRule48h = input.rule48h;
        patch.enforceComplianceBlocking = input.rule48h === "block";
      } else if (input.enforceComplianceBlocking !== undefined) {
        patch.enforceComplianceBlocking = input.enforceComplianceBlocking;
        patch.complianceRule48h = input.enforceComplianceBlocking
          ? "block"
          : "warn";
      }
      if (input.dailyRest !== undefined) {
        patch.complianceRuleDailyRest = input.dailyRest;
      }
      if (input.weeklyRest !== undefined) {
        patch.complianceRuleWeeklyRest = input.weeklyRest;
      }
      if (input.complianceReferencePeriodMonths !== undefined) {
        patch.complianceReferencePeriodMonths = Number(
          input.complianceReferencePeriodMonths,
        );
      }
      if (Object.keys(patch).length === 0) return { success: true };

      await ctx.db
        .update(organizations)
        .set(patch)
        .where(eq(organizations.id, ctx.orgId));

      return { success: true };
    }),
});
