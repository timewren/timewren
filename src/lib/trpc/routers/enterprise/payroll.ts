import { TRPCError } from "@trpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as dbClient } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import {
  absenceTypes,
  activityTypes,
  employeeProfiles,
  organizations,
  payrollMappingRules,
  payrollWageTypes,
} from "@/lib/db/schema";
import {
  buildPayrollExport,
  PAYROLL_PERIOD_TYPES,
  PAYROLL_SYSTEMS,
  type PayrollPeriodType,
  type PayrollSystem,
  payrollExportToCsv,
  payrollExportToXlsx,
} from "@/lib/enterprise/payroll/export";
import {
  DAY_CONDITIONS,
  MAPPING_SOURCES,
  WAGE_TYPE_KINDS,
  WAGE_TYPE_UNITS,
} from "@/lib/enterprise/payroll/mapping";
import { resolvePayrollPeriod } from "@/lib/enterprise/payroll/period";
import { runPayrollMapping } from "@/lib/enterprise/payroll/run";
import { canRunReportType } from "@/lib/enterprise/reporting/access";
import { reportFiltersSchema } from "@/lib/enterprise/reporting/config";
import { ReportPeriodError } from "@/lib/enterprise/reporting/run";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { auditDiff, logOrgAudit, pickAuditFields } from "@/lib/org-audit";
import { copenhagenToday } from "@/lib/time/copenhagen";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { router } from "../../trpc";
import { orgAdminProcedure, orgManagerReadProcedure } from "./middleware";

/**
 * Lønmapping (E5, #463): lønarter, mapping-regler, medarbejdernumre og
 * lønperiode-eksport. Læsning = HR/admin/owner (samme gate som
 * lønrapporten), skrivning = admin/owner. Alt scoped på ctx.orgId.
 */

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const codeString = z.string().trim().min(1).max(50);
const optionalCode = z.string().trim().max(50).nullable();

const WAGE_TYPE_AUDIT_FIELDS = [
  "code",
  "name",
  "unit",
  "kind",
  "isArchived",
] as const;
const RULE_AUDIT_FIELDS = [
  "wageTypeId",
  "source",
  "activityTypeId",
  "absenceTypeId",
  "dayCondition",
  "priority",
  "isArchived",
] as const;

function assertPayrollReader(role: string | null | undefined) {
  if (!canRunReportType(role, "payroll")) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: st("enterprise.payroll.hrOnly"),
    });
  }
}

function periodErrorToTrpc(err: unknown): never {
  if (err instanceof ReportPeriodError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

async function assertOrgWageType(
  db: typeof dbClient,
  orgId: string,
  id: string,
) {
  const row = await db.query.payrollWageTypes.findFirst({
    where: and(
      eq(payrollWageTypes.id, id),
      eq(payrollWageTypes.organizationId, orgId),
    ),
  });
  if (!row) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.payroll.wageTypeNotInOrg"),
    });
  }
  return row;
}

async function assertRuleTargets(
  db: typeof dbClient,
  orgId: string,
  input: {
    wageTypeId: string;
    activityTypeId?: string | null;
    absenceTypeId?: string | null;
  },
) {
  await assertOrgWageType(db, orgId, input.wageTypeId);
  if (input.activityTypeId) {
    const a = await db.query.activityTypes.findFirst({
      where: and(
        eq(activityTypes.id, input.activityTypeId),
        eq(activityTypes.organizationId, orgId),
      ),
      columns: { id: true },
    });
    if (!a) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.activityTypeNotInOrg"),
      });
    }
  }
  if (input.absenceTypeId) {
    const t = await db.query.absenceTypes.findFirst({
      where: and(
        eq(absenceTypes.id, input.absenceTypeId),
        eq(absenceTypes.organizationId, orgId),
      ),
      columns: { id: true },
    });
    if (!t) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.absenceTypeNotInOrg"),
      });
    }
  }
}

