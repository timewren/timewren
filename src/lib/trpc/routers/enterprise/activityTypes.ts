import { TRPCError } from "@trpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as dbClient } from "@/lib/db";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import { activityTypes, projectActivityTypes, projects } from "@/lib/db/schema";
import { ensureDefaultActivityTypes } from "@/lib/enterprise/activity-types";
import { auditDiff, logOrgAudit, pickAuditFields } from "@/lib/org-audit";
import { router } from "../../trpc";
import {
  orgAdminProcedure,
  organizationProcedure,
  orgManagerProcedure,
} from "./middleware";

/**
 * Aktivitetstyper (#459) — org'ens aktiviteter (undervisning/forberedelse/
 * møder/administration) som dimension på tidsregistreringer, og tilladt-
 * listen pr. projekt. Alt scoped på ctx.orgId.
 */

const colorString = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, { error: () => st("zod.invalidColor") });
const payrollCodeString = z.string().trim().max(50).nullable();

const ACTIVITY_AUDIT_FIELDS = [
  "name",
  "color",
  "payrollCode",
  "isDefault",
  "isArchived",
  "defaultBillable",
] as const;

async function assertOrgActivityType(
  db: typeof dbClient,
  orgId: string,
  id: string,
) {
  const type = await db.query.activityTypes.findFirst({
    where: and(
      eq(activityTypes.id, id),
      eq(activityTypes.organizationId, orgId),
    ),
  });
  if (!type) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.activityTypeNotInOrg"),
    });
  }
  return type;
}

async function assertOrgProject(
  db: typeof dbClient,
  orgId: string,
  projectId: string,
) {
  const project = await db.query.projects.findFirst({
    where: and(eq(projects.id, projectId), eq(projects.organizationId, orgId)),
    columns: { id: true },
  });
  if (!project) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: await tr("serverErrors", "enterprise.projectNotInOrg"),
    });
  }
  return project;
}

function rethrowDuplicateName(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: st("enterprise.activityTypeNameExists"),
    });
  }
  throw err;
}

