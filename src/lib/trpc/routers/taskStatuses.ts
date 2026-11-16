import { TRPCError } from "@trpc/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { isUniqueViolation } from "@/lib/db/pg-errors";
import { taskStatuses, tasks } from "@/lib/db/schema";
import { LANE_CATEGORIES } from "@/lib/kanban/lane-category";
import {
  applyLaneStatusToTasks,
  claimLaneTasks,
  listBoardLanes,
} from "@/lib/kanban/lanes-server";
import { moduleWriteProcedure, protectedProcedure, router } from "../trpc";

const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const laneCategory = z.enum(LANE_CATEGORIES);

/** Kolonnenavne er unikke pr. tavle (indeks fra migrate-safe). */
function rethrowDuplicateName(err: unknown): never {
  if (isUniqueViolation(err)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: st("tasks.laneDuplicateName"),
    });
  }
  throw err;
}

export const taskStatusesRouter = router({
  /**
   * Return lanes for the given context, ordered by `order` ASC.
   * projectId=null  → scope='general' lanes owned by the user.
   * projectId=<id>  → scope='project' lanes for that project (user
   *                    must own it — enforced by joining userId).
   */
  listForContext: protectedProcedure
    .input(
      z.object({
        projectId: z.string().uuid().nullable(),
      }),
    )
    .query(({ ctx, input }) =>
      listBoardLanes(ctx.db, {
        userId: ctx.session.user.id,
        orgId: ctx.orgId,
        projectId: input.projectId,
      }),
    ),

  create: moduleWriteProcedure("tasks")
    .input(
      z.object({
        projectId: z.string().uuid().nullable(),
        name: z.string().trim().min(1).max(50),
        color: z.string().regex(HEX_COLOR),
        category: laneCategory.default("not_started"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const scope = input.projectId === null ? "general" : "project";

      // Insert at the end — max(order) + 1
      const [{ maxOrder }] = await ctx.db
        .select({ maxOrder: sql<number>`coalesce(max("order"), -1)` })
        .from(taskStatuses)
        .where(
          and(
            ctx.orgId
              ? eq(taskStatuses.organizationId, ctx.orgId)
              : eq(taskStatuses.userId, userId),
            eq(taskStatuses.scope, scope),
            input.projectId === null
              ? sql`${taskStatuses.projectId} IS NULL`
              : eq(taskStatuses.projectId, input.projectId),
          ),
        );

      const [created] = await ctx.db
        .insert(taskStatuses)
        .values({
          userId,
          organizationId: ctx.orgId,
          scope,
          projectId: input.projectId,
          name: input.name,
          color: input.color,
          order: Number(maxOrder) + 1,
          isArchive: false,
          category: input.category,
        })
        .returning()
        .catch(rethrowDuplicateName);
      return created;
    }),

  update: moduleWriteProcedure("tasks")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().trim().min(1).max(50).optional(),
        color: z.string().regex(HEX_COLOR).optional(),
        isArchive: z.boolean().optional(),
        category: laneCategory.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const { id, ...patch } = input;
      const ownershipFilter = ctx.orgId
        ? eq(taskStatuses.organizationId, ctx.orgId)
        : eq(taskStatuses.userId, userId);
      return ctx.db
        .transaction(async (tx) => {
          const [before] = await tx
            .select({
              category: taskStatuses.category,
              scope: taskStatuses.scope,
              projectId: taskStatuses.projectId,
            })
            .from(taskStatuses)
            .where(and(eq(taskStatuses.id, id), ownershipFilter))
            .for("update");
          if (!before)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: await tr("serverErrors", "taskStatuses.laneNotFound"),
            });
          const categoryChanged =
            patch.category !== undefined && patch.category !== before.category;
          // Ny kategori: også de kort, tavlen kun viser i kolonnen, skal
          // følge med. Det afgøres med den gamle kategori, så før opdateringen.
          if (categoryChanged) {
            await claimLaneTasks(
              tx,
              { id, scope: before.scope, projectId: before.projectId },
              { userId, orgId: ctx.orgId },
            );
          }
          const [updated] = await tx
            .update(taskStatuses)
            .set({ ...patch, updatedAt: new Date() })
            .where(and(eq(taskStatuses.id, id), ownershipFilter))
            .returning();
          // Opgaverne i kolonnen får den gamle status, som kategorien
          // kræver, så rapporter og "afsluttet" følger med.
          if (categoryChanged && patch.category) {
            await applyLaneStatusToTasks(tx, {
              id: updated.id,
              name: updated.name,
              category: patch.category,
            });
          }
          return updated;
        })
        .catch(rethrowDuplicateName);
    }),

  reorder: moduleWriteProcedure("tasks")
    .input(
      z.object({
        orderedIds: z.array(z.string().uuid()).min(1),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownerFilter = ctx.orgId
        ? eq(taskStatuses.organizationId, ctx.orgId)
        : eq(taskStatuses.userId, userId);
      // Verify every lane in the request belongs to the user and to the same
      // scope+projectId context — mixing contexts would create visual chaos.
      const lanes = await ctx.db
        .select({
          id: taskStatuses.id,
          scope: taskStatuses.scope,
          projectId: taskStatuses.projectId,
          userId: taskStatuses.userId,
          organizationId: taskStatuses.organizationId,
        })
        .from(taskStatuses)
        .where(and(inArray(taskStatuses.id, input.orderedIds), ownerFilter));

      if (lanes.length !== input.orderedIds.length) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "taskStatuses.lanesNotFound"),
        });
      }
      const contexts = new Set(
        lanes.map((l) => `${l.scope}:${l.projectId ?? "null"}`),
      );
      if (contexts.size !== 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "taskStatuses.crossContext"),
        });
      }
      // Issue all updates in a transaction — ownership enforced per row.
      await ctx.db.transaction(async (tx) => {
        for (let i = 0; i < input.orderedIds.length; i++) {
          await tx
            .update(taskStatuses)
            .set({ order: i, updatedAt: new Date() })
            .where(and(eq(taskStatuses.id, input.orderedIds[i]), ownerFilter));
        }
      });
      return { ok: true };
    }),

  delete: moduleWriteProcedure("tasks")
    .input(
      z.object({
        id: z.string().uuid(),
        destinationLaneId: z.string().uuid().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const ownerFilter = ctx.orgId
        ? eq(taskStatuses.organizationId, ctx.orgId)
        : eq(taskStatuses.userId, userId);
      await ctx.db.transaction(async (tx) => {
        const [lane] = await tx
          .select()
          .from(taskStatuses)
          .where(and(eq(taskStatuses.id, input.id), ownerFilter));
        if (!lane)
          throw new TRPCError({
            code: "NOT_FOUND",
            message: await tr("serverErrors", "taskStatuses.laneNotFound"),
          });

        const [{ siblings }] = await tx
          .select({ siblings: sql<number>`count(*)::int` })
          .from(taskStatuses)
          .where(
            and(
              ownerFilter,
              eq(taskStatuses.scope, lane.scope),
              lane.projectId === null
                ? sql`${taskStatuses.projectId} IS NULL`
                : eq(taskStatuses.projectId, lane.projectId),
            ),
          );
        if (Number(siblings) <= 1) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "taskStatuses.lastLane"),
          });
        }

        // Med en modtager følger også de kort, tavlen kun viser i
        // kolonnen. Uden modtager placerer tavlen dem selv bagefter.
        if (input.destinationLaneId) {
          await claimLaneTasks(tx, lane, { userId, orgId: ctx.orgId });
        }
        const [{ count }] = await tx
          .select({ count: sql<number>`count(*)::int` })
          .from(tasks)
          .where(eq(tasks.statusId, input.id));
        if (Number(count) > 0) {
          if (!input.destinationLaneId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "taskStatuses.destinationRequired",
              ),
            });
          }
          // Verify destination lane belongs to the same user and same context
          // (general-lane tasks must move to another general lane; project-lane
          // tasks must stay inside the same project).
          const [dest] = await tx
            .select()
            .from(taskStatuses)
            .where(
              and(eq(taskStatuses.id, input.destinationLaneId), ownerFilter),
            );
          if (!dest) {
            throw new TRPCError({
              code: "NOT_FOUND",
              message: await tr(
                "serverErrors",
                "taskStatuses.destinationNotFound",
              ),
            });
          }
          if (dest.scope !== lane.scope || dest.projectId !== lane.projectId) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              message: await tr(
                "serverErrors",
                "taskStatuses.destinationContext",
              ),
            });
          }
          // Opgaverne får modtagerkolonnens status (fx afsluttet, hvis de
          // flyttes til en done-kolonne), før de skifter kolonne.
          await applyLaneStatusToTasks(
            tx,
            { id: dest.id, name: dest.name, category: dest.category },
            eq(tasks.statusId, input.id),
          );
          await tx
            .update(tasks)
            .set({ statusId: input.destinationLaneId })
            .where(eq(tasks.statusId, input.id));
        }

        await tx.delete(taskStatuses).where(eq(taskStatuses.id, input.id));
      });
      return { ok: true };
    }),
});
