import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { changelogs, featureFlags, users } from "@/lib/db/schema";
import type { FeatureFlagKey } from "@/lib/feature-flags";
import { FEATURE_FLAG_KEYS } from "@/lib/feature-flags";
import { adminProcedure, router, supporterProcedure } from "../../trpc";
import { logAdminAction } from "./shared";

export const adminFeaturesRouter = router({
  // ============================================
  // Feature Flags
  // Supporters can view, Admins can toggle
  // ============================================

  getFeatureFlags: supporterProcedure.query(async ({ ctx }) => {
    await logAdminAction(
      ctx.db,
      ctx.session.user.id,
      "view_feature_flags",
      null,
      null,
      ctx.headers,
    );

    const flags = await ctx.db
      .select({
        key: featureFlags.key,
        enabled: featureFlags.enabled,
        description: featureFlags.description,
        updatedAt: featureFlags.updatedAt,
        updatedBy: featureFlags.updatedBy,
        updaterName: users.name,
      })
      .from(featureFlags)
      .leftJoin(users, eq(featureFlags.updatedBy, users.id));

    return flags.map((f) => ({
      key: f.key,
      enabled: f.enabled,
      description: f.description,
      updatedAt: f.updatedAt,
      updater: f.updatedBy ? { id: f.updatedBy, name: f.updaterName } : null,
    }));
  }),

  toggleFeatureFlag: adminProcedure
    .input(
      z.object({
        key: z
          .string()
          .refine(
            (k): k is FeatureFlagKey =>
              FEATURE_FLAG_KEYS.includes(k as FeatureFlagKey),
            "Ugyldig feature flag key",
          ),
        enabled: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "toggle_feature_flag",
        null,
        { key: input.key, enabled: input.enabled },
        ctx.headers,
      );

      await ctx.db
        .insert(featureFlags)
        .values({
          key: input.key,
          enabled: input.enabled,
          updatedAt: new Date(),
          updatedBy: ctx.session.user.id,
        })
        .onConflictDoUpdate({
          target: featureFlags.key,
          set: {
            enabled: input.enabled,
            updatedAt: new Date(),
            updatedBy: ctx.session.user.id,
          },
        });

      return {
        success: true,
        message: `Feature "${input.key}" er nu ${input.enabled ? "aktiveret" : "deaktiveret"}`,
      };
    }),

  // ============================================
  // Changelogs (What's New)
  // ============================================

  listChangelogs: supporterProcedure.query(async ({ ctx }) => {
    return ctx.db
      .select({
        id: changelogs.id,
        version: changelogs.version,
        title: changelogs.title,
        content: changelogs.content,
        publishedAt: changelogs.publishedAt,
        createdAt: changelogs.createdAt,
      })
      .from(changelogs)
      .orderBy(desc(changelogs.publishedAt));
  }),

  createChangelog: adminProcedure
    .input(
      z.object({
        version: z.string().min(1).max(20),
        title: z.string().min(1).max(255),
        content: z.string().min(1),
        publishedAt: z.date().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "create_changelog",
        null,
        { version: input.version, title: input.title },
        ctx.headers,
      );

      const [row] = await ctx.db
        .insert(changelogs)
        .values({
          version: input.version,
          title: input.title,
          content: input.content,
          publishedAt: input.publishedAt ?? new Date(),
        })
        .returning();

      return row;
    }),

  deleteChangelog: adminProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await logAdminAction(
        ctx.db,
        ctx.session.user.id,
        "delete_changelog",
        null,
        { id: input.id },
        ctx.headers,
      );

      await ctx.db.delete(changelogs).where(eq(changelogs.id, input.id));
      return { success: true };
    }),
});
