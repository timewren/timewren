import { TRPCError } from "@trpc/server";
import { and, asc, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import {
  absenceTypes,
  activityTypes,
  departments,
  employeeProfiles,
  projects,
  reportSchedules,
  reportTemplates,
} from "@/lib/db/schema";
import {
  canRunReportType,
  canShareTemplates,
} from "@/lib/enterprise/reporting/access";
import {
  defaultConfigFor,
  ENTERPRISE_REPORT_TYPES,
  enterpriseReportConfigSchema,
  isEnterpriseReportType,
  REPORT_TYPE_DEFINITIONS,
} from "@/lib/enterprise/reporting/config";
import {
  reportTableToCsv,
  reportTableToXlsx,
} from "@/lib/enterprise/reporting/render";
import {
  ReportPeriodError,
  runEnterpriseReport,
} from "@/lib/enterprise/reporting/run";
import { getVisibleScope } from "@/lib/enterprise/scope";
import { rateLimiter, userRateLimitKey } from "@/lib/utils/rate-limiter";
import { router } from "../../trpc";
import { orgManagerReadProcedure } from "./middleware";

/** Kolonnenavn for timer uden aktivitetstype (#459) — genbruges af CSV-tests. */
export { NO_ACTIVITY_LABEL } from "@/lib/enterprise/reporting/aggregate";

/** Skabelonen 'Lønrapport (standard)' = den gamle lønrapport, seedet pr. org. */
export const STANDARD_PAYROLL_TEMPLATE_NAME = "Lønrapport (standard)";

const templateIdInput = z.object({ id: z.string().uuid() });

function periodErrorToTrpc(err: unknown): never {
  if (err instanceof ReportPeriodError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: err.message });
  }
  throw err;
}

