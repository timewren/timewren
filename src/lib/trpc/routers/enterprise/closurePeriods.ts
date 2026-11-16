import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  absenceRequests,
  absenceTypes,
  employeeProfiles,
  orgClosurePeriods,
  users,
} from "@/lib/db/schema";
import {
  type ClosureSkipReason,
  closureLengthDays,
  MAX_CLOSURE_DAYS,
  materializeClosureForEmployee,
  removeClosureRequests,
} from "@/lib/enterprise/closure";
import {
  getVacationOrgSettings,
  getVacationOverdraft,
} from "@/lib/enterprise/vacation";
import { loadDaysOff } from "@/lib/holidays/load";
import { logOrgAudit } from "@/lib/org-audit";
import { router } from "../../trpc";
import { orgAdminProcedure, organizationProcedure } from "./middleware";

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/**
 * Faste ferieuger / lukkeperioder (#436). Se lib/enterprise/closure.ts for
 * materialiseringen (én godkendt absence_request pr. aktiv medarbejder).
 */
export const enterpriseClosurePeriodsRouter = router({
  /** Alle lukkeperioder i org'en med fraværstype og antal berørte. */
  listClosurePeriods: organizationProcedure.query(async ({ ctx }) => {
    const periods = await ctx.db.query.orgClosurePeriods.findMany({
      where: eq(orgClosurePeriods.organizationId, ctx.orgId),
      with: {
        absenceType: { columns: { id: true, name: true, color: true } },
      },
      orderBy: [desc(orgClosurePeriods.startDate)],
    });
    if (periods.length === 0) return [];

    const counts = await ctx.db
      .select({
        closurePeriodId: absenceRequests.closurePeriodId,
        affected: count(),
      })
      .from(absenceRequests)
      .where(
        and(
          eq(absenceRequests.organizationId, ctx.orgId),
          eq(absenceRequests.status, "approved"),
          inArray(
            absenceRequests.closurePeriodId,
            periods.map((p) => p.id),
          ),
        ),
      )
      .groupBy(absenceRequests.closurePeriodId);
    const affectedById = new Map(
      counts.map((c) => [c.closurePeriodId, Number(c.affected)]),
    );

    return periods.map((p) => ({
      id: p.id,
      name: p.name,
      startDate: p.startDate,
      endDate: p.endDate,
      absenceType: p.absenceType,
      affected: affectedById.get(p.id) ?? 0,
      createdAt: p.createdAt,
    }));
  }),

  /**
   * Opret en lukkeperiode og materialisér godkendt fravær for alle aktive
   * medarbejdere i én transaktion. Medarbejdere med overlappende fravær
   * springes over og returneres i `skipped`.
   */
  createClosurePeriod: orgAdminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        startDate: dateString,
        endDate: dateString,
        absenceTypeId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.endDate < input.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: st("enterprise.endAfterStart"),
        });
      }
      if (
        closureLengthDays(input.startDate, input.endDate) > MAX_CLOSURE_DAYS
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.closure.maxDays", {
            days: MAX_CLOSURE_DAYS,
          }),
        });
      }

      const absenceType = await ctx.db.query.absenceTypes.findFirst({
        where: and(
          eq(absenceTypes.id, input.absenceTypeId),
          eq(absenceTypes.organizationId, ctx.orgId),
          eq(absenceTypes.isArchived, false),
        ),
        columns: { id: true, deductsVacation: true, vacationPool: true },
      });
      if (!absenceType) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.absenceTypeNotFound"),
        });
      }
      if (!absenceType.deductsVacation) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.closure.needsVacationType",
          ),
        });
      }

      const [employees, daysOff, overdraft, vacationSettings] =
        await Promise.all([
          ctx.db
            .select({
              userId: employeeProfiles.userId,
              weeklyHours: employeeProfiles.weeklyHours,
              workingDays: employeeProfiles.workingDays,
              name: users.name,
              email: users.email,
            })
            .from(employeeProfiles)
            .innerJoin(users, eq(users.id, employeeProfiles.userId))
            .where(
              and(
                eq(employeeProfiles.organizationId, ctx.orgId),
                eq(employeeProfiles.isActive, true),
              ),
            ),
          loadDaysOff(ctx.db, {
            orgId: ctx.orgId,
            userId: null,
            departmentId: null,
            start: input.startDate,
            end: input.endDate,
          }),
          getVacationOverdraft(ctx.db, ctx.orgId),
          getVacationOrgSettings(ctx.db, ctx.orgId),
        ]);

      return ctx.db.transaction(async (tx) => {
        const [period] = await tx
          .insert(orgClosurePeriods)
          .values({
            organizationId: ctx.orgId,
            name: input.name,
            startDate: input.startDate,
            endDate: input.endDate,
            absenceTypeId: absenceType.id,
            createdBy: ctx.session.user.id,
          })
          .returning();

        let affected = 0;
        const skipped: Array<{
          userId: string;
          name: string;
          reason: ClosureSkipReason;
          message: string;
        }> = [];

        for (const emp of employees) {
          const result = await materializeClosureForEmployee(tx, {
            orgId: ctx.orgId,
            period,
            absenceType,
            employee: {
              userId: emp.userId,
              weeklyHours: Number(emp.weeklyHours),
              workingDays: emp.workingDays,
            },
            holidayDates: daysOff
              .filter((h) => !h.isHalfDay)
              .map((h) => h.date),
            halfDayHolidayDates: daysOff
              .filter((h) => h.isHalfDay)
              .map((h) => h.date),
            createdBy: ctx.session.user.id,
            overdraft,
            settings: vacationSettings,
          });
          if (result.status === "created") {
            affected += 1;
          } else {
            skipped.push({
              userId: emp.userId,
              name: emp.name || emp.email,
              reason: result.reason,
              message: result.message,
            });
          }
        }

        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "closure_period_created",
          {
            metadata: {
              periodId: period.id,
              name: period.name,
              startDate: period.startDate,
              endDate: period.endDate,
              absenceTypeId: absenceType.id,
              affected,
              skipped: skipped.length,
            },
          },
        );

        return { period, affected, skipped };
      });
    }),

  /** Slet en lukkeperiode og tilbagefør saldo/flex for alle berørte. */
  deleteClosurePeriod: orgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const period = await ctx.db.query.orgClosurePeriods.findFirst({
        where: and(
          eq(orgClosurePeriods.id, input.id),
          eq(orgClosurePeriods.organizationId, ctx.orgId),
        ),
        columns: { id: true, name: true, startDate: true, endDate: true },
      });
      if (!period) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.closure.notFound"),
        });
      }

      return ctx.db.transaction(async (tx) => {
        const removed = await removeClosureRequests(tx, ctx.orgId, period.id);
        await tx
          .delete(orgClosurePeriods)
          .where(eq(orgClosurePeriods.id, period.id));
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "closure_period_deleted",
          {
            metadata: {
              periodId: period.id,
              name: period.name,
              startDate: period.startDate,
              endDate: period.endDate,
              removed,
            },
          },
        );
        return { success: true, removed };
      });
    }),
});