export const enterpriseActivityTypesRouter = router({
  /**
   * listActivityTypes — org'ens aktivitetstyper i rækkefølge. Orgs med
   * enterprise-modulet og 0 typer får standardsættet ved første visning
   * (samme mønster som fraværstyper, #435).
   */
  listActivityTypes: organizationProcedure
    .input(z.object({ includeArchived: z.boolean().default(false) }).optional())
    .query(async ({ ctx, input }) => {
      const includeArchived = input?.includeArchived ?? false;
      const where = includeArchived
        ? eq(activityTypes.organizationId, ctx.orgId)
        : and(
            eq(activityTypes.organizationId, ctx.orgId),
            eq(activityTypes.isArchived, false),
          );
      const orderBy = [asc(activityTypes.sortOrder), asc(activityTypes.name)];
      const types = await ctx.db.query.activityTypes.findMany({
        where,
        orderBy,
      });
      if (types.length > 0 || !ctx.modules.isEnabled("enterprise")) {
        return types;
      }
      // Lazy seed — kun når org'en slet ingen typer har (heller ikke arkiverede)
      const any = await ctx.db.query.activityTypes.findFirst({
        where: eq(activityTypes.organizationId, ctx.orgId),
        columns: { id: true },
      });
      if (any) return types;
      await ensureDefaultActivityTypes(ctx.db, ctx.orgId);
      return ctx.db.query.activityTypes.findMany({ where, orderBy });
    }),

  /** createActivityType — ny aktivitetstype (admin/owner). Lægges sidst. */
  createActivityType: orgAdminProcedure
    .input(
      z.object({
        name: z.string().trim().min(1).max(255),
        color: colorString.default("#6366f1"),
        payrollCode: payrollCodeString.optional(),
        isDefault: z.boolean().default(false),
        // Fakturerbarhed for nye poster (#704): null = arv
        defaultBillable: z.boolean().nullable().default(null),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.activityTypes.findMany({
        where: eq(activityTypes.organizationId, ctx.orgId),
        columns: { sortOrder: true },
      });
      const sortOrder =
        existing.length > 0
          ? Math.max(...existing.map((t) => t.sortOrder)) + 1
          : 0;
      try {
        return await ctx.db.transaction(async (tx) => {
          if (input.isDefault) {
            await tx
              .update(activityTypes)
              .set({ isDefault: false })
              .where(eq(activityTypes.organizationId, ctx.orgId));
          }
          const [created] = await tx
            .insert(activityTypes)
            .values({
              organizationId: ctx.orgId,
              name: input.name,
              color: input.color,
              payrollCode: input.payrollCode || null,
              isDefault: input.isDefault,
              defaultBillable: input.defaultBillable,
              sortOrder,
            })
            .returning();
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "activity_type_created",
            {
              metadata: {
                activityTypeId: created.id,
                ...pickAuditFields(created, ACTIVITY_AUDIT_FIELDS),
              },
            },
          );
          return created;
        });
      } catch (err) {
        rethrowDuplicateName(err);
      }
    }),

  /** updateActivityType — navn/farve/lønart/standard/arkiveret/fakturerbar. */
  updateActivityType: orgAdminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(255).optional(),
        color: colorString.optional(),
        payrollCode: payrollCodeString.optional(),
        isDefault: z.boolean().optional(),
        isArchived: z.boolean().optional(),
        defaultBillable: z.boolean().nullable().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const before = await assertOrgActivityType(ctx.db, ctx.orgId, input.id);
      const { id, ...patch } = input;
      try {
        return await ctx.db.transaction(async (tx) => {
          if (patch.isDefault === true) {
            await tx
              .update(activityTypes)
              .set({ isDefault: false })
              .where(eq(activityTypes.organizationId, ctx.orgId));
          }
          const [updated] = await tx
            .update(activityTypes)
            .set({
              ...(patch.name !== undefined ? { name: patch.name } : {}),
              ...(patch.color !== undefined ? { color: patch.color } : {}),
              ...(patch.payrollCode !== undefined
                ? { payrollCode: patch.payrollCode || null }
                : {}),
              ...(patch.isDefault !== undefined
                ? { isDefault: patch.isDefault }
                : {}),
              ...(patch.isArchived !== undefined
                ? { isArchived: patch.isArchived }
                : {}),
              ...(patch.defaultBillable !== undefined
                ? { defaultBillable: patch.defaultBillable }
                : {}),
            })
            .where(
              and(
                eq(activityTypes.id, id),
                eq(activityTypes.organizationId, ctx.orgId),
              ),
            )
            .returning();
          const diff = auditDiff(
            pickAuditFields(before, ACTIVITY_AUDIT_FIELDS),
            pickAuditFields(updated, ACTIVITY_AUDIT_FIELDS),
          );
          if (Object.keys(diff).length > 0) {
            await logOrgAudit(
              tx,
              ctx.orgId,
              ctx.session.user.id,
              diff.isArchived?.to === true
                ? "activity_type_archived"
                : "activity_type_updated",
              { metadata: { activityTypeId: id, name: updated.name, diff } },
            );
          }
          return updated;
        });
      } catch (err) {
        rethrowDuplicateName(err);
      }
    }),

  /**
   * archiveActivityType — arkivér (aldrig slet: poster peger på typen og
   * skal stadig kunne rapporteres). Fjernes samtidig fra projekternes
   * tilladt-lister, så den ikke dukker op som standardrække.
   */
  archiveActivityType: orgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const type = await assertOrgActivityType(ctx.db, ctx.orgId, input.id);
      await ctx.db.transaction(async (tx) => {
        await tx
          .update(activityTypes)
          .set({ isArchived: true, isDefault: false })
          .where(
            and(
              eq(activityTypes.id, input.id),
              eq(activityTypes.organizationId, ctx.orgId),
            ),
          );
        await tx
          .delete(projectActivityTypes)
          .where(eq(projectActivityTypes.activityTypeId, input.id));
        if (!type.isArchived) {
          await logOrgAudit(
            tx,
            ctx.orgId,
            ctx.session.user.id,
            "activity_type_archived",
            { metadata: { activityTypeId: input.id, name: type.name } },
          );
        }
      });
      return { id: input.id, archived: true };
    }),

  /** reorderActivityTypes — ny rækkefølge (alle org'ens ikke-arkiverede id'er). */
  reorderActivityTypes: orgAdminProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1).max(200) }))
    .mutation(async ({ ctx, input }) => {
      const own = await ctx.db.query.activityTypes.findMany({
        where: and(
          eq(activityTypes.organizationId, ctx.orgId),
          inArray(activityTypes.id, input.ids),
        ),
        columns: { id: true },
      });
      if (own.length !== new Set(input.ids).size) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "enterprise.activityTypesNotInOrg"),
        });
      }
      await ctx.db.transaction(async (tx) => {
        for (const [index, id] of input.ids.entries()) {
          await tx
            .update(activityTypes)
            .set({ sortOrder: index })
            .where(eq(activityTypes.id, id));
        }
      });
      return { count: input.ids.length };
    }),

  /** listProjectActivityTypes — tilladte aktiviteter på et projekt (tom = alle). */
  listProjectActivityTypes: orgManagerProcedure
    .input(z.object({ projectId: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      await assertOrgProject(ctx.db, ctx.orgId, input.projectId);
      const rows = await ctx.db
        .select({ activityTypeId: projectActivityTypes.activityTypeId })
        .from(projectActivityTypes)
        .where(eq(projectActivityTypes.projectId, input.projectId));
      return {
        projectId: input.projectId,
        activityTypeIds: rows.map((r) => r.activityTypeId),
      };
    }),

  /**
   * setProjectActivityTypes — erstat projektets tilladt-liste atomisk.
   * Tom liste = alle org'ens aktive aktivitetstyper er tilladt.
   */
  setProjectActivityTypes: orgAdminProcedure
    .input(
      z.object({
        projectId: z.string().uuid(),
        activityTypeIds: z.array(z.string().uuid()).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertOrgProject(ctx.db, ctx.orgId, input.projectId);
      const wanted = await assertActiveOrgActivityTypes(
        ctx.db,
        ctx.orgId,
        input.activityTypeIds,
      );
      await replaceProjectActivityTypes(ctx.db, [input.projectId], wanted);
      return { projectId: input.projectId, count: wanted.length };
    }),

  /**
   * setProjectActivityTypesBulk (#475) — samme tilladt-liste på flere
   * projekter ad gangen (admin-guide på projektlisten). Tom liste = alle.
   */
  setProjectActivityTypesBulk: orgAdminProcedure
    .input(
      z.object({
        projectIds: z.array(z.string().uuid()).min(1).max(200),
        activityTypeIds: z.array(z.string().uuid()).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const projectIds = Array.from(new Set(input.projectIds));
      const own = await ctx.db.query.projects.findMany({
        where: and(
          eq(projects.organizationId, ctx.orgId),
          inArray(projects.id, projectIds),
        ),
        columns: { id: true },
      });
      if (own.length !== projectIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "enterprise.projectsNotInOrg"),
        });
      }
      const wanted = await assertActiveOrgActivityTypes(
        ctx.db,
        ctx.orgId,
        input.activityTypeIds,
      );
      await replaceProjectActivityTypes(ctx.db, projectIds, wanted);
      await logOrgAudit(
        ctx.db,
        ctx.orgId,
        ctx.session.user.id,
        "activity_type_updated",
        {
          metadata: {
            reason: "project_activity_types_bulk",
            projectIds,
            activityTypeIds: wanted,
          },
        },
      );
      return { projects: projectIds.length, count: wanted.length };
    }),
});