const periodInput = z.object({
  from: dateString,
  to: dateString,
  departmentIds: z.array(z.string().uuid()).max(100).default([]),
  includeInactive: z.boolean().default(false),
  onlyApproved: z.boolean().default(false),
});

function filtersFrom(input: z.infer<typeof periodInput>) {
  return reportFiltersSchema.parse({
    departmentIds: input.departmentIds,
    includeInactive: input.includeInactive,
    onlyApproved: input.onlyApproved,
  });
}

export const enterprisePayrollRouter = router({
  /** Alt til Indstillinger → Løn i ét kald. */
  getPayrollSettings: orgManagerReadProcedure.query(async ({ ctx }) => {
    assertPayrollReader(ctx.orgRole);
    const [org, wageTypes, rules, activityRows, absenceRows, profiles] =
      await Promise.all([
        ctx.db.query.organizations.findFirst({
          where: eq(organizations.id, ctx.orgId),
          columns: {
            payrollSystem: true,
            payrollPeriodType: true,
            payrollPeriodStartDay: true,
          },
        }),
        ctx.db.query.payrollWageTypes.findMany({
          where: eq(payrollWageTypes.organizationId, ctx.orgId),
          orderBy: [
            asc(payrollWageTypes.sortOrder),
            asc(payrollWageTypes.code),
          ],
        }),
        ctx.db.query.payrollMappingRules.findMany({
          where: eq(payrollMappingRules.organizationId, ctx.orgId),
          orderBy: [
            asc(payrollMappingRules.priority),
            asc(payrollMappingRules.createdAt),
          ],
        }),
        ctx.db.query.activityTypes.findMany({
          where: eq(activityTypes.organizationId, ctx.orgId),
          columns: {
            id: true,
            name: true,
            payrollCode: true,
            isArchived: true,
          },
          orderBy: [asc(activityTypes.sortOrder), asc(activityTypes.name)],
        }),
        ctx.db.query.absenceTypes.findMany({
          where: eq(absenceTypes.organizationId, ctx.orgId),
          columns: {
            id: true,
            name: true,
            category: true,
            payrollCode: true,
            isArchived: true,
          },
          orderBy: [asc(absenceTypes.name)],
        }),
        ctx.db.query.employeeProfiles.findMany({
          where: eq(employeeProfiles.organizationId, ctx.orgId),
          columns: {
            id: true,
            userId: true,
            employeeNumber: true,
            externalPayrollId: true,
            isActive: true,
          },
          with: {
            user: { columns: { name: true, email: true } },
            department: { columns: { name: true } },
          },
        }),
      ]);
    if (!org) throw new TRPCError({ code: "NOT_FOUND" });
    const settings = {
      payrollSystem: org.payrollSystem as PayrollSystem,
      payrollPeriodType: org.payrollPeriodType as PayrollPeriodType,
      payrollPeriodStartDay: org.payrollPeriodStartDay,
    };
    const today = copenhagenToday();
    return {
      settings,
      currentPeriod: resolvePayrollPeriod(settings, today, 0),
      previousPeriod: resolvePayrollPeriod(settings, today, -1),
      wageTypes,
      rules,
      activityTypes: activityRows,
      absenceTypes: absenceRows,
      employees: profiles
        .map((p) => ({
          profileId: p.id,
          userId: p.userId,
          name: p.user?.name ?? "Ukendt",
          email: p.user?.email ?? "",
          department: p.department?.name ?? "",
          employeeNumber: p.employeeNumber ?? "",
          externalPayrollId: p.externalPayrollId ?? "",
          isActive: p.isActive,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "da")),
    };
  }),

  updatePayrollSettings: orgAdminProcedure
    .input(
      z.object({
        payrollSystem: z.enum(PAYROLL_SYSTEMS),
        payrollPeriodType: z.enum(PAYROLL_PERIOD_TYPES),
        payrollPeriodStartDay: z.number().int().min(1).max(28),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.query.organizations.findFirst({
        where: eq(organizations.id, ctx.orgId),
        columns: {
          payrollSystem: true,
          payrollPeriodType: true,
          payrollPeriodStartDay: true,
        },
      });
      return ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(organizations)
          .set(input)
          .where(eq(organizations.id, ctx.orgId))
          .returning({
            payrollSystem: organizations.payrollSystem,
            payrollPeriodType: organizations.payrollPeriodType,
            payrollPeriodStartDay: organizations.payrollPeriodStartDay,
          });
        const diff = auditDiff(before ?? {}, updated);
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "payroll_settings_updated",
            { metadata: { diff } },
          );
        }
        return updated;
      });
    }),

  createWageType: orgAdminProcedure
    .input(
      z.object({
        code: codeString,
        name: z.string().trim().min(1).max(255),
        unit: z.enum(WAGE_TYPE_UNITS).default("hours"),
        kind: z.enum(WAGE_TYPE_KINDS).default("time"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.payrollWageTypes.findMany({
        where: eq(payrollWageTypes.organizationId, ctx.orgId),
        columns: { sortOrder: true },
      });
      const sortOrder =
        existing.length > 0
          ? Math.max(...existing.map((t) => t.sortOrder)) + 1
          : 0;
      try {
        return await ctx.db.transaction(async (tx) => {
          const [created] = await tx
            .insert(payrollWageTypes)
            .values({ organizationId: ctx.orgId, ...input, sortOrder })
            .returning();
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "wage_type_created",
            {
              metadata: {
                wageTypeId: created.id,
                ...pickAuditFields(created, WAGE_TYPE_AUDIT_FIELDS),
              },
            },
          );
          return created;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.payroll.wageTypeCodeExists",
            ),
          });
        }
        throw err;
      }
    }),

  /** Arkivér frem for slet: isArchived = true skjuler lønarten og dens regler. */
  updateWageType: orgAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        code: codeString.optional(),
        name: z.string().trim().min(1).max(255).optional(),
        unit: z.enum(WAGE_TYPE_UNITS).optional(),
        kind: z.enum(WAGE_TYPE_KINDS).optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await assertOrgWageType(ctx.db, ctx.orgId, input.id);
      const { id, ...patch } = input;
      try {
        return await ctx.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(payrollWageTypes)
            .set({ ...patch, updatedAt: new Date() })
            .where(
              and(
                eq(payrollWageTypes.id, id),
                eq(payrollWageTypes.organizationId, ctx.orgId),
              ),
            )
            .returning();
          const diff = auditDiff(
            pickAuditFields(before, WAGE_TYPE_AUDIT_FIELDS),
            pickAuditFields(updated, WAGE_TYPE_AUDIT_FIELDS),
          );
          if (Object.keys(diff).length > 0) {
            await logOrgAudit(
              tx,
              ctx.orgId,
              ctx.session.user.id,
              "wage_type_updated",
              { metadata: { wageTypeId: id, code: updated.code, diff } },
            );
          }
          return updated;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.payroll.wageTypeCodeExists",
            ),
          });
        }
        throw err;
      }
    }),

  createMappingRule: orgAdminProcedure
    .input(
      z.object({
        wageTypeId: z.string().uuid(),
        source: z.enum(MAPPING_SOURCES),
        activityTypeId: z.string().uuid().nullable().default(null),
        absenceTypeId: z.string().uuid().nullable().default(null),
        dayCondition: z.enum(DAY_CONDITIONS).default("any"),
        priority: z.number().int().min(0).max(9999).default(100),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      // Type-filtre giver kun mening for deres kilde
      const activityTypeId =
        input.source === "activity" ? input.activityTypeId : null;
      const absenceTypeId =
        input.source === "absence" ? input.absenceTypeId : null;
      await assertRuleTargets(ctx.db, ctx.orgId, {
        wageTypeId: input.wageTypeId,
        activityTypeId,
        absenceTypeId,
      });
      return ctx.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(payrollMappingRules)
          .values({
            organizationId: ctx.orgId,
            wageTypeId: input.wageTypeId,
            source: input.source,
            activityTypeId,
            absenceTypeId,
            dayCondition: input.dayCondition,
            priority: input.priority,
          })
          .returning();
        await logOrgAudit(
          tx,
          ctx.orgId,
          ctx.session.user.id,
          "payroll_rule_created",
          {
            metadata: {
              ruleId: created.id,
              ...pickAuditFields(created, RULE_AUDIT_FIELDS),
            },
          },
        );
        return created;
      });
    }),

  updateMappingRule: orgAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        wageTypeId: z.string().uuid().optional(),
        dayCondition: z.enum(DAY_CONDITIONS).optional(),
        priority: z.number().int().min(0).max(9999).optional(),
        isArchived: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.query.payrollMappingRules.findFirst({
        where: and(
          eq(payrollMappingRules.id, input.id),
          eq(payrollMappingRules.organizationId, ctx.orgId),
        ),
      });
      if (!before) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.payroll.ruleNotInOrg"),
        });
      }
      if (input.wageTypeId) {
        await assertOrgWageType(ctx.db, ctx.orgId, input.wageTypeId);
      }
      const { id, ...patch } = input;
      return ctx.db.transaction(async (tx) => {
        const [updated] = await tx
          .update(payrollMappingRules)
          .set(patch)
          .where(eq(payrollMappingRules.id, id))
          .returning();
        const diff = auditDiff(
          pickAuditFields(before, RULE_AUDIT_FIELDS),
          pickAuditFields(updated, RULE_AUDIT_FIELDS),
        );
        if (Object.keys(diff).length > 0) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "payroll_rule_updated",
            { metadata: { ruleId: id, diff } },
          );
        }
        return updated;
      });
    }),

  /** Fallback-lønart pr. fraværstype (aktivitetstyper har updateActivityType). */
  setAbsenceTypePayrollCode: orgAdminProcedure
    .input(z.object({ id: z.string().uuid(), payrollCode: optionalCode }))
    .mutation(async ({ ctx, input }) => {
      const [updated] = await ctx.db
        .update(absenceTypes)
        .set({ payrollCode: input.payrollCode || null })
        .where(
          and(
            eq(absenceTypes.id, input.id),
            eq(absenceTypes.organizationId, ctx.orgId),
          ),
        )
        .returning({
          id: absenceTypes.id,
          payrollCode: absenceTypes.payrollCode,
        });
      if (!updated) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.absenceTypeNotInOrg"),
        });
      }
      return updated;
    }),

  /** Medarbejdernummer (unik pr. org) + eksternt lønsystem-id. */
  setEmployeePayrollIds: orgAdminProcedure
    .input(
      z.object({
        profileId: z.string().uuid(),
        employeeNumber: optionalCode,
        externalPayrollId: z.string().trim().max(100).nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await ctx.db.query.employeeProfiles.findFirst({
        where: and(
          eq(employeeProfiles.id, input.profileId),
          eq(employeeProfiles.organizationId, ctx.orgId),
        ),
        columns: {
          id: true,
          userId: true,
          employeeNumber: true,
          externalPayrollId: true,
        },
      });
      if (!before) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr(
            "serverErrors",
            "enterprise.employeeProfileNotFound",
          ),
        });
      }
      try {
        return await ctx.db.transaction(async (tx) => {
          const [updated] = await tx
            .update(employeeProfiles)
            .set({
              employeeNumber: input.employeeNumber || null,
              ...(input.externalPayrollId !== undefined
                ? { externalPayrollId: input.externalPayrollId || null }
                : {}),
              updatedAt: new Date(),
            })
            .where(eq(employeeProfiles.id, before.id))
            .returning({
              id: employeeProfiles.id,
              employeeNumber: employeeProfiles.employeeNumber,
              externalPayrollId: employeeProfiles.externalPayrollId,
            });
          const diff = auditDiff(
            {
              employeeNumber: before.employeeNumber,
              externalPayrollId: before.externalPayrollId,
            },
            {
              employeeNumber: updated.employeeNumber,
              externalPayrollId: updated.externalPayrollId,
            },
          );
          if (Object.keys(diff).length > 0) {
            await logOrgAudit(
              tx,
              ctx.orgId,
              ctx.session.user.id,
              "employee_payroll_ids_updated",
              {
                targetUserId: before.userId,
                metadata: { profileId: before.id, diff },
              },
            );
          }
          return updated;
        });
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new TRPCError({
            code: "CONFLICT",
            message: await tr(
              "serverErrors",
              "enterprise.payroll.employeeNumberTaken",
            ),
          });
        }
        throw err;
      }
    }),

  /** Lønart-fordeling pr. medarbejder for perioden (til UI). */
  previewPayrollExport: orgManagerReadProcedure
    .input(periodInput)
    .query(async ({ ctx, input }) => {
      assertPayrollReader(ctx.orgRole);
      const scope = await getVisibleScope(ctx.db, ctx);
      return runPayrollMapping(ctx.db, {
        orgId: ctx.orgId,
        scope,
        from: input.from,
        to: input.to,
        filters: filtersFrom(input),
      }).catch(periodErrorToTrpc);
    }),

  /** Flad fil pr. medarbejder × lønart i org'ens lønsystem-format. */
  exportPayrollLines: orgManagerReadProcedure
    .input(periodInput.extend({ format: z.enum(["csv", "xlsx"]) }))
    .mutation(async ({ ctx, input }) => {
      assertPayrollReader(ctx.orgRole);
      const limit = await rateLimiter.check(
        userRateLimitKey(ctx.session.user.id, "reportExport"),
        "reportExport",
      );
      if (!limit.allowed) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: await tr("serverErrors", "enterprise.exportRateLimited", {
            seconds: Math.ceil(limit.resetIn / 1000),
          }),
        });
      }
      const [scope, org] = await Promise.all([
        getVisibleScope(ctx.db, ctx),
        ctx.db.query.organizations.findFirst({
          where: eq(organizations.id, ctx.orgId),
          columns: { name: true, payrollSystem: true },
        }),
      ]);
      const run = await runPayrollMapping(ctx.db, {
        orgId: ctx.orgId,
        scope,
        from: input.from,
        to: input.to,
        filters: filtersFrom(input),
      }).catch(periodErrorToTrpc);
      const system = (org?.payrollSystem ?? "generic") as PayrollSystem;
      const table = buildPayrollExport(run.totals, {
        system,
        from: input.from,
        to: input.to,
      });
      await logOrgAudit(
        ctx.db,
        ctx.orgId,
        ctx.session.user.id,
        "payroll_exported",
        {
          metadata: {
            from: input.from,
            to: input.to,
            format: input.format,
            system,
            lines: run.totals.length,
            employees: new Set(run.totals.map((t) => t.userId)).size,
          },
        },
      );
      const filename = `loen-${system}-${input.from}-${input.to}`;
      if (input.format === "csv") {
        return {
          format: "csv" as const,
          filename: `${filename}.csv`,
          data: payrollExportToCsv(table),
          lines: run.totals.length,
          missingEmployeeNumbers: run.missingEmployeeNumbers,
        };
      }
      const buf = await payrollExportToXlsx(table, {
        title: await tr("serverErrors", "enterprise.payroll.exportTitle", {
          org: org?.name ?? "",
        }),
        period: `${input.from} – ${input.to}`,
      });
      return {
        format: "xlsx" as const,
        filename: `${filename}.xlsx`,
        data: Buffer.from(buf).toString("base64"),
        lines: run.totals.length,
        missingEmployeeNumbers: run.missingEmployeeNumbers,
      };
    }),
});
