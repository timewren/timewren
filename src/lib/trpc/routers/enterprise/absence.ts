import { TRPCError } from "@trpc/server";
import { and, eq, gte, inArray, isNull, lte, not, or, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import {
  absenceRequests,
  absenceTypes,
  employeeProfiles,
  overtimeLedger,
  vacationBalances,
  vacationLedger,
} from "@/lib/db/schema";
import { formatMailPeriod } from "@/lib/email/locale";
import { getRecipientLocale } from "@/lib/email/recipient-locale";
import { ensureDefaultAbsenceTypes } from "@/lib/enterprise/absence-defaults";
import {
  ABSENCE_CATEGORIES,
  allowsOpenPeriod,
  annualCapMessage,
  effectiveEndDate,
  evaluateAnnualCap,
  maskAbsenceType,
  roundToQuarterDay,
} from "@/lib/enterprise/absence-registration";
import { runBatch } from "@/lib/enterprise/batch";
import {
  effectiveProfileAt,
  loadEmploymentPeriodsForUser,
  normProfileAt,
} from "@/lib/enterprise/employment";
import { recalculateFlexDay } from "@/lib/enterprise/flex";
import { insertOvertimeLedger } from "@/lib/enterprise/overtime-ledger";
import {
  assertUserInScope,
  getVisibleScope,
  type ScopeCtx,
  userScopeCondition,
} from "@/lib/enterprise/scope";
import {
  calculateDailyNorm,
  overtimeDeductionForAbsence,
} from "@/lib/enterprise/timesheet";
import {
  applyConversionFactor,
  countWorkingDays,
  ensureVacationPeriod,
  evaluateVacationGuard,
  getVacationOrgSettings,
  getVacationOverdraft,
  loadLedgerProjection,
  lockVacationBalance,
  periodLabelFor,
  postVacationLedger,
  postVacationUsage,
  recomputeVacationBalance,
  remainingInPool,
  toVacationPool,
  vacationDeductionFactor,
  vacationGuardMessage,
} from "@/lib/enterprise/vacation";
import { loadOrgWorkSettings } from "@/lib/enterprise/work-settings";
import { toLocalDateStr } from "@/lib/format";
import { loadDaysOff } from "@/lib/holidays/load";
import { notify, resolveManagerRecipientIds } from "@/lib/notifications/bus";
import { pushToUser } from "@/lib/notifications/push";
import { auditDiff, logOrgAudit } from "@/lib/org-audit";
import { roleSeesWholeOrg } from "@/lib/permissions/org-role";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { router } from "../../trpc";
import {
  type OrgRole,
  orgAdminProcedure,
  organizationProcedure,
  orgManagerProcedure,
} from "./middleware";

type AbsenceCtx = ScopeCtx & {
  db: typeof import("@/lib/db").db;
  orgRole: OrgRole;
  session: { user: { id: string; name?: string | null } };
};

/**
 * Authorize an absence approval/rejection. Admins and owners may act on anyone
 * in the org; a manager may only act on employees in their scope (afdelinger
 * som lead/deputy ∪ direkte reports, se src/lib/enterprise/scope.ts).
 * orgManagerProcedure already gated out plain members and hr.
 */
async function assertCanManageAbsenceOf(
  ctx: AbsenceCtx,
  targetUserId: string,
): Promise<void> {
  if (roleSeesWholeOrg(ctx.orgRole)) return;
  await assertUserInScope(
    ctx.db,
    ctx,
    targetUserId,
    await tr("serverErrors", "enterprise.absence.ownEmployeesOnly"),
  );
}

/**
 * Godkend én anmodning (delt af approveRequest og approveMany, #464).
 * Statusskift, feriesaldo og overtidssaldo i ÉN transaktion (#452).
 */
async function approveAbsenceRequest(ctx: AbsenceCtx, id: string) {
  // SECURITY: verify org ownership
  const request = await ctx.db.query.absenceRequests.findFirst({
    where: eq(absenceRequests.id, id),
    with: { absenceType: true },
  });
  if (!request || request.organizationId !== ctx.orgId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.absence.requestNotFound"),
    });
  }

  if (request.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr(
        "serverErrors",
        "enterprise.absence.approveOnlyPending",
      ),
    });
  }

  if (request.userId === ctx.session.user.id) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.absence.noSelfApprove"),
    });
  }

  await assertCanManageAbsenceOf(ctx, request.userId);

  const updated = await ctx.db.transaction(async (tx) => {
    // Prædikat på status: to samtidige godkendelser (eller godkend +
    // annullér) må ikke begge trække saldo — tom RETURNING ⇒ abort.
    const [row] = await tx
      .update(absenceRequests)
      .set({
        status: "approved",
        approvedBy: ctx.session.user.id,
        approvedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(
        and(eq(absenceRequests.id, id), eq(absenceRequests.status, "pending")),
      )
      .returning();
    if (!row) {
      throw new TRPCError({
        code: "CONFLICT",
        message: await tr("serverErrors", "enterprise.handledElsewhere"),
      });
    }

    await logOrgAudit(
      tx,
      ctx.orgId,
      ctx.session.user.id,
      "absence_request_approved",
      {
        targetUserId: request.userId,
        metadata: {
          requestId: request.id,
          absenceTypeId: request.absenceTypeId,
          startDate: request.startDate,
          endDate: request.endDate,
          totalDays: Number(request.totalDays ?? 0),
        },
      },
    );

    // Update vacation balance if applicable
    if (request.absenceType.deductsVacation && request.deductedDays) {
      const pool = toVacationPool(request.absenceType.vacationPool);
      const balance = await postVacationUsage(tx, {
        userId: request.userId,
        orgId: ctx.orgId,
        date: request.startDate,
        days: Number(request.deductedDays),
        pool,
        refType: "absence_request",
        refId: request.id,
        createdBy: ctx.session.user.id,
      });
      await logOrgAudit(
        tx,
        ctx.orgId,
        ctx.session.user.id,
        "vacation_balance_adjusted",
        {
          targetUserId: request.userId,
          metadata: {
            periodStart: balance.periodStart,
            pool,
            deltaDays: Number(request.deductedDays),
            reason: "absence_approved",
            requestId: request.id,
          },
        },
      );
    }

    // Afspadsering: træk fraværsdagene fra overtidssaldoen (dage × normtid)
    if (request.absenceType.deductsOvertime) {
      const [profile, orgSettings] = await Promise.all([
        tx.query.employeeProfiles.findFirst({
          where: and(
            eq(employeeProfiles.userId, request.userId),
            eq(employeeProfiles.organizationId, ctx.orgId),
          ),
          columns: {
            weeklyHours: true,
            workingDays: true,
            dailyNormHours: true,
          },
        }),
        loadOrgWorkSettings(tx, ctx.orgId),
      ]);
      // Ansættelseshistorik (#465): normen som den gjaldt ved fraværets start
      const employment = profile
        ? normProfileAt(
            await loadEmploymentPeriodsForUser(tx, request.userId, ctx.orgId),
            profile,
            request.startDate,
          )
        : null;
      const dailyNorm = employment
        ? calculateDailyNorm(employment, orgSettings)
        : calculateDailyNorm(
            { weeklyHours: 37, workingDays: null },
            orgSettings,
          );
      // totalDays = kalender-arbejdsdage; deductedDays er FTE-skaleret
      // og ville dobbelt-skalere deltid (#452).
      const deduction = overtimeDeductionForAbsence({
        days: Number(request.totalDays ?? 0),
        dailyNorm,
        startDate: request.startDate,
        endDate: effectiveEndDate(
          request.startDate,
          request.endDate,
          copenhagenToday(),
        ),
      });
      if (deduction) {
        await insertOvertimeLedger(tx, {
          organizationId: ctx.orgId,
          userId: request.userId,
          type: "used",
          hours: deduction.hours,
          absenceRequestId: request.id,
          note: deduction.note,
          createdBy: ctx.session.user.id,
        });
      }
    }

    return row;
  });

  // Besked til medarbejderen via notifikationsbussen (E10, best effort)
  void notify({
    orgId: ctx.orgId,
    event: "absence.approved",
    payload: {
      managerName:
        ctx.session.user.name ??
        (await tr("serverErrors", "enterprise.yourManager")),
      typeName: request.absenceType.name,
      startDate: request.startDate,
      endDate: request.endDate,
    },
    userIds: [request.userId],
  });

  return updated;
}

/** Afvis én anmodning (delt af rejectRequest og rejectMany, #464). */
async function rejectAbsenceRequest(
  ctx: AbsenceCtx,
  id: string,
  reviewNote: string | undefined,
) {
  // SECURITY: verify org ownership
  const request = await ctx.db.query.absenceRequests.findFirst({
    where: eq(absenceRequests.id, id),
    with: { absenceType: { columns: { name: true } } },
  });
  if (!request || request.organizationId !== ctx.orgId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.absence.requestNotFound"),
    });
  }

  if (request.status !== "pending") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.absence.rejectOnlyPending"),
    });
  }

  await assertCanManageAbsenceOf(ctx, request.userId);

  const updated = await ctx.db.transaction(async (tx) => {
    const [row] = await tx
      .update(absenceRequests)
      .set({
        status: "rejected",
        rejectedAt: new Date(),
        rejectionReason: reviewNote,
        updatedAt: new Date(),
      })
      .where(
        and(eq(absenceRequests.id, id), eq(absenceRequests.status, "pending")),
      )
      .returning();
    if (!row) {
      throw new TRPCError({
        code: "CONFLICT",
        message: await tr("serverErrors", "enterprise.handledElsewhere"),
      });
    }
    await logOrgAudit(
      tx,
      ctx.orgId,
      ctx.session.user.id,
      "absence_request_rejected",
      {
        targetUserId: request.userId,
        metadata: {
          requestId: request.id,
          absenceTypeId: request.absenceTypeId,
          startDate: request.startDate,
          endDate: request.endDate,
          reason: reviewNote ?? null,
        },
      },
    );
    return row;
  });

  // Besked til medarbejderen via notifikationsbussen (E10, best effort)
  void notify({
    orgId: ctx.orgId,
    event: "absence.rejected",
    payload: {
      managerName:
        ctx.session.user.name ??
        (await tr("serverErrors", "enterprise.yourManager")),
      typeName: request.absenceType.name,
      startDate: request.startDate,
      endDate: request.endDate,
      rejectionReason: reviewNote ?? null,
    },
    userIds: [request.userId],
  });

  return updated;
}

