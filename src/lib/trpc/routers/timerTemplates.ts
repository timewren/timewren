import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { clients, projects, timerTemplates } from "@/lib/db/schema";
import { protectedProcedure, router } from "../trpc";

const timerTemplateInput = z.object({
  name: z.string().min(1, { error: () => st("zod.nameRequired") }),
  projectId: z.string().uuid().optional().nullable(),
  clientId: z.string().uuid().optional().nullable(),
  description: z.string().optional(),
  color: z.string().optional(),
  isFavorite: z.boolean().optional(),
});

export const timerTemplatesRouter = router({
  // List all timer templates for current user
  list: protectedProcedure
    .input(
      z
        .object({
          favoritesOnly: z.boolean().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;
      const conditions = [eq(timerTemplates.userId, userId)];

      if (input?.favoritesOnly) {
        conditions.push(eq(timerTemplates.isFavorite, true));
      }

      const templates = await ctx.db.query.timerTemplates.findMany({
        where: and(...conditions),
        orderBy: [
          desc(timerTemplates.isFavorite),
          desc(timerTemplates.usageCount),
          desc(timerTemplates.lastUsedAt),
        ],
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
        },
      });

      return templates;
    }),

  // Get template by ID
  getById: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const template = await ctx.db.query.timerTemplates.findFirst({
        where: and(
          eq(timerTemplates.id, input.id),
          eq(timerTemplates.userId, userId),
        ),
        with: {
          project: {
            with: {
              client: true,
            },
          },
          client: true,
        },
      });

      if (!template) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      return template;
    }),

  // Create timer template
  create: protectedProcedure
    .input(timerTemplateInput)
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      // Verify project belongs to user if provided
      if (input.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });
        if (!project) {
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        }
      }

      // Verify client belongs to user if provided
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });
        if (!client) {
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
        }
      }

      const [newTemplate] = await ctx.db
        .insert(timerTemplates)
        .values({
          userId,
          organizationId: ctx.orgId,
          name: input.name,
          projectId: input.projectId || null,
          clientId: input.clientId || null,
          description: input.description || null,
          color: input.color || "#3b82f6",
          isFavorite: input.isFavorite || false,
        })
        .returning();

      return newTemplate;
    }),

  // Update timer template
  update: protectedProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        data: timerTemplateInput,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db.query.timerTemplates.findFirst({
        where: and(
          eq(timerTemplates.id, input.id),
          eq(timerTemplates.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      // Verify project belongs to user if provided
      if (input.data.projectId) {
        const project = await ctx.db.query.projects.findFirst({
          where: and(
            eq(projects.id, input.data.projectId),
            ctx.orgId
              ? eq(projects.organizationId, ctx.orgId)
              : eq(projects.userId, userId),
          ),
        });
        if (!project) {
          throw new Error(await tr("serverErrors", "common.projectNotFound"));
        }
      }

      // Verify client belongs to user if provided
      if (input.data.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.data.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, userId),
          ),
        });
        if (!client) {
          throw new Error(await tr("serverErrors", "common.clientNotFound"));
        }
      }

      const [updatedTemplate] = await ctx.db
        .update(timerTemplates)
        .set({
          name: input.data.name,
          projectId: input.data.projectId || null,
          clientId: input.data.clientId || null,
          description: input.data.description || null,
          color: input.data.color,
          isFavorite: input.data.isFavorite,
          updatedAt: new Date(),
        })
        .where(eq(timerTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Toggle favorite status
  toggleFavorite: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db.query.timerTemplates.findFirst({
        where: and(
          eq(timerTemplates.id, input.id),
          eq(timerTemplates.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      const [updatedTemplate] = await ctx.db
        .update(timerTemplates)
        .set({
          isFavorite: !existing.isFavorite,
          updatedAt: new Date(),
        })
        .where(eq(timerTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Record template usage (increment counter and update lastUsedAt)
  recordUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db.query.timerTemplates.findFirst({
        where: and(
          eq(timerTemplates.id, input.id),
          eq(timerTemplates.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      const [updatedTemplate] = await ctx.db
        .update(timerTemplates)
        .set({
          usageCount: (existing.usageCount || 0) + 1,
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(timerTemplates.id, input.id))
        .returning();

      return updatedTemplate;
    }),

  // Delete timer template
  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const userId = ctx.session.user.id;

      const existing = await ctx.db.query.timerTemplates.findFirst({
        where: and(
          eq(timerTemplates.id, input.id),
          eq(timerTemplates.userId, userId),
        ),
      });

      if (!existing) {
        throw new Error(await tr("serverErrors", "common.templateNotFound"));
      }

      await ctx.db
        .delete(timerTemplates)
        .where(eq(timerTemplates.id, input.id));

      return { success: true };
    }),
});
