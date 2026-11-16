// API keys are per-user
import { createHash, randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { st, tr } from "@/i18n/server-text";
import { RESOURCES } from "@/lib/api/scopes";
import { apiKeys } from "@/lib/db/schema";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

function generateApiKey(): string {
  return `tk_live_${randomBytes(36).toString("base64url")}`;
}

function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

const scopeSchema = z
  .array(
    z.union([
      z.literal("*"),
      ...RESOURCES.flatMap((r) => [
        z.literal(`${r}:read` as const),
        z.literal(`${r}:write` as const),
        z.literal(`${r}:all` as const),
      ]),
    ]),
  )
  .min(1, { error: () => st("zod.scopeRequired") });

export const apiKeysRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return ctx.db.query.apiKeys.findMany({
      where: ctx.orgId
        ? eq(apiKeys.organizationId, ctx.orgId)
        : eq(apiKeys.userId, ctx.session.user.id),
      orderBy: [desc(apiKeys.createdAt)],
      columns: {
        id: true,
        name: true,
        keyPrefix: true,
        scopes: true,
        lastUsedAt: true,
        expiresAt: true,
        isRevoked: true,
        createdAt: true,
      },
    });
  }),

  create: orgAdminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        scopes: scopeSchema,
        expiresAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const rawKey = generateApiKey();
      const keyHash = hashToken(rawKey);
      const keyPrefix = rawKey.slice(0, 16);

      await ctx.db.insert(apiKeys).values({
        userId: ctx.session.user.id,
        organizationId: ctx.orgId,
        name: input.name,
        keyHash,
        keyPrefix,
        scopes: input.scopes,
        expiresAt: input.expiresAt,
      });

      return { key: rawKey, prefix: keyPrefix };
    }),

  revoke: orgAdminProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .update(apiKeys)
        .set({ isRevoked: true, revokedAt: new Date() })
        .where(
          and(
            eq(apiKeys.id, input.id),
            ctx.orgId
              ? eq(apiKeys.organizationId, ctx.orgId)
              : eq(apiKeys.userId, ctx.session.user.id),
          ),
        );
      return { success: true };
    }),

  delete: orgAdminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      // Verify key belongs to user AND is already revoked.
      // Hard-deleting an active key would destroy the audit trail
      // (lastUsedAt, lastUsedIp, keyPrefix) and allow sidestepping the
      // revocation workflow entirely.
      const existing = await ctx.db.query.apiKeys.findFirst({
        where: and(
          eq(apiKeys.id, input.id),
          ctx.orgId
            ? eq(apiKeys.organizationId, ctx.orgId)
            : eq(apiKeys.userId, ctx.session.user.id),
        ),
      });
      if (!existing) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: await tr("serverErrors", "apiKeys.notFound"),
        });
      }
      if (!existing.isRevoked) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: await tr("serverErrors", "apiKeys.revokeFirst"),
        });
      }
      await ctx.db.delete(apiKeys).where(eq(apiKeys.id, input.id));
      return { success: true };
    }),
});