export const enterpriseReportsRouter = router({
  /**
   * getPayrollReport — bagudkompatibel lønrapport (indstillinger-siden
   * invaliderer den). Kører nu på datasættet (E4, #462): aggregatet er ikke
   * længere afhængigt af de cappede detaljerækker, og afviste timer er
   * ekskluderet. Kun HR/admin/owner.
   */
  getPayrollReport: orgManagerReadProcedure
    .input(
      z.object({
        from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      }),
    )
    .query(async ({ ctx, input }) => {
      if (!canRunReportType(ctx.orgRole, "payroll")) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reports.payrollHrOnly"),
        });
      }
      const scope = await getVisibleScope(ctx.db, ctx);
      const config = enterpriseReportConfigSchema.parse({
        ...defaultConfigFor("payroll"),
        period: { kind: "custom", from: input.from, to: input.to },
        includeDetails: true,
      });
      const result = await runEnterpriseReport(ctx.db, {
        orgId: ctx.orgId,
        scope,
        config,
      }).catch(periodErrorToTrpc);
      return result;
    }),

  /** Valgmuligheder til rapport-builderen (kun det kalderen må se). */
  getReportOptions: orgManagerReadProcedure.query(async ({ ctx }) => {
    const scope = await getVisibleScope(ctx.db, ctx);
    const visibleProfiles = scope.profiles;
    const visibleDeptIds = new Set(
      visibleProfiles.map((p) => p.departmentId).filter(Boolean) as string[],
    );
    const [deptRows, typeRows, activityRows, projectRows, userRows] =
      await Promise.all([
        ctx.db.query.departments.findMany({
          where: and(
            eq(departments.organizationId, ctx.orgId),
            eq(departments.isArchived, false),
          ),
          columns: { id: true, name: true },
          orderBy: [asc(departments.name)],
        }),
        ctx.db.query.absenceTypes.findMany({
          where: and(
            eq(absenceTypes.organizationId, ctx.orgId),
            eq(absenceTypes.isArchived, false),
          ),
          columns: { id: true, name: true, category: true },
          orderBy: [asc(absenceTypes.name)],
        }),
        ctx.db.query.activityTypes.findMany({
          where: and(
            eq(activityTypes.organizationId, ctx.orgId),
            eq(activityTypes.isArchived, false),
          ),
          columns: { id: true, name: true },
          orderBy: [asc(activityTypes.sortOrder), asc(activityTypes.name)],
        }),
        ctx.db.query.projects.findMany({
          where: and(
            eq(projects.organizationId, ctx.orgId),
            eq(projects.status, "active"),
          ),
          columns: { id: true, name: true },
          orderBy: [asc(projects.name)],
        }),
        visibleProfiles.length > 0
          ? ctx.db.query.employeeProfiles.findMany({
              // Kun synlige profiler (#464)
              where: inArray(
                employeeProfiles.id,
                visibleProfiles.map((p) => p.id),
              ),
              columns: { userId: true, departmentId: true, isActive: true },
              with: { user: { columns: { name: true, email: true } } },
            })
          : Promise.resolve([]),
      ]);
    return {
      role: ctx.orgRole,
      canRunPayroll: canRunReportType(ctx.orgRole, "payroll"),
      canShareTemplates: canShareTemplates(ctx.orgRole),
      departments: scope.all
        ? deptRows
        : deptRows.filter((d) => visibleDeptIds.has(d.id)),
      employees: userRows
        .map((p) => ({
          userId: p.userId,
          name: p.user?.name ?? "Ukendt",
          email: p.user?.email ?? "",
          departmentId: p.departmentId,
          isActive: p.isActive,
        }))
        .sort((a, b) => a.name.localeCompare(b.name, "da")),
      projects: projectRows,
      activityTypes: activityRows,
      absenceTypes: typeRows,
      reportTypes: ENTERPRISE_REPORT_TYPES.map((t) => ({
        ...REPORT_TYPE_DEFINITIONS[t],
        allowed: canRunReportType(ctx.orgRole, t),
      })),
    };
  }),

  /** Kør rapport → JSON (tabel + summary + evt. detaljer). */
  runReport: orgManagerReadProcedure
    .input(z.object({ config: enterpriseReportConfigSchema }))
    .query(async ({ ctx, input }) => {
      if (!canRunReportType(ctx.orgRole, input.config.reportType)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reportTypeHrOnly"),
        });
      }
      const scope = await getVisibleScope(ctx.db, ctx);
      return runEnterpriseReport(ctx.db, {
        orgId: ctx.orgId,
        scope,
        config: input.config,
      }).catch(periodErrorToTrpc);
    }),

  /** Eksport server-side (CSV/XLSX/PDF) — rate-limit som freelance-eksport. */
  exportReport: orgManagerReadProcedure
    .input(
      z.object({
        config: enterpriseReportConfigSchema,
        format: z.enum(["csv", "xlsx", "pdf"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
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
      if (!canRunReportType(ctx.orgRole, input.config.reportType)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reportTypeHrOnly"),
        });
      }
      const scope = await getVisibleScope(ctx.db, ctx);
      const result = await runEnterpriseReport(ctx.db, {
        orgId: ctx.orgId,
        scope,
        config: input.config,
      }).catch(periodErrorToTrpc);
      const periodLabel = `${result.period.from} – ${result.period.to}`;
      const safeName = result.title.replace(/[^\wæøåÆØÅ -]/g, "");
      const filename = `${safeName}-${result.period.from}-${result.period.to}`;

      if (input.format === "csv") {
        return {
          format: "csv" as const,
          filename: `${filename}.csv`,
          data: reportTableToCsv(result.table),
        };
      }
      if (input.format === "xlsx") {
        const buf = await reportTableToXlsx(result.table, {
          title: result.title,
          period: periodLabel,
        });
        return {
          format: "xlsx" as const,
          filename: `${filename}.xlsx`,
          data: Buffer.from(buf).toString("base64"),
        };
      }
      const [{ renderToBuffer }, { EnterpriseReportPDF }, org] =
        await Promise.all([
          import("@react-pdf/renderer"),
          import("@/lib/enterprise/reporting/pdf"),
          ctx.db.query.organizations.findFirst({
            where: (o, { eq: eqO }) => eqO(o.id, ctx.orgId),
            columns: { name: true },
          }),
        ]);
      const pdf = await renderToBuffer(
        EnterpriseReportPDF({
          title: result.title,
          orgName: org?.name ?? "",
          period: periodLabel,
          table: result.table,
        }),
      );
      return {
        format: "pdf" as const,
        filename: `${filename}.pdf`,
        data: Buffer.from(pdf).toString("base64"),
      };
    }),

  /**
   * Skabeloner: org-delte (user_id NULL — HR/admin) + egne. Seeder
   * 'Lønrapport (standard)' som org-delt system-skabelon første gang.
   */
  listReportTemplates: orgManagerReadProcedure.query(async ({ ctx }) => {
    const where = and(
      eq(reportTemplates.organizationId, ctx.orgId),
      or(
        isNull(reportTemplates.userId),
        eq(reportTemplates.userId, ctx.session.user.id),
      ),
      inArray(reportTemplates.reportType, [...ENTERPRISE_REPORT_TYPES]),
    );
    let rows = await ctx.db.query.reportTemplates.findMany({
      where,
      orderBy: [desc(reportTemplates.isSystem), asc(reportTemplates.name)],
    });
    if (!rows.some((r) => r.isSystem && r.reportType === "payroll")) {
      await ctx.db
        .insert(reportTemplates)
        .values({
          userId: null,
          organizationId: ctx.orgId,
          reportType: "payroll",
          name: STANDARD_PAYROLL_TEMPLATE_NAME,
          description:
            "Den klassiske lønrapport: pr. medarbejder med timer, aktiviteter, flex, overtid og fravær pr. type.",
          config: { ...defaultConfigFor("payroll"), includeDetails: true },
          isSystem: true,
        })
        .onConflictDoNothing();
      rows = await ctx.db.query.reportTemplates.findMany({
        where,
        orderBy: [desc(reportTemplates.isSystem), asc(reportTemplates.name)],
      });
    }
    return rows
      .filter((r) => isEnterpriseReportType(r.reportType))
      .filter((r) => canRunReportType(ctx.orgRole, r.reportType as "payroll"))
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        reportType: r.reportType,
        config: enterpriseReportConfigSchema.safeParse(r.config).data ?? null,
        isSystem: r.isSystem,
        shared: r.userId === null,
        ownedByMe: r.userId === ctx.session.user.id,
        updatedAt: r.updatedAt,
      }));
  }),

  saveReportTemplate: orgManagerReadProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        config: enterpriseReportConfigSchema,
        /** Org-delt (alle ledere/HR ser den) — kun HR/admin */
        shared: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!canRunReportType(ctx.orgRole, input.config.reportType)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reportTypeHrOnly"),
        });
      }
      if (input.shared && !canShareTemplates(ctx.orgRole)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reports.shareHrOnly"),
        });
      }
      const values = {
        userId: input.shared ? null : ctx.session.user.id,
        organizationId: ctx.orgId,
        reportType: input.config.reportType,
        name: input.name,
        description: input.description ?? null,
        config: input.config,
        isSystem: false,
      };
      if (input.id) {
        const existing = await ctx.db.query.reportTemplates.findFirst({
          where: and(
            eq(reportTemplates.id, input.id),
            eq(reportTemplates.organizationId, ctx.orgId),
          ),
        });
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.isSystem) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr(
              "serverErrors",
              "enterprise.reports.defaultNoOverwrite",
            ),
          });
        }
        const mayEdit =
          existing.userId === ctx.session.user.id ||
          (existing.userId === null && canShareTemplates(ctx.orgRole));
        if (!mayEdit) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: await tr("serverErrors", "enterprise.reports.ownEditOnly"),
          });
        }
        const [updated] = await ctx.db
          .update(reportTemplates)
          .set({ ...values, updatedAt: new Date() })
          .where(eq(reportTemplates.id, input.id))
          .returning({ id: reportTemplates.id });
        return updated;
      }
      const [created] = await ctx.db
        .insert(reportTemplates)
        .values(values)
        .returning({ id: reportTemplates.id });
      return created;
    }),

  deleteReportTemplate: orgManagerReadProcedure
    .input(templateIdInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          eq(reportTemplates.organizationId, ctx.orgId),
        ),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr(
            "serverErrors",
            "enterprise.reports.defaultNoDelete",
          ),
        });
      }
      const mayDelete =
        existing.userId === ctx.session.user.id ||
        (existing.userId === null && canShareTemplates(ctx.orgRole));
      if (!mayDelete) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reports.ownDeleteOnly"),
        });
      }
      await ctx.db
        .delete(reportTemplates)
        .where(eq(reportTemplates.id, input.id));
      return { ok: true };
    }),

  /**
   * Planlagt mail (genbruger report_schedules + cron api/cron/report-schedules,
   * som router på reportType). Org-scoped; cron'en genskaber ejerens scope.
   */
  scheduleReport: orgManagerReadProcedure
    .input(
      z.object({
        reportTemplateId: z.string().uuid(),
        frequency: z.enum(["weekly", "monthly"]),
        sendDay: z.number().int().min(1).max(28),
        recipients: z.array(z.string().email()).min(1).max(10),
        format: z.enum(["pdf", "xlsx", "csv"]).default("xlsx"),
        subject: z.string().max(200).optional(),
        message: z.string().max(2000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.frequency === "weekly" && input.sendDay > 7) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.reports.weekdayRange"),
        });
      }
      const template = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.reportTemplateId),
          eq(reportTemplates.organizationId, ctx.orgId),
        ),
        columns: { id: true, reportType: true, userId: true },
      });
      if (!template || !isEnterpriseReportType(template.reportType)) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "common.templateNotFound"),
        });
      }
      if (!canRunReportType(ctx.orgRole, template.reportType)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "enterprise.reportTypeHrOnly"),
        });
      }
      const [schedule] = await ctx.db
        .insert(reportSchedules)
        .values({
          userId: ctx.session.user.id,
          organizationId: ctx.orgId,
          reportTemplateId: template.id,
          reportType: template.reportType,
          frequency: input.frequency,
          sendDay: input.sendDay,
          recipients: input.recipients,
          format: input.format,
          subject: input.subject || null,
          message: input.message || null,
          restrictToOwnEntries: false,
        })
        .returning({ id: reportSchedules.id });
      return schedule;
    }),

  listReportSchedules: orgManagerReadProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select({
        id: reportSchedules.id,
        userId: reportSchedules.userId,
        frequency: reportSchedules.frequency,
        sendDay: reportSchedules.sendDay,
        recipients: reportSchedules.recipients,
        format: reportSchedules.format,
        isActive: reportSchedules.isActive,
        lastSentAt: reportSchedules.lastSentAt,
        templateName: reportTemplates.name,
        reportType: reportSchedules.reportType,
      })
      .from(reportSchedules)
      .innerJoin(
        reportTemplates,
        eq(reportSchedules.reportTemplateId, reportTemplates.id),
      )
      .where(
        and(
          eq(reportSchedules.organizationId, ctx.orgId),
          inArray(reportSchedules.reportType, [...ENTERPRISE_REPORT_TYPES]),
          // Ledere ser egne planer; HR/admin alle i org'en
          canShareTemplates(ctx.orgRole)
            ? undefined
            : eq(reportSchedules.userId, ctx.session.user.id),
        ),
      )
      .orderBy(desc(reportSchedules.createdAt));
    return rows.map((r) => ({
      ...r,
      ownedByMe: r.userId === ctx.session.user.id,
    }));
  }),

  deleteReportSchedule: orgManagerReadProcedure
    .input(templateIdInput)
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.reportSchedules.findFirst({
        where: and(
          eq(reportSchedules.id, input.id),
          eq(reportSchedules.organizationId, ctx.orgId),
        ),
        columns: { id: true, userId: true },
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (
        existing.userId !== ctx.session.user.id &&
        !canShareTemplates(ctx.orgRole)
      ) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      await ctx.db
        .delete(reportSchedules)
        .where(eq(reportSchedules.id, input.id));
      return { ok: true };
    }),
});
