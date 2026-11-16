// src/lib/trpc/routers/reportTemplates.ts
import { TRPCError } from "@trpc/server";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { tr } from "@/i18n/server-text";
import { clients, reportTemplates } from "@/lib/db/schema";
import { reportTemplateConfigSchema } from "@/lib/reports/config-schema";
import { moduleWriteProcedure, protectedProcedure, router } from "../trpc";

export const reportTemplatesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.reportTemplates.findMany({
      // Kun freelance-skabeloner — enterprise-typer (E4, #462) har egen
      // config-form og listes via enterprise.listReportTemplates.
      where: and(
        ctx.orgId
          ? eq(reportTemplates.organizationId, ctx.orgId)
          : eq(reportTemplates.userId, ctx.session.user.id),
        eq(reportTemplates.reportType, "time"),
      ),
      orderBy: [
        desc(reportTemplates.isDefault),
        desc(reportTemplates.lastUsedAt),
      ],
    });
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const tpl = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          ctx.orgId
            ? eq(reportTemplates.organizationId, ctx.orgId)
            : eq(reportTemplates.userId, ctx.session.user.id),
        ),
      });
      if (!tpl) throw new TRPCError({ code: "NOT_FOUND" });
      return tpl;
    }),

  create: moduleWriteProcedure("templates")
    .input(
      z.object({
        name: z.string().min(1).max(120),
        description: z.string().max(500).optional(),
        clientId: z.string().uuid().optional(),
        config: reportTemplateConfigSchema,
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, ctx.session.user.id),
          ),
        });
        if (!client) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "reportTemplates.clientNotYours"),
          });
        }
      }
      const [created] = await ctx.db
        .insert(reportTemplates)
        .values({
          userId: ctx.session.user.id,
          organizationId: ctx.orgId,
          name: input.name,
          description: input.description,
          clientId: input.clientId,
          config: input.config,
          isSystem: false,
        })
        .returning();
      return created;
    }),

  update: moduleWriteProcedure("templates")
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(120).optional(),
        description: z.string().max(500).optional(),
        clientId: z.string().uuid().nullable().optional(),
        config: reportTemplateConfigSchema.optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          ctx.orgId
            ? eq(reportTemplates.organizationId, ctx.orgId)
            : eq(reportTemplates.userId, ctx.session.user.id),
        ),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "reportTemplates.systemNoEdit"),
        });
      }
      if (input.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, input.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, ctx.session.user.id),
          ),
        });
        if (!client) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "reportTemplates.clientNotYours"),
          });
        }
      }
      const [updated] = await ctx.db
        .update(reportTemplates)
        .set({
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined
            ? { description: input.description }
            : {}),
          ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
          ...(input.config !== undefined ? { config: input.config } : {}),
          updatedAt: new Date(),
        })
        .where(eq(reportTemplates.id, input.id))
        .returning();
      return updated;
    }),

  delete: moduleWriteProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          ctx.orgId
            ? eq(reportTemplates.organizationId, ctx.orgId)
            : eq(reportTemplates.userId, ctx.session.user.id),
        ),
      });
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.isSystem) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "reportTemplates.systemNoDelete"),
        });
      }
      await ctx.db
        .delete(reportTemplates)
        .where(eq(reportTemplates.id, input.id));
      return { ok: true };
    }),

  duplicate: moduleWriteProcedure("templates")
    .input(
      z.object({ id: z.string().uuid(), newName: z.string().min(1).max(120) }),
    )
    .mutation(async ({ ctx, input }) => {
      const src = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          ctx.orgId
            ? eq(reportTemplates.organizationId, ctx.orgId)
            : eq(reportTemplates.userId, ctx.session.user.id),
        ),
      });
      if (!src) throw new TRPCError({ code: "NOT_FOUND" });
      if (src.clientId) {
        const client = await ctx.db.query.clients.findFirst({
          where: and(
            eq(clients.id, src.clientId),
            ctx.orgId
              ? eq(clients.organizationId, ctx.orgId)
              : eq(clients.userId, ctx.session.user.id),
          ),
        });
        if (!client) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: await tr("serverErrors", "reportTemplates.clientNotYours"),
          });
        }
      }
      const [created] = await ctx.db
        .insert(reportTemplates)
        .values({
          userId: ctx.session.user.id,
          organizationId: ctx.orgId,
          name: input.newName,
          description: src.description,
          clientId: src.clientId,
          config: src.config,
          isSystem: false,
        })
        .returning();
      return created;
    }),

  bumpUsage: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(reportTemplates)
        .set({
          usageCount: sql`${reportTemplates.usageCount} + 1`,
          lastUsedAt: new Date(),
        })
        .where(
          and(
            eq(reportTemplates.id, input.id),
            ctx.orgId
              ? eq(reportTemplates.organizationId, ctx.orgId)
              : eq(reportTemplates.userId, ctx.session.user.id),
          ),
        );
      return { ok: true };
    }),

  ensureSeeded: protectedProcedure.mutation(async ({ ctx }) => {
    const existing = await ctx.db.query.reportTemplates.findFirst({
      where: and(
        ctx.orgId
          ? eq(reportTemplates.organizationId, ctx.orgId)
          : eq(reportTemplates.userId, ctx.session.user.id),
        eq(reportTemplates.isSystem, true),
      ),
    });
    if (existing) return { seeded: false };

    const { SYSTEM_TEMPLATES } = await import("@/lib/reports/defaults");
    const now = new Date();
    await ctx.db
      .insert(reportTemplates)
      .values(
        SYSTEM_TEMPLATES.map((t, idx) => ({
          userId: ctx.session.user.id,
          organizationId: ctx.orgId,
          name: t.name,
          description: t.description,
          config: t.config,
          isDefault: idx === 0,
          isSystem: true,
          updatedAt: now,
        })),
      )
      .onConflictDoNothing({
        target: [reportTemplates.userId, reportTemplates.name],
      });
    return { seeded: true };
  }),

  setDefault: moduleWriteProcedure("templates")
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify ownership before touching anything — prevents clearing all
      // defaults when the target id doesn't belong to this user.
      const target = await ctx.db.query.reportTemplates.findFirst({
        where: and(
          eq(reportTemplates.id, input.id),
          ctx.orgId
            ? eq(reportTemplates.organizationId, ctx.orgId)
            : eq(reportTemplates.userId, ctx.session.user.id),
        ),
      });
      if (!target) throw new TRPCError({ code: "NOT_FOUND" });

      return ctx.db.transaction(async (tx) => {
        await tx
          .update(reportTemplates)
          .set({ isDefault: false })
          .where(
            ctx.orgId
              ? eq(reportTemplates.organizationId, ctx.orgId)
              : eq(reportTemplates.userId, ctx.session.user.id),
          );
        const [updated] = await tx
          .update(reportTemplates)
          .set({ isDefault: true })
          .where(eq(reportTemplates.id, input.id))
          .returning();
        return updated;
      });
    }),
});
