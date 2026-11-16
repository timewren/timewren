import { TRPCError } from "@trpc/server";
import { and, count, desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import type { db as DbType } from "@/lib/db";
import {
  adminActivityLogs,
  emailForwardingLogs,
  emailForwardingRules,
} from "@/lib/db/schema";
import { adminProcedure, router, supporterProcedure } from "../trpc";

async function logAdminAction(
  db: typeof DbType,
  adminUserId: string,
  action: string,
  details: Record<string, unknown> | null,
  headers: Headers | null,
) {
  const ipAddress =
    headers?.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers?.get("x-real-ip") ||
    null;
  const userAgent = headers?.get("user-agent") || null;

  await db.insert(adminActivityLogs).values({
    adminUserId,
    action,
    targetUserId: null,
    details,
    ipAddress,
    userAgent,
  });
}

export const emailForwardingRouter = router({
  // ============================================
  // List forwarding rules (supporters + admins)
  // ============================================
  listRules: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      }),
    )
    .query(async ({ ctx, input }) => {
      const rules = await ctx.db
        .select()
        .from(emailForwardingRules)
        .orderBy(desc(emailForwardingRules.createdAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(emailForwardingRules);

      return {
        rules,
        total: totalResult?.count ?? 0,
      };
    }),

  // ============================================
  // Get single rule
  // ============================================
  getRule: supporterProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      const rule = await ctx.db.query.emailForwardingRules.findFirst({
        where: eq(emailForwardingRules.id, input.id),
      });

      if (!rule) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "emailForwarding.ruleNotFound"),
        });
      }

      return rule;
    }),

  // ============================================
  // Create rule (admin only)
  // ============================================
  createRule: adminProcedure
    .input(
      z.object({
        name: z
          .string()
          .min(1, { error: () => st("zod.nameRequired") })
          .max(255),
        description: z.string().optional(),
        fromPattern: z.string().max(255).default("*"),
        toAddress: z
          .string()
          .email({ error: () => st("zod.invalidEmailDash") })
          .max(255),
        toPattern: z.string().max(255).optional(),
        subjectPrefix: z.string().max(100).optional(),
        forwardAttachments: z.boolean().default(true),
        isActive: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const [rule] = await ctx.db
        .insert(emailForwardingRules)
        .values({
          name: input.name,
          description: input.description || null,
          fromPattern: input.fromPattern,
          toAddress: input.toAddress,
          toPattern: input.toPattern || null,
          subjectPrefix: input.subjectPrefix || null,
          forwardAttachments: input.forwardAttachments,
          isActive: input.isActive,
          createdBy: ctx.session.user.id,
        })
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "create_forwarding_rule",
        { ruleId: rule.id, name: input.name, fromPattern: input.fromPattern },
        ctx.headers,
      );

      return { success: true, rule };
    }),

  // ============================================
  // Update rule (admin only)
  // ============================================
  updateRule: adminProcedure
    .input(
      z.object({
        id: z.string().uuid(),
        name: z.string().min(1).max(255).optional(),
        description: z.string().optional(),
        fromPattern: z.string().min(1).max(255).optional(),
        toAddress: z.string().email().max(255).optional(),
        toPattern: z.string().max(255).nullable().optional(),
        subjectPrefix: z.string().max(100).nullable().optional(),
        forwardAttachments: z.boolean().optional(),
        isActive: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.emailForwardingRules.findFirst({
        where: eq(emailForwardingRules.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "emailForwarding.ruleNotFound"),
        });
      }

      const { id, ...updates } = input;
      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (updates.name !== undefined) patch.name = updates.name;
      if (updates.description !== undefined)
        patch.description = updates.description;
      if (updates.fromPattern !== undefined)
        patch.fromPattern = updates.fromPattern;
      if (updates.toAddress !== undefined) patch.toAddress = updates.toAddress;
      if (updates.toPattern !== undefined) patch.toPattern = updates.toPattern;
      if (updates.subjectPrefix !== undefined)
        patch.subjectPrefix = updates.subjectPrefix;
      if (updates.forwardAttachments !== undefined)
        patch.forwardAttachments = updates.forwardAttachments;
      if (updates.isActive !== undefined) patch.isActive = updates.isActive;

      const [updated] = await ctx.db
        .update(emailForwardingRules)
        .set(patch)
        .where(eq(emailForwardingRules.id, id))
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "update_forwarding_rule",
        { ruleId: id, changes: updates },
        ctx.headers,
      );

      return { success: true, rule: updated };
    }),

  // ============================================
  // Delete rule (admin only)
  // ============================================
  deleteRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.emailForwardingRules.findFirst({
        where: eq(emailForwardingRules.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "emailForwarding.ruleNotFound"),
        });
      }

      await ctx.db
        .delete(emailForwardingRules)
        .where(eq(emailForwardingRules.id, input.id));

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_forwarding_rule",
        { ruleId: input.id, name: existing.name },
        ctx.headers,
      );

      return { success: true };
    }),

  // ============================================
  // Toggle rule active/inactive (admin only)
  // ============================================
  toggleRule: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await ctx.db.query.emailForwardingRules.findFirst({
        where: eq(emailForwardingRules.id, input.id),
      });

      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "emailForwarding.ruleNotFound"),
        });
      }

      const [updated] = await ctx.db
        .update(emailForwardingRules)
        .set({
          isActive: !existing.isActive,
          updatedAt: new Date(),
        })
        .where(eq(emailForwardingRules.id, input.id))
        .returning();

      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "toggle_forwarding_rule",
        { ruleId: input.id, isActive: updated.isActive },
        ctx.headers,
      );

      return { success: true, isActive: updated.isActive };
    }),

  // ============================================
  // List forwarding logs (supporters + admins)
  // ============================================
  listLogs: supporterProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        status: z
          .enum(["forwarded", "failed", "no_match", "skipped"])
          .optional(),
        daysBack: z.number().min(1).max(365).default(7),
        ruleId: z.string().uuid().optional(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const conditions = [gte(emailForwardingLogs.receivedAt, since)];

      if (input.status) {
        conditions.push(eq(emailForwardingLogs.status, input.status));
      }
      if (input.ruleId) {
        conditions.push(eq(emailForwardingLogs.ruleId, input.ruleId));
      }

      const logs = await ctx.db
        .select({
          id: emailForwardingLogs.id,
          ruleId: emailForwardingLogs.ruleId,
          fromAddress: emailForwardingLogs.fromAddress,
          toAddress: emailForwardingLogs.toAddress,
          originalTo: emailForwardingLogs.originalTo,
          subject: emailForwardingLogs.subject,
          status: emailForwardingLogs.status,
          errorMessage: emailForwardingLogs.errorMessage,
          receivedAt: emailForwardingLogs.receivedAt,
          forwardedAt: emailForwardingLogs.forwardedAt,
          ruleName: emailForwardingRules.name,
        })
        .from(emailForwardingLogs)
        .leftJoin(
          emailForwardingRules,
          eq(emailForwardingLogs.ruleId, emailForwardingRules.id),
        )
        .where(and(...conditions))
        .orderBy(desc(emailForwardingLogs.receivedAt))
        .limit(input.limit)
        .offset(input.offset);

      const [totalResult] = await ctx.db
        .select({ count: count() })
        .from(emailForwardingLogs)
        .where(and(...conditions));

      return {
        logs,
        total: totalResult?.count ?? 0,
      };
    }),

  // ============================================
  // Get aggregated stats (supporters + admins)
  // ============================================
  getLogStats: supporterProcedure
    .input(
      z.object({
        daysBack: z.number().min(1).max(365).default(7),
      }),
    )
    .query(async ({ ctx, input }) => {
      const since = new Date();
      since.setDate(since.getDate() - input.daysBack);

      const [activeRulesResult] = await ctx.db
        .select({ count: count() })
        .from(emailForwardingRules)
        .where(eq(emailForwardingRules.isActive, true));

      const statusCounts = await ctx.db
        .select({
          status: emailForwardingLogs.status,
          count: count(),
        })
        .from(emailForwardingLogs)
        .where(gte(emailForwardingLogs.receivedAt, since))
        .groupBy(emailForwardingLogs.status);

      let forwarded = 0;
      let failed = 0;
      let no_match = 0;
      let skipped = 0;

      for (const row of statusCounts) {
        if (row.status === "forwarded") forwarded = row.count;
        else if (row.status === "failed") failed = row.count;
        else if (row.status === "no_match") no_match = row.count;
        else if (row.status === "skipped") skipped = row.count;
      }

      return {
        activeRules: activeRulesResult?.count ?? 0,
        forwarded,
        failed,
        no_match,
        skipped,
      };
    }),
});