/** Dedupliker og kræv at alle id'er er org'ens aktive aktivitetstyper. */
async function assertActiveOrgActivityTypes(
  db: typeof dbClient,
  orgId: string,
  ids: readonly string[],
): Promise<string[]> {
  const wanted = Array.from(new Set(ids));
  if (wanted.length === 0) return wanted;
  const own = await db.query.activityTypes.findMany({
    where: and(
      eq(activityTypes.organizationId, orgId),
      eq(activityTypes.isArchived, false),
      inArray(activityTypes.id, wanted),
    ),
    columns: { id: true },
  });
  if (own.length !== wanted.length) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: await tr("serverErrors", "enterprise.activityTypesUnknown"),
    });
  }
  return wanted;
}

/** Erstat tilladt-listen atomisk på et eller flere (org-verificerede) projekter. */
async function replaceProjectActivityTypes(
  db: typeof dbClient,
  projectIds: readonly string[],
  activityTypeIds: readonly string[],
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(projectActivityTypes)
      .where(inArray(projectActivityTypes.projectId, [...projectIds]));
    if (activityTypeIds.length > 0) {
      await tx
        .insert(projectActivityTypes)
        .values(
          projectIds.flatMap((projectId) =>
            activityTypeIds.map((activityTypeId) => ({
              projectId,
              activityTypeId,
            })),
          ),
        )
        .onConflictDoNothing();
    }
  });
}
