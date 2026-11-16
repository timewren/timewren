import { TRPCError } from "@trpc/server";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { toBrandKey } from "@/lib/auth/host-auth";
import { DEFAULT_BRAND_KEY, isMultibrandEnabled } from "@/lib/brands/registry";
import {
  departments,
  employeeProfiles,
  members,
  organizations,
  timesheetWeeks,
  users,
} from "@/lib/db/schema";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { BREAK_POLICIES, type BreakPolicy } from "@/lib/enterprise/timesheet";
import { auditDiff, logOrgAudit, pickAuditFields } from "@/lib/org-audit";
import { roleSatisfies } from "@/lib/permissions/org-role";
import { protectedProcedure, router } from "../../trpc";
import { orgAdminProcedure, organizationProcedure } from "./middleware";

export const enterpriseOrganizationRouter = router({
  /**
   * create — create a new organization.
   * Uses protectedProcedure (no org context yet). The creator becomes owner.
   */
  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        slug: z
          .string()
          .min(1)
          .max(255)
          .regex(/^[a-z0-9-]+$/),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Multibrand: organisationen får ejerens brand i samme insert. Kun
      // ikke-standardbrands skrives; timetrack bruger kolonnens default.
      const owner = isMultibrandEnabled()
        ? await ctx.db.query.users.findFirst({
            where: eq(users.id, ctx.session.user.id),
            columns: { brand: true },
          })
        : undefined;
      const brand = toBrandKey(owner?.brand);

      // Create organization
      const orgId = crypto.randomUUID();
      const [org] = await ctx.db
        .insert(organizations)
        .values({
          id: orgId,
          name: input.name,
          slug: input.slug,
          ...(brand !== DEFAULT_BRAND_KEY && { brand }),
        })
        .returning();

      // Create membership as owner
      const memberId = crypto.randomUUID();
      await ctx.db.insert(members).values({
        id: memberId,
        organizationId: orgId,
        userId: ctx.session.user.id,
        role: "owner",
      });

      // Create employee profile for the creator
      await ctx.db.insert(employeeProfiles).values({
        userId: ctx.session.user.id,
        organizationId: orgId,
        role: "admin",
        employmentType: "full_time",
        weeklyHours: "37.0",
        workingDays: ["1", "2", "3", "4", "5"],
      });

      return org;
    }),

  /**
   * get — get organization details. Any org member can read.
   */
  get: organizationProcedure.query(async ({ ctx }) => {
    const org = await ctx.db.query.organizations.findFirst({
      where: eq(organizations.id, ctx.orgId),
    });

    if (!org) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.organizationNotFound"),
      });
    }

    return org;
  }),

  /**
   * update — update organization name. Admin/owner only.
   */
  update: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
        // null = overtid slået fra (alt over norm er flex)
        overtimeThresholdHours: z.number().min(1).max(80).nullable().optional(),
        // Tilladt overtræk af feriesaldoen i dage (#437)
        vacationOverdraftDays: z.number().min(0).max(30).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const FIELDS = [
        "name",
        "overtimeThresholdHours",
        "vacationOverdraftDays",
      ] as const;
      const before = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          name: true,
          overtimeThresholdHours: true,
          vacationOverdraftDays: true,
        },
      });
      const updated = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(organizations)
          .set({
            name: input.name,
            ...(input.overtimeThresholdHours !== undefined
              ? {
                  overtimeThresholdHours:
                    input.overtimeThresholdHours === null
                      ? null
                      : input.overtimeThresholdHours.toFixed(1),
                }
              : {}),
            ...(input.vacationOverdraftDays !== undefined
              ? {
                  vacationOverdraftDays: input.vacationOverdraftDays.toFixed(1),
                }
              : {}),
          })
          .where(eq(organizations.id, ctx.orgId))
          .returning();
        const diff = auditDiff(
          pickAuditFields(before, FIELDS),
          pickAuditFields(row, FIELDS),
        );
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(tx, ctx.orgId, ctx.session.user.id, "org_updated", {
            metadata: { field: Object.keys(diff).join(", "), diff },
          });
        }
        return row;
      });

      return updated;
    }),

  /**
   * updateWorkSettings — arbejdstid og pauser (#449). Admin/owner only.
   * Ugetimer-default, valgfri fuldtids-dagsnorm (null = ugetimer/arbejdsdage),
   * pause i minutter + politik. Ændringer slår igennem i normtid/flex ved
   * næste beregning — historiske flex-rækker genberegnes med
   * scripts/set-org-work-settings.ts --recalc-from.
   */
  updateWorkSettings: orgAdminProcedure
    .input(
      z.object({
        defaultWeeklyHours: z.number().min(1).max(80),
        dailyNormHours: z.number().min(0.5).max(24).nullable(),
        breakMinutesPerDay: z.number().int().min(0).max(240),
        breakPolicy: z.enum(BREAK_POLICIES as [BreakPolicy, ...BreakPolicy[]]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const FIELDS = [
        "defaultWeeklyHours",
        "dailyNormHours",
        "breakMinutesPerDay",
        "breakPolicy",
      ] as const;
      const before = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          defaultWeeklyHours: true,
          dailyNormHours: true,
          breakMinutesPerDay: true,
          breakPolicy: true,
        },
      });
      const updated = await ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(organizations)
          .set({
            defaultWeeklyHours: input.defaultWeeklyHours.toFixed(1),
            dailyNormHours:
              input.dailyNormHours === null
                ? null
                : input.dailyNormHours.toFixed(1),
            breakMinutesPerDay: input.breakMinutesPerDay,
            breakPolicy: input.breakPolicy,
          })
          .where(eq(organizations.id, ctx.orgId))
          .returning({
            defaultWeeklyHours: organizations.defaultWeeklyHours,
            dailyNormHours: organizations.dailyNormHours,
            breakMinutesPerDay: organizations.breakMinutesPerDay,
            breakPolicy: organizations.breakPolicy,
          });
        const diff = auditDiff(
          pickAuditFields(before, FIELDS),
          pickAuditFields(row, FIELDS),
        );
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "work_settings_updated",
            { metadata: { diff } },
          );
        }
        return row;
      });
      return updated;
    }),

  /**
   * updateTimesheetRules — timeseddel-hærdning (#467): maks. timer pr. dag,
   * advarsel over norm, blokering af tomme arbejdsdage og rullende lås.
   * Admin/owner only.
   */
  updateTimesheetRules: orgAdminProcedure
    .input(
      z.object({
        maxHoursPerDay: z.number().min(1).max(24),
        warnOverNorm: z.boolean(),
        blockEmptyWorkdays: z.boolean(),
        // null = ingen rullende lås; 0 = kun indeværende uge er åben
        lockAfterWeeks: z.number().int().min(0).max(104).nullable(),
        // Auto-lås (#518): ISO-ugedag hvor forrige uge låses; null = fra.
        // Udeladt = uændret (ældre klienter)
        autoLockWeekday: z.number().int().min(1).max(7).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(organizations)
        .set({
          timesheetMaxHoursPerDay: input.maxHoursPerDay.toFixed(1),
          timesheetWarnOverNorm: input.warnOverNorm,
          timesheetBlockEmptyWorkdays: input.blockEmptyWorkdays,
          timesheetLockAfterWeeks: input.lockAfterWeeks,
          ...(input.autoLockWeekday !== undefined
            ? { timesheetAutoLockWeekday: input.autoLockWeekday }
            : {}),
        })
        .where(eq(organizations.id, ctx.orgId))
        .returning({
          timesheetMaxHoursPerDay: organizations.timesheetMaxHoursPerDay,
          timesheetWarnOverNorm: organizations.timesheetWarnOverNorm,
          timesheetBlockEmptyWorkdays:
            organizations.timesheetBlockEmptyWorkdays,
          timesheetLockAfterWeeks: organizations.timesheetLockAfterWeeks,
          timesheetAutoLockWeekday: organizations.timesheetAutoLockWeekday,
        });
      return updated;
    }),

  /**
   * updateVacationSettings — ferieår og optjening (#461). Admin/owner only.
   * Startmåned (1 = kalenderår, 9 = ferieloven), optjeningsmodel, overførsels-
   * loft og udbetal-rest-flag. Eksisterende saldo-perioder røres ikke —
   * skift startmåned kun ved et ferieårs start.
   */
  updateVacationSettings: orgAdminProcedure
    .input(
      z.object({
        vacationYearStartMonth: z.number().int().min(1).max(12),
        vacationAccrualMode: z.enum(["upfront", "monthly"]),
        vacationCarryOverMaxDays: z.number().min(0).max(25),
        vacationPayOutRemaining: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const FIELDS = [
        "vacationYearStartMonth",
        "vacationAccrualMode",
        "vacationCarryOverMaxDays",
        "vacationPayOutRemaining",
      ] as const;
      const before = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          vacationYearStartMonth: true,
          vacationAccrualMode: true,
          vacationCarryOverMaxDays: true,
          vacationPayOutRemaining: true,
        },
      });
      // Skift af model eller ferieår-start afgrænser catch-up af måneds-
      // optjening til efter skiftet (#532). Saldo-flyt (opening) sker med
      // scripts/set-org-vacation-settings.ts — se docs/solutions.
      const modelChanged =
        !!before &&
        (before.vacationAccrualMode !== input.vacationAccrualMode ||
          before.vacationYearStartMonth !== input.vacationYearStartMonth);
      return ctx.db.transaction(async (tx) => {
        const [row] = await tx
          .update(organizations)
          .set({
            vacationYearStartMonth: input.vacationYearStartMonth,
            vacationAccrualMode: input.vacationAccrualMode,
            vacationCarryOverMaxDays: input.vacationCarryOverMaxDays.toFixed(1),
            vacationPayOutRemaining: input.vacationPayOutRemaining,
            ...(modelChanged ? { vacationSettingsChangedAt: new Date() } : {}),
          })
          .where(eq(organizations.id, ctx.orgId))
          .returning({
            vacationYearStartMonth: organizations.vacationYearStartMonth,
            vacationAccrualMode: organizations.vacationAccrualMode,
            vacationCarryOverMaxDays: organizations.vacationCarryOverMaxDays,
            vacationPayOutRemaining: organizations.vacationPayOutRemaining,
          });
        const diff = auditDiff(
          pickAuditFields(before, FIELDS),
          pickAuditFields(row, FIELDS),
        );
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(tx, ctx.orgId, ctx.session.user.id, "org_updated", {
            metadata: { field: Object.keys(diff).join(", "), diff },
          });
        }
        return row;
      });
    }),

  /**
   * listMembers — list all employee profiles in the org.
   *
   * Med `weekStart` (mandag, YYYY-MM-DD) får hver række desuden ugens
   * timeseddel-status (`weekStatus`: draft = ingen række i timesheet_weeks)
   * — kun for manager+, så menige medarbejdere ikke ser kollegers status.
   */
  listMembers: organizationProcedure
    .input(
      z
        .object({
          weekStart: z
            .string()
            .regex(/^\d{4}-\d{2}-\d{2}$/)
            .optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const profiles = await ctx.db.query.employeeProfiles.findMany({
        where: eq(employeeProfiles.organizationId, ctx.orgId),
        with: {
          user: { columns: { id: true, name: true, email: true, image: true } },
          department: { columns: { id: true, name: true } },
        },
      });

      const weekStart = input?.weekStart;
      // manager+ (inkl. hr) ser ugestatus og ansættelsesfelter — men kun for
      // profiler i eget scope (#464): manager = egne afdelinger + reports;
      // hr/admin/owner = alle.
      const canSeeWeekStatus = roleSatisfies(ctx.orgRole, "manager");
      const scope = canSeeWeekStatus
        ? await getVisibleScope(ctx.db, ctx)
        : null;
      const inScope = (profileId: string) =>
        !!scope && (scope.all || scope.profileIds.has(profileId));
      const scopedUserIds = profiles
        .filter((p) => inScope(p.id))
        .map((p) => p.userId);
      const withWeek =
        !!weekStart && canSeeWeekStatus && scopedUserIds.length > 0;

      const weekRows = withWeek
        ? await ctx.db.query.timesheetWeeks.findMany({
            where: and(
              eq(timesheetWeeks.organizationId, ctx.orgId),
              eq(timesheetWeeks.weekStart, weekStart),
              inArray(timesheetWeeks.userId, scopedUserIds),
            ),
            columns: { userId: true, status: true, submittedAt: true },
          })
        : [];
      const weekByUser = new Map(weekRows.map((w) => [w.userId, w]));

      // Ansættelsesfelter (timetal, ansættelsestype, datoer, leder, ferie-
      // ret, normtid/pause) er kun for manager+ inden for scope — menige ser
      // kolleger som navn/rolle/afdeling/aktiv (#452). Felterne returneres
      // som null, så klient-typen er stabil.

      return profiles.map((p) => {
        const week = weekByUser.get(p.userId);
        const visible = inScope(p.id);
        const employment = visible
          ? {
              employmentType: p.employmentType,
              weeklyHours: p.weeklyHours,
              conversionFactor: p.conversionFactor,
              managerId: p.managerId,
              workingDays: p.workingDays,
              startDate: p.startDate,
              endDate: p.endDate,
              vacationDaysPerYear: p.vacationDaysPerYear,
              extraVacationDaysPerYear: p.extraVacationDaysPerYear,
              dailyNormHours: p.dailyNormHours,
              breakMinutes: p.breakMinutes,
            }
          : {
              employmentType: null,
              weeklyHours: null,
              conversionFactor: null,
              managerId: null,
              workingDays: null,
              startDate: null,
              endDate: null,
              vacationDaysPerYear: null,
              extraVacationDaysPerYear: null,
              dailyNormHours: null,
              breakMinutes: null,
            };
        return {
          id: p.id,
          organizationId: p.organizationId,
          userId: p.userId,
          departmentId: p.departmentId,
          role: p.role,
          isActive: p.isActive,
          isSelfScheduler: p.isSelfScheduler,
          createdAt: p.createdAt,
          updatedAt: p.updatedAt,
          user: p.user,
          department: p.department,
          ...employment,
          // null = ikke forespurgt eller ingen ret til at se det
          weekStatus:
            withWeek && visible
              ? ((week?.status ?? "draft") as
                  | "draft"
                  | "submitted"
                  | "approved"
                  | "rejected"
                  | "reopened")
              : null,
          submittedAt: week?.submittedAt ?? null,
        };
      });
    }),

  /**
   * listAddableMembers — org members who do NOT yet have an employee profile.
   * Feeds the "add employee" dropdown; without it the dropdown listed existing
   * profiles, so createProfile always conflicted and no new employee could be
   * added.
   */
  listAddableMembers: orgAdminProcedure.query(async ({ ctx }) => {
    const profiled = await ctx.db.query.employeeProfiles.findMany({
      where: eq(employeeProfiles.organizationId, ctx.orgId),
      columns: { userId: true },
    });
    const profiledUserIds = profiled.map((p) => p.userId);

    const rows = await ctx.db
      .select({
        userId: members.userId,
        name: users.name,
        email: users.email,
      })
      .from(members)
      .innerJoin(users, eq(members.userId, users.id))
      .where(
        and(
          eq(members.organizationId, ctx.orgId),
          profiledUserIds.length > 0
            ? notInArray(members.userId, profiledUserIds)
            : undefined,
        ),
      )
      .orderBy(users.name);
    return rows;
  }),

  /**
   * listDepartments — list the org's (non-archived) departments with a head
   * count per department. Any org member may read. The departments admin page
   * and the employee-profile form both depend on this.
   */
  listDepartments: organizationProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: departments.id,
        name: departments.name,
        memberCount: sql<number>`count(${employeeProfiles.id})::int`,
      })
      .from(departments)
      .leftJoin(
        employeeProfiles,
        and(
          eq(employeeProfiles.departmentId, departments.id),
          eq(employeeProfiles.isActive, true),
        ),
      )
      .where(
        and(
          eq(departments.organizationId, ctx.orgId),
          eq(departments.isArchived, false),
        ),
      )
      .groupBy(departments.id, departments.name)
      .orderBy(departments.name);
    return rows;
  }),

  /**
   * createDepartment — admin/owner only. Uses ctx.orgId for insertion.
   */
  createDepartment: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(255),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [dept] = await ctx.db
        .insert(departments)
        .values({
          organizationId: ctx.orgId,
          name: input.name,
        })
        .returning();

      return dept;
    }),

  /**
   * updateDepartment — admin/owner only.
   * SECURITY: verifies dept.organizationId === ctx.orgId before mutating.
   */
  updateDepartment: orgAdminProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1).max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const dept = await ctx.db.query.departments.findFirst({
        where: eq(departments.id, input.id),
      });
      if (!dept || dept.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.departmentNotFound"),
        });
      }

      const { id, ...data } = input;
      const [updated] = await ctx.db
        .update(departments)
        .set(data)
        .where(eq(departments.id, id))
        .returning();

      return updated;
    }),

  /**
   * deleteDepartment — admin/owner only.
   * SECURITY: verifies dept.organizationId === ctx.orgId before deleting.
   * Blocks deletion if employees are assigned.
   */
  deleteDepartment: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      // SECURITY: verify org ownership
      const dept = await ctx.db.query.departments.findFirst({
        where: eq(departments.id, input.id),
        with: { employeeProfiles: { columns: { id: true } } },
      });

      if (!dept || dept.organizationId !== ctx.orgId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.departmentNotFound"),
        });
      }

      if (dept.employeeProfiles && dept.employeeProfiles.length > 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.org.deptHasEmployees"),
        });
      }

      await ctx.db
        .update(departments)
        .set({ isArchived: true })
        .where(eq(departments.id, input.id));
      return { success: true };
    }),
});