/** Datoer fra..til (inkl.), højst `max` stk. */
function datesBetween(from: string, to: string, max: number): string[] {
  const out: string[] = [];
  const [y, m, d] = from.split("-").map(Number);
  const cur = new Date(y, m - 1, d);
  while (out.length < max) {
    const str = toLocalDateStr(cur);
    if (str > to) break;
    out.push(str);
    cur.setDate(cur.getDate() + 1);
  }
  return out;
}

const absenceTypeFields = {
  category: z.enum(ABSENCE_CATEGORIES),
  requiresDocumentation: z.boolean(),
  annualCapDays: z.number().min(0.5).max(365).nullable(),
  visibleToColleagues: z.boolean(),
};

export const enterpriseAbsenceRouter = router({
  /**
   * listTypes — list all absence types for the org.
   */
  listTypes: organizationProcedure.query(async ({ ctx }) => {
    const where = and(
      eq(absenceTypes.organizationId, ctx.orgId),
      eq(absenceTypes.isArchived, false),
    );
    const types = await ctx.db.query.absenceTypes.findMany({
      where,
      orderBy: (t, { asc }) => [asc(t.name)],
    });
    if (types.length > 0) return types;

    // Lazy seed (#435): orgs uden typer (fx enterprise-orgs fra før
    // standardtyperne fandtes) får dem ved første visning.
    await ensureDefaultAbsenceTypes(ctx.db, ctx.orgId);
    return ctx.db.query.absenceTypes.findMany({
      where,
      orderBy: (t, { asc }) => [asc(t.name)],
    });
  }),

  /**
   * createType — create a custom absence type. Admin/owner only.
   */
  createType: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        deductsVacation: z.boolean().default(false),
        vacationPool: z.enum(["vacation", "extra"]).default("vacation"),
        deductsOvertime: z.boolean().default(false),
        requiresApproval: z.boolean().default(true),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .default("#3b82f6"),
        category: absenceTypeFields.category.default("other"),
        requiresDocumentation:
          absenceTypeFields.requiresDocumentation.default(false),
        annualCapDays: absenceTypeFields.annualCapDays.optional(),
        visibleToColleagues:
          absenceTypeFields.visibleToColleagues.default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { annualCapDays, ...rest } = input;
      const [type] = await ctx.db
        .insert(absenceTypes)
        .values({
          organizationId: ctx.orgId,
          ...rest,
          annualCapDays: annualCapDays != null ? String(annualCapDays) : null,
        })
        .returning();

      return type;
    }),

  /**
   * updateType — admin/owner only.
   * SECURITY: verifies type belongs to ctx.orgId.
   */
  updateType: orgAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
        deductsVacation: z.boolean().optional(),
        vacationPool: z.enum(["vacation", "extra"]).optional(),
        deductsOvertime: z.boolean().optional(),
        requiresApproval: z.boolean().optional(),
        color: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/)
          .optional(),
        category: absenceTypeFields.category.optional(),
        requiresDocumentation:
          absenceTypeFields.requiresDocumentation.optional(),
        annualCapDays: absenceTypeFields.annualCapDays.optional(),
        visibleToColleagues: absenceTypeFields.visibleToColleagues.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const type = await ctx.db.query.absenceTypes.findFirst({
        where: eq(absenceTypes.id, input.id),
      });
      if (!type || type.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.absenceTypeNotFound"),
        });
      }

      const { id, annualCapDays, ...data } = input;
      const [updated] = await ctx.db
        .update(absenceTypes)
        .set({
          ...data,
          ...(annualCapDays !== undefined
            ? {
                annualCapDays:
                  annualCapDays != null ? String(annualCapDays) : null,
              }
            : {}),
        })
        .where(eq(absenceTypes.id, id))
        .returning();

      return updated;
    }),

  /**
   * deleteType — admin/owner only.
   * SECURITY: verifies type belongs to ctx.orgId.
   * Blocks deletion if pending requests exist.
   */
  deleteType: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const type = await ctx.db.query.absenceTypes.findFirst({
        where: eq(absenceTypes.id, input.id),
      });
      if (!type || type.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.absenceTypeNotFound"),
        });
      }

      // Check for pending requests
      const pendingRequest = await ctx.db.query.absenceRequests.findFirst({
        where: and(
          eq(absenceRequests.absenceTypeId, input.id),
          eq(absenceRequests.status, "pending"),
        ),
      });
      if (pendingRequest) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.typeHasPending",
          ),
        });
      }

      await ctx.db
        .update(absenceTypes)
        .set({ isArchived: true })
        .where(eq(absenceTypes.id, input.id));
      return { success: true };
    }),

  /**
   * createRequest — create an absence request for the caller.
   * SECURITY: verifies absenceTypeId belongs to ctx.orgId.
   * Checks vacation balance if the type deducts vacation.
   */
  createRequest: organizationProcedure
    .input(
      z.object({
        absenceTypeId: z.string(),
        startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        // Udelades = åben periode (kun sygdom/orlov, #460)
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        halfDayStart: z.boolean().default(false),
        halfDayEnd: z.boolean().default(false),
        note: z.string().optional(),
        // Registrér på vegne af en medarbejder (leder for egne referencer,
        // admin/owner for alle). Udeladt = egen anmodning.
        userId: z.string().optional(),
        // Delvis fravær: timer pr. dag → totalDays = dage × timer/dagsnorm
        hoursPerDay: z.number().min(0.25).max(24).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const today = copenhagenToday();
      const userId = input.userId ?? ctx.session.user.id;
      const onBehalf = userId !== ctx.session.user.id;

      if (onBehalf) {
        if (ctx.orgRole === "member") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "enterprise.absence.managersOnlyForOthers",
            ),
          });
        }
        await assertCanManageAbsenceOf(ctx, userId);
      }

      if (input.endDate && input.endDate < input.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.endBeforeStart",
          ),
        });
      }

      // Get employee profile
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, userId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
        with: { user: { columns: { name: true, email: true } } },
      });

      if (!profile) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: onBehalf
            ? "Medarbejderen har ingen medarbejderprofil i denne organisation"
            : "Du har ingen medarbejderprofil i denne organisation",
        });
      }

      // SECURITY: verify absence type belongs to this org
      const absenceType = await ctx.db.query.absenceTypes.findFirst({
        where: eq(absenceTypes.id, input.absenceTypeId),
      });
      if (
        !absenceType ||
        absenceType.organizationId !== ctx.orgId ||
        absenceType.isArchived
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.absenceTypeNotFound"),
        });
      }

      // Åben periode (ingen slutdato) er kun tilladt for sygdom/orlov
      const endDate = input.endDate ?? null;
      if (!endDate && !allowsOpenPeriod(absenceType.category)) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.endDateRequired",
            { type: absenceType.name },
          ),
        });
      }
      // Beregningsgrundlag: åben periode tæller til og med i dag og
      // genberegnes ved raskmelding.
      const calcEndDate = effectiveEndDate(input.startDate, endDate, today);

      // Get holidays for the period to exclude from working day count
      // Fridagskalenderen (#526) — helligdage trækker ikke fra ferien
      const orgHolidays = await loadDaysOff(ctx.db, {
        orgId: ctx.orgId,
        userId: profile.userId,
        start: input.startDate,
        end: calcEndDate,
      });
      // Exclude half-day holidays from full exclusion (they still count as half)
      const holidayDates = orgHolidays
        .filter((h) => !h.isHalfDay)
        .map((h) => h.date);

      // Delvis fravær i timer udelukker halve dage (timerne er præcisionen)
      const halfDayStart = input.hoursPerDay ? false : input.halfDayStart;
      const halfDayEnd = input.hoursPerDay ? false : input.halfDayEnd;

      // Ansættelseshistorik (#465): ugetimer/arbejdsdage som de gjaldt ved
      // fraværets start; uden dækkende periode falder vi tilbage til profilen
      const employment =
        (await effectiveProfileAt(ctx.db, {
          userId: profile.userId,
          orgId: ctx.orgId,
          profile,
          date: input.startDate,
        })) ?? profile;

      const orgSettings = await loadOrgWorkSettings(ctx.db, ctx.orgId);
      const dailyNorm = calculateDailyNorm(employment, orgSettings);

      // Calculate working days
      const workingDaysCount = countWorkingDays(
        input.startDate,
        calcEndDate,
        employment.workingDays ?? ["1", "2", "3", "4", "5"],
        holidayDates,
        halfDayStart ? "morning" : "full",
        halfDayEnd ? "afternoon" : "full",
        orgHolidays.filter((h) => h.isHalfDay).map((h) => h.date),
        input.hoursPerDay
          ? dailyNorm > 0
            ? input.hoursPerDay / dailyNorm
            : 0
          : 1,
      );
      const totalDays = input.hoursPerDay
        ? roundToQuarterDay(workingDaysCount)
        : workingDaysCount;

      // Fradrag i feriedage: monthly-orgs trækker 1 dag pr. dag (saldoen er i
      // dage, #461); upfront-orgs beholder FTE-konverteringen (22,5 t →
      // 37/22,5 ≈ 1,64 pr. dag). Faktoren udledes af ugetimer + org'ens
      // fuldtidsnorm, så den ikke drifter fra conversionFactor-kolonnen.
      let deductedDays: number | null = null;
      const pool = toVacationPool(absenceType.vacationPool);
      const capYear = Number(input.startDate.slice(0, 4));

      // Saldo-guard, overlap-tjek, insert og saldo-fradrag i ÉN transaktion
      // med saldo-rækken låst (FOR UPDATE) før guarden, så to samtidige
      // anmodninger ikke begge kan passere (#452).
      const created = await ctx.db.transaction(async (tx) => {
        let warning = false;
        if (absenceType.deductsVacation) {
          const vacationSettings = await getVacationOrgSettings(tx, ctx.orgId);
          const factor = vacationDeductionFactor(
            vacationSettings,
            Number(employment.weeklyHours),
          );
          deductedDays = applyConversionFactor(totalDays, factor);

          // Saldo-guard pr. pulje med org'ens tolerance (#435/#437). Rækken
          // oprettes on-demand og låses, så guarden altid måler mod den
          // aktuelle, serialiserede saldo.
          const balance = await lockVacationBalance(
            tx,
            userId,
            ctx.orgId,
            input.startDate,
          );
          const overdraft = await getVacationOverdraft(tx, ctx.orgId);
          const remaining = remainingInPool(balance, pool);
          const guard = evaluateVacationGuard(
            remaining,
            deductedDays,
            overdraft,
          );
          if (!guard.allowed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: vacationGuardMessage(
                pool,
                remaining,
                deductedDays,
                overdraft,
              ),
            });
          }
          warning = guard.warning;
        }

        // Årsloft pr. type (#460, fx barns 1. sygedag = 2 dage/år)
        if (absenceType.annualCapDays != null) {
          const [used] = await tx
            .select({
              days: sql<string>`COALESCE(SUM(${absenceRequests.totalDays}::numeric), 0)`,
            })
            .from(absenceRequests)
            .where(
              and(
                eq(absenceRequests.userId, userId),
                eq(absenceRequests.organizationId, ctx.orgId),
                eq(absenceRequests.absenceTypeId, absenceType.id),
                inArray(absenceRequests.status, ["pending", "approved"]),
                gte(absenceRequests.startDate, `${capYear}-01-01`),
                lte(absenceRequests.startDate, `${capYear}-12-31`),
              ),
            );
          const cap = evaluateAnnualCap({
            capDays: Number(absenceType.annualCapDays),
            usedDays: Number(used?.days ?? 0),
            requestedDays: totalDays,
          });
          if (!cap.allowed) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: annualCapMessage({
                typeName: absenceType.name,
                capDays: Number(absenceType.annualCapDays),
                remaining: cap.remaining ?? 0,
                year: capYear,
              }),
            });
          }
        }

        // Check for overlapping requests (åbne perioder dækker til i dag)
        const overlapping = await tx.query.absenceRequests.findFirst({
          where: and(
            eq(absenceRequests.userId, userId),
            eq(absenceRequests.organizationId, ctx.orgId),
            not(inArray(absenceRequests.status, ["cancelled", "rejected"])),
            lte(absenceRequests.startDate, calcEndDate),
            or(
              isNull(absenceRequests.endDate),
              gte(absenceRequests.endDate, input.startDate),
            ),
          ),
        });
        if (overlapping) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: onBehalf
              ? await tr("serverErrors", "enterprise.absence.overlapOther")
              : await tr("serverErrors", "enterprise.absence.overlapOwn"),
          });
        }

        // Determine initial status
        const status = absenceType.requiresApproval ? "pending" : "approved";
        const autoApprovedByRegistrar = status === "approved" && onBehalf;

        const [request] = await tx
          .insert(absenceRequests)
          .values({
            userId,
            organizationId: ctx.orgId,
            absenceTypeId: input.absenceTypeId,
            startDate: input.startDate,
            endDate,
            halfDayStart,
            halfDayEnd,
            hoursPerDay:
              input.hoursPerDay != null ? String(input.hoursPerDay) : null,
            totalDays: String(totalDays),
            deductedDays: deductedDays !== null ? String(deductedDays) : null,
            status,
            note: input.note,
            registeredBy: onBehalf ? ctx.session.user.id : null,
            approvedBy: autoApprovedByRegistrar ? ctx.session.user.id : null,
            approvedAt: autoApprovedByRegistrar ? new Date() : null,
          })
          .returning();

        // Auto-godkendt og trækker ferie: postér i ledgeren + genberegn saldo
        let balancePeriodStart: string | null = null;
        if (status === "approved" && deductedDays !== null) {
          const balance = await postVacationUsage(tx, {
            userId,
            orgId: ctx.orgId,
            date: input.startDate,
            days: deductedDays,
            pool,
            refType: "absence_request",
            refId: request.id,
            createdBy: ctx.session.user.id,
          });
          balancePeriodStart = balance.periodStart;
        }

        // Auto-godkendt afspadsering: samme ledger-post som approveRequest,
        // så cancelRequest kan tilbageføre den via absenceRequestId (#452).
        if (status === "approved" && absenceType.deductsOvertime) {
          // Kalender-arbejdsdage × dagsnorm — IKKE de FTE-konverterede
          // deductedDays, ellers dobbelt-skaleres deltid.
          const deduction = overtimeDeductionForAbsence({
            days: totalDays,
            dailyNorm,
            startDate: input.startDate,
            endDate: calcEndDate,
          });
          if (deduction) {
            await insertOvertimeLedger(tx, {
              organizationId: ctx.orgId,
              userId,
              type: "used",
              hours: deduction.hours,
              absenceRequestId: request.id,
              note: deduction.note,
              createdBy: ctx.session.user.id,
            });
          }
        }

        // Hændelseslog (#466) i samme tx — persondata om sygdom hos en
        // offentlig arbejdsgiver kræver hvem/hvornår/hvad.
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "absence_request_created",
          {
            targetUserId: userId,
            metadata: {
              requestId: request.id,
              absenceTypeId: absenceType.id,
              startDate: input.startDate,
              endDate,
              hoursPerDay: input.hoursPerDay ?? null,
              totalDays,
              status,
              onBehalf,
            },
          },
        );
        if (status === "approved" && deductedDays !== null) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "vacation_balance_adjusted",
            {
              targetUserId: userId,
              metadata: {
                periodStart: balancePeriodStart,
                pool,
                deltaDays: deductedDays,
                reason: "absence_auto_approved",
                requestId: request.id,
              },
            },
          );
        }

        // warning: saldoen bliver negativ (inden for tolerancen) når anmodningen
        // godkendes — UI viser en gul advarsel.
        return { ...request, warning };
      });

      // Notifikationer via bussen (E10) — best effort, bussen kaster aldrig
      const employeeName = profile.user?.name ?? "En medarbejder";
      try {
        if (onBehalf) {
          void notify({
            orgId: ctx.orgId,
            event: "absence.registered",
            payload: {
              registrarName:
                ctx.session.user.name ??
                (await tr("serverErrors", "enterprise.yourManager")),
              typeName: absenceType.name,
              startDate: input.startDate,
              endDate,
              hoursPerDay: input.hoursPerDay ?? null,
            },
            userIds: [userId],
          });
        }

        const needsManager =
          created.status === "pending" ||
          (!onBehalf && absenceType.category === "sickness");
        if (needsManager) {
          const managerIds = await resolveManagerRecipientIds(ctx.db, {
            orgId: ctx.orgId,
            employeeUserId: userId,
            excludeUserId: ctx.session.user.id,
          });
          if (created.status === "pending") {
            void notify({
              orgId: ctx.orgId,
              event: "absence.requested",
              payload: {
                employeeName,
                employeeUserId: userId,
                typeName: absenceType.name,
                startDate: input.startDate,
                endDate,
                totalDays,
                note: input.note,
              },
              userIds: managerIds,
            });
          } else {
            // Sygemelding registreret af medarbejderen selv (auto-godkendt)
            // → lederen skal vide det (E2/E10)
            void notify({
              orgId: ctx.orgId,
              event: "absence.sick_registered",
              payload: {
                employeeName,
                employeeUserId: userId,
                typeName: absenceType.name,
                startDate: input.startDate,
                endDate,
              },
              userIds: managerIds,
            });
          }
        }
      } catch (e) {
        console.error("[absence] Kunne ikke sende notifikation:", e);
      }

      return created;
    }),

  /**
   * reportWell — raskmelding (#460): luk en åben periode med sidste
   * fraværsdag og genberegn dage/saldo/flex. Medarbejderen selv, dennes leder
   * eller admin/owner.
   */
  reportWell: organizationProcedure
    .input(
      z.object({
        requestId: z.string(),
        lastSickDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const today = copenhagenToday();
      const request = await ctx.db.query.absenceRequests.findFirst({
        where: eq(absenceRequests.id, input.requestId),
        with: { absenceType: true },
      });
      if (!request || request.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.absence.registrationNotFound",
          ),
        });
      }
      const isOwn = request.userId === ctx.session.user.id;
      if (!isOwn) {
        if (ctx.orgRole === "member") {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "enterprise.absence.selfReturnOnly",
            ),
          });
        }
        await assertCanManageAbsenceOf(ctx, request.userId);
      }
      if (request.endDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.periodAlreadyEnded",
          ),
        });
      }
      if (request.status !== "pending" && request.status !== "approved") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.onlyActiveRecovered",
          ),
        });
      }
      if (input.lastSickDate < request.startDate) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.lastDayBeforeStart",
          ),
        });
      }

      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, request.userId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
      });
      // Ansættelseshistorik (#465): vilkårene ved sygemeldingens start
      const employment = profile
        ? ((await effectiveProfileAt(ctx.db, {
            userId: request.userId,
            orgId: ctx.orgId,
            profile,
            date: request.startDate,
          })) ?? profile)
        : null;
      const workingDays = employment?.workingDays ?? ["1", "2", "3", "4", "5"];
      // Fridagskalenderen (#526) — helligdage trækker ikke fra ferien
      const orgHolidays = await loadDaysOff(ctx.db, {
        orgId: ctx.orgId,
        userId: request.userId,
        start: request.startDate,
        end: input.lastSickDate,
      });
      const holidayDates = orgHolidays
        .filter((h) => !h.isHalfDay)
        .map((h) => h.date);
      const orgSettings = await loadOrgWorkSettings(ctx.db, ctx.orgId);
      const dailyNorm = employment
        ? calculateDailyNorm(employment, orgSettings)
        : calculateDailyNorm(
            { weeklyHours: 37, workingDays: null },
            orgSettings,
          );
      const hoursPerDay = request.hoursPerDay
        ? Number(request.hoursPerDay)
        : null;
      const workingDaysCount = countWorkingDays(
        request.startDate,
        input.lastSickDate,
        workingDays,
        holidayDates,
        !request.hoursPerDay && request.halfDayStart ? "morning" : "full",
        !request.hoursPerDay && request.halfDayEnd ? "afternoon" : "full",
        orgHolidays.filter((h) => h.isHalfDay).map((h) => h.date),
        hoursPerDay ? (dailyNorm > 0 ? hoursPerDay / dailyNorm : 0) : 1,
      );
      const totalDays = hoursPerDay
        ? roundToQuarterDay(workingDaysCount)
        : workingDaysCount;

      const pool = toVacationPool(request.absenceType.vacationPool);

      const updated = await ctx.db.transaction(async (tx) => {
        let deductedDays: number | null = null;
        if (request.absenceType.deductsVacation) {
          const vacationSettings = await getVacationOrgSettings(tx, ctx.orgId);
          const factor = vacationDeductionFactor(
            vacationSettings,
            Number(
              employment?.weeklyHours ?? vacationSettings.defaultWeeklyHours,
            ),
          );
          deductedDays = applyConversionFactor(totalDays, factor);
          if (request.status === "approved") {
            const locked = await lockVacationBalance(
              tx,
              request.userId,
              ctx.orgId,
              request.startDate,
            );
            const delta = deductedDays - Number(request.deductedDays ?? 0);
            if (delta !== 0) {
              await postVacationUsage(tx, {
                userId: request.userId,
                orgId: ctx.orgId,
                date: request.startDate,
                days: delta,
                pool,
                refType: "absence_request",
                refId: request.id,
                note: "Raskmelding",
                createdBy: ctx.session.user.id,
              });
              await logOrgAudit(
                tx,
                ctx.orgId,
                ctx.session.user.id,
                "vacation_balance_adjusted",
                {
                  targetUserId: request.userId,
                  metadata: {
                    periodStart: locked.periodStart,
                    pool,
                    deltaDays: delta,
                    reason: "absence_reported_well",
                    requestId: request.id,
                  },
                },
              );
            }
          }
        }

        if (
          request.status === "approved" &&
          request.absenceType.deductsOvertime
        ) {
          await tx
            .delete(overtimeLedger)
            .where(
              and(
                eq(overtimeLedger.organizationId, ctx.orgId),
                eq(overtimeLedger.absenceRequestId, request.id),
              ),
            );
          const deduction = overtimeDeductionForAbsence({
            days: totalDays,
            dailyNorm,
            startDate: request.startDate,
            endDate: input.lastSickDate,
          });
          if (deduction) {
            await insertOvertimeLedger(tx, {
              organizationId: ctx.orgId,
              userId: request.userId,
              type: "used",
              hours: deduction.hours,
              absenceRequestId: request.id,
              note: deduction.note,
              createdBy: ctx.session.user.id,
            });
          }
        }

        // Prædikat på endDate IS NULL: to samtidige raskmeldinger må ikke
        // begge justere saldoen.
        const [row] = await tx
          .update(absenceRequests)
          .set({
            endDate: input.lastSickDate,
            reportedWellAt: new Date(),
            totalDays: String(totalDays),
            deductedDays: deductedDays !== null ? String(deductedDays) : null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(absenceRequests.id, request.id),
              isNull(absenceRequests.endDate),
            ),
          )
          .returning();
        if (!row) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.absence.endedElsewhere",
            ),
          });
        }
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "absence_reported_well",
          {
            targetUserId: request.userId,
            metadata: {
              requestId: request.id,
              absenceTypeId: request.absenceTypeId,
              startDate: request.startDate,
              lastSickDate: input.lastSickDate,
              onBehalf: !isOwn,
            },
          },
        );
        return row;
      });

      // Flex: dagene fra sidste sygedag til i dag har igen normtid —
      // genberegn dem (best effort, begrænset vindue).
      try {
        const recalcEnd =
          today > input.lastSickDate ? today : input.lastSickDate;
        for (const date of datesBetween(request.startDate, recalcEnd, 120)) {
          await recalculateFlexDay(ctx.db, {
            userId: request.userId,
            orgId: ctx.orgId,
            date,
          });
        }
        if (!isOwn) {
          const pushLocale = await getRecipientLocale({
            userId: request.userId,
          });
          await pushToUser(request.userId, {
            title: await tr(
              "serverErrors",
              "enterprise.absence.recoveredPushTitle",
              undefined,
              pushLocale,
            ),
            body: await tr(
              "serverErrors",
              "enterprise.absence.recoveredPushBody",
              {
                type: request.absenceType.name.toLowerCase(),
                date: formatMailPeriod(
                  input.lastSickDate,
                  input.lastSickDate,
                  pushLocale,
                ),
              },
              pushLocale,
            ),
            url: "/dashboard/enterprise/absence",
            tag: `absence-${request.id}`,
            data: { type: "absence_reported_well", requestId: request.id },
          });
        }
      } catch (e) {
        console.error("[absence] Efterbehandling af raskmelding fejlede:", e);
      }

      return updated;
    }),

  /**
   * updateRequest — edit a pending absence request (own requests only).
   * SECURITY: verifies request belongs to ctx.session.user.id AND ctx.orgId.
   * Only allows editing when status === "pending".
   */
  updateRequest: organizationProcedure
    .input(
      z.object({
        id: z.string(),
        absenceTypeId: z.string().optional(),
        startDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        endDate: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/)
          .optional(),
        halfDayStart: z.boolean().optional(),
        halfDayEnd: z.boolean().optional(),
        note: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.absenceRequests.findFirst({
        where: eq(absenceRequests.id, input.id),
        with: { absenceType: true },
      });
      if (!existing || existing.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.absence.requestNotFoundShort",
          ),
        });
      }
      if (existing.userId !== ctx.session.user.id) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.absence.ownOnlyEdit"),
        });
      }
      if (existing.status !== "pending") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.pendingOnlyEdit",
          ),
        });
      }

      // SECURITY: en ny fraværstype skal tilhøre org'en (som i createRequest)
      if (
        input.absenceTypeId &&
        input.absenceTypeId !== existing.absenceTypeId
      ) {
        const absenceType = await ctx.db.query.absenceTypes.findFirst({
          where: eq(absenceTypes.id, input.absenceTypeId),
        });
        if (
          !absenceType ||
          absenceType.organizationId !== ctx.orgId ||
          absenceType.isArchived
        ) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "enterprise.absenceTypeNotFound"),
          });
        }
      }

      // If dates changed, recalculate working days. Åben periode (endDate
      // NULL) beregnes til og med i dag som i createRequest.
      const startDate = input.startDate ?? existing.startDate;
      const endDate = effectiveEndDate(
        startDate,
        input.endDate ?? existing.endDate,
        copenhagenToday(),
      );
      const halfDayStart = input.halfDayStart ?? existing.halfDayStart;
      const halfDayEnd = input.halfDayEnd ?? existing.halfDayEnd;

      // Get employee working days
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, ctx.session.user.id),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
      });

      // Get holidays
      // Fridagskalenderen (#526) — helligdage trækker ikke fra ferien
      const orgHolidays = await loadDaysOff(ctx.db, {
        orgId: ctx.orgId,
        userId: ctx.session.user.id,
        start: startDate,
        end: endDate,
      });
      const holidayDates = orgHolidays
        .filter((h) => !h.isHalfDay)
        .map((h) => h.date);

      const totalDays = countWorkingDays(
        startDate,
        endDate,
        profile?.workingDays ?? ["1", "2", "3", "4", "5"],
        holidayDates,
        halfDayStart ? "morning" : "full",
        halfDayEnd ? "afternoon" : "full",
        orgHolidays.filter((h) => h.isHalfDay).map((h) => h.date),
      );

      const { id, ...updateData } = input;
      const updated = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(absenceRequests)
          .set({
            ...updateData,
            totalDays: String(totalDays),
            updatedAt: new Date(),
          })
          .where(eq(absenceRequests.id, id))
          .returning();

        const AUDIT_FIELDS = [
          "absenceTypeId",
          "startDate",
          "endDate",
          "halfDayStart",
          "halfDayEnd",
          "note",
          "totalDays",
        ] as const;
        const pick = (r: typeof row) =>
          Object.fromEntries(AUDIT_FIELDS.map((k) => [k, r[k]]));
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "absence_request_updated",
          {
            targetUserId: existing.userId,
            metadata: {
              requestId: id,
              diff: auditDiff(pick(existing), pick(row)),
            },
          },
        );
        return row;
      });

      return updated;
    }),

  /**
   * listRequests — list absence requests.
   * Members see own; managers see direct reports + own; admins see all.
   */
  listRequests: organizationProcedure
    .input(
      z
        .object({
          year: z.number().optional(),
          status: z
            .enum(["pending", "approved", "rejected", "cancelled"])
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(absenceRequests.organizationId, ctx.orgId)];

      if (input?.year) {
        conditions.push(gte(absenceRequests.startDate, `${input.year}-01-01`));
        conditions.push(lte(absenceRequests.startDate, `${input.year}-12-31`));
      }

      if (input?.status) {
        conditions.push(eq(absenceRequests.status, input.status));
      }

      // Role-based visibility (#464): member = egne; manager = egne +
      // afdelinger som lead/deputy + direkte reports; hr/admin/owner = alle.
      let managedUserIds: ReadonlySet<string> = new Set<string>();
      if (ctx.orgRole === "member") {
        conditions.push(eq(absenceRequests.userId, ctx.session.user.id));
      } else {
        const scope = await getVisibleScope(ctx.db, ctx);
        const cond = userScopeCondition(scope, absenceRequests.userId);
        if (cond) conditions.push(cond);
        managedUserIds = scope.userIds;
      }

      const rows = await ctx.db.query.absenceRequests.findMany({
        where: and(...conditions),
        with: {
          absenceType: {
            columns: {
              id: true,
              name: true,
              color: true,
              category: true,
              visibleToColleagues: true,
            },
          },
          user: { columns: { id: true, name: true } },
          registrar: { columns: { id: true, name: true } },
        },
        orderBy: (r, { desc }) => [desc(r.startDate)],
      });

      // Synlighed (#460): typer med visibleToColleagues=false vises som
      // neutral "Fravær" for andre end ejeren, dennes ledere og admin.
      const viewer = {
        viewerUserId: ctx.session.user.id,
        // hr er privileged for LÆSNING (#464)
        isPrivileged: roleSeesWholeOrg(ctx.orgRole),
        managedUserIds,
      };
      return rows.map((r) => ({
        ...r,
        absenceType: maskAbsenceType(viewer, r.userId, r.absenceType),
      }));
    }),

  /**
   * approveRequest — manager+ only.
   * SECURITY: verifies request belongs to ctx.orgId.
   */
  approveRequest: orgManagerProcedure
    .input(
      z.object({
        id: z.string(),
        reviewNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => approveAbsenceRequest(ctx, input.id)),

  /**
   * rejectRequest — manager+ only.
   * SECURITY: verifies request belongs to ctx.orgId.
   */
  rejectRequest: orgManagerProcedure
    .input(
      z.object({
        id: z.string(),
        reviewNote: z.string().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      rejectAbsenceRequest(ctx, input.id, input.reviewNote),
    ),

  /**
   * approveMany — batch-godkend (#464). Manager+; hvert id valideres mod
   * org, status og kalderens scope og køres i egen transaktion, så én
   * fejl (fx allerede behandlet) ikke stopper resten.
   */
  approveMany: orgManagerProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) =>
      runBatch(input.ids, (id) => approveAbsenceRequest(ctx, id)),
    ),

  /** rejectMany — batch-afvis med fælles begrundelse (#464). */
  rejectMany: orgManagerProcedure
    .input(
      z.object({
        ids: z.array(z.string()).min(1).max(200),
        reason: z.string().max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) =>
      runBatch(input.ids, (id) => rejectAbsenceRequest(ctx, id, input.reason)),
    ),

  /**
   * cancelRequest — cancel the caller's own request.
   * SECURITY: verifies request.userId === caller AND request.organizationId === ctx.orgId.
   * Reverses vacation deduction if the request was already approved.
   */
  cancelRequest: organizationProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const request = await ctx.db.query.absenceRequests.findFirst({
        where: eq(absenceRequests.id, input.id),
        with: { absenceType: true },
      });

      // SECURITY: verify ownership — both user and org
      if (
        !request ||
        request.userId !== ctx.session.user.id ||
        request.organizationId !== ctx.orgId
      ) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.absence.requestNotFound",
          ),
        });
      }

      if (request.status === "cancelled") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.alreadyCancelled",
          ),
        });
      }
      if (request.source === "closure") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr(
            "serverErrors",
            "enterprise.absence.fixedHolidayNoCancel",
          ),
        });
      }

      // Tilbageførsel af saldo, ledger og statusændring i ÉN tx (#466)
      const updated = await ctx.db.transaction(async (tx) => {
        // Reverse vacation deduction if it was approved
        if (
          request.status === "approved" &&
          request.absenceType.deductsVacation &&
          request.deductedDays
        ) {
          const pool = toVacationPool(request.absenceType.vacationPool);
          const balance = await postVacationUsage(tx, {
            userId: request.userId,
            orgId: ctx.orgId,
            date: request.startDate,
            days: -Number(request.deductedDays),
            pool,
            refType: "absence_request",
            refId: request.id,
            note: "Annulleret",
            createdBy: ctx.session.user.id,
          });
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "vacation_balance_adjusted",
            {
              targetUserId: request.userId,
              metadata: {
                periodStart: balance.periodStart,
                pool,
                deltaDays: -Number(request.deductedDays),
                reason: "absence_cancelled",
                requestId: request.id,
              },
            },
          );
        }

        // Tilbagefør evt. afspadserings-postering på overtidssaldoen
        if (request.status === "approved") {
          await tx
            .delete(overtimeLedger)
            .where(
              and(
                eq(overtimeLedger.organizationId, ctx.orgId),
                eq(overtimeLedger.absenceRequestId, request.id),
              ),
            );
        }

        // Status-guard som approve/reject: hvis anmodningen er ændret siden
        // læsningen (dobbelt-annullering, eller godkendt imens), afvises hele
        // tx'en — ellers ville tilbageførslen ovenfor posteres to gange eller
        // saldoen forblive trukket for en annulleret anmodning.
        const [row] = await tx
          .update(absenceRequests)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(absenceRequests.id, input.id),
              eq(absenceRequests.status, request.status),
            ),
          )
          .returning();
        if (!row) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.absence.changedElsewhere",
            ),
          });
        }

        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "absence_request_cancelled",
          {
            targetUserId: request.userId,
            metadata: {
              requestId: request.id,
              absenceTypeId: request.absenceTypeId,
              startDate: request.startDate,
              endDate: request.endDate,
              previousStatus: request.status,
            },
          },
        );
        return row;
      });

      return updated;
    }),

  /**
   * getVacationBalance — feriesaldo pr. ferieår (egen, eller en medarbejder
   * man må håndtere fravær for). Saldoen er en projektion af ferie-ledgeren
   * (#461); `breakdown` giver optjent/overført/justeret/brugt pr. pulje.
   * Uses toLocalDateStr for date formatting — never .toISOString().split("T")[0].
   */
  getVacationBalance: organizationProcedure
    .input(z.object({ userId: z.string().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const userId = input?.userId ?? ctx.session.user.id;
      if (userId !== ctx.session.user.id) {
        await assertCanManageAbsenceOf(ctx, userId);
      }
      const settings = await getVacationOrgSettings(ctx.db, ctx.orgId);
      // Sørg for at indeværende ferieår altid har en række (#435)
      await ensureVacationPeriod(
        ctx.db,
        userId,
        ctx.orgId,
        copenhagenToday(),
        settings,
      );
      const [balances, overdraftDays] = await Promise.all([
        ctx.db.query.vacationBalances.findMany({
          where: and(
            eq(vacationBalances.userId, userId),
            eq(vacationBalances.organizationId, ctx.orgId),
          ),
          orderBy: (b, { desc }) => [desc(b.periodStart)],
        }),
        getVacationOverdraft(ctx.db, ctx.orgId),
      ]);

      return Promise.all(
        balances.map(async (b) => ({
          ...b,
          periodLabel: periodLabelFor(b.periodStart),
          accrualMode: settings.accrualMode,
          remaining: Number(b.remainingDays),
          extraRemaining: Number(b.extraRemainingDays),
          overdraftDays,
          breakdown: await loadLedgerProjection(
            ctx.db,
            userId,
            ctx.orgId,
            b.periodStart,
          ),
        })),
      );
    }),

  /**
   * listVacationLedger — feriebevægelser (ledger) for en medarbejder, nyeste
   * først. Egen bruger, eller en man må håndtere fravær for.
   */
  listVacationLedger: organizationProcedure
    .input(
      z
        .object({
          userId: z.string().optional(),
          periodStart: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
          limit: z.number().int().min(1).max(500).optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = input?.userId ?? ctx.session.user.id;
      if (userId !== ctx.session.user.id) {
        await assertCanManageAbsenceOf(ctx, userId);
      }
      const rows = await ctx.db.query.vacationLedger.findMany({
        where: and(
          eq(vacationLedger.userId, userId),
          eq(vacationLedger.organizationId, ctx.orgId),
          input?.periodStart
            ? eq(vacationLedger.vacationYearStart, input.periodStart)
            : undefined,
        ),
        orderBy: (l, { desc }) => [desc(l.effectiveDate), desc(l.createdAt)],
        limit: input?.limit ?? 200,
        with: { creator: { columns: { name: true } } },
      });
      return rows.map((r) => ({
        id: r.id,
        pool: toVacationPool(r.pool),
        entryType: r.entryType,
        days: Number(r.days),
        effectiveDate: r.effectiveDate,
        vacationYearStart: r.vacationYearStart,
        periodLabel: periodLabelFor(r.vacationYearStart),
        refType: r.refType,
        refId: r.refId,
        note: r.note,
        createdByName: r.creator?.name ?? null,
        createdAt: r.createdAt,
      }));
    }),

  /**
   * adjustVacationBalance — manuel justering af en medarbejders saldo
   * (admin/owner). Posteres som signeret 'adjustment' i ledgeren med note og
   * logges i hændelsesloggen (vacation_balance_adjusted, reason "manual").
   */
  adjustVacationBalance: orgAdminProcedure
    .input(
      z.object({
        userId: z.string().min(1),
        pool: z.enum(["vacation", "extra"]),
        days: z
          .number()
          .min(-100)
          .max(100)
          .refine((d) => Math.round(d * 100) !== 0, {
            error: () => st("zod.enterDays"),
          }),
        /** Dato justeringen gælder fra — afgør ferieåret */
        effectiveDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        note: z.string().trim().min(3).max(500),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const profile = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.userId, input.userId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
        columns: { id: true },
      });
      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.absence.employeeNotInOrg",
          ),
        });
      }
      const days = Math.round(input.days * 100) / 100;
      return ctx.db.transaction(async (tx) => {
        const locked = await lockVacationBalance(
          tx,
          input.userId,
          ctx.orgId,
          input.effectiveDate,
        );
        await postVacationLedger(tx, {
          userId: input.userId,
          orgId: ctx.orgId,
          pool: input.pool,
          entryType: "adjustment",
          days,
          effectiveDate: input.effectiveDate,
          vacationYearStart: locked.periodStart,
          refType: "manual",
          note: input.note,
          createdBy: ctx.session.user.id,
        });
        const after = await recomputeVacationBalance(
          tx,
          input.userId,
          ctx.orgId,
          locked.periodStart,
        );
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "vacation_balance_adjusted",
          {
            targetUserId: input.userId,
            metadata: {
              periodStart: locked.periodStart,
              pool: input.pool,
              deltaDays: days,
              reason: "manual",
              note: input.note,
              remainingAfter:
                input.pool === "extra"
                  ? after.extraRemainingDays
                  : after.remainingDays,
            },
          },
        );
        return after;
      });
    }),
});
