import { and, count, eq } from "drizzle-orm";
import { z } from "zod";
import { st } from "@/i18n/sync-text";
import {
  members,
  mobilePushTokens,
  organizationModules,
  organizations,
  rolePermissions,
  subscriptions,
} from "@/lib/db/schema";
import {
  type AccessLevel,
  PERMISSION_MODULE_KEYS,
  resolveEffectiveOrgRole,
} from "@/lib/permissions/role-access";
import { protectedProcedure, router } from "../trpc";

export type MobileTier = "solo" | "team" | "enterprise";

/** Planer uden team — appen opfører sig som solo for dem. */
const SINGLE_USER_TIERS = new Set(["solo", "privat", "free"]);

/**
 * Udled appens "tier" fra org-tilstand. Ren funktion så den kan testes:
 *  - enterprise: enterprise-modulet er slået til
 *  - team: org'ens abonnement er ikke en 1-bruger-plan (solo/privat/free),
 *    eller org'en har ≥2 medlemmer
 *  - solo: alt andet (inkl. brugere uden org)
 */
export function deriveMobileTier(input: {
  enterpriseEnabled: boolean;
  planTier: string | null | undefined;
  memberCount: number;
}): MobileTier {
  if (input.enterpriseEnabled) return "enterprise";
  const isSingleUserPlan =
    !input.planTier || SINGLE_USER_TIERS.has(input.planTier);
  if (!isSingleUserPlan || input.memberCount >= 2) {
    return "team";
  }
  return "solo";
}

const pushTokenSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .regex(/^Expo(nent)?PushToken\[[^\]]+\]$/, {
    error: () => st("zod.invalidExpoToken"),
  });

export const mobileRouter = router({
  getCapabilities: protectedProcedure.query(async ({ ctx }) => {
    const userId = ctx.session.user.id;

    // Find active org from session (already resolved by isAuthed middleware)
    let orgId = ctx.orgId ?? null;

    if (!orgId) {
      const membership = await ctx.db.query.members.findFirst({
        where: eq(members.userId, userId),
        orderBy: (members, { desc }) => [desc(members.createdAt)],
      });
      orgId = membership?.organizationId ?? null;
    }

    if (!orgId) {
      return {
        tier: "solo" as MobileTier,
        modules: {} as Record<string, { available: boolean; enabled: boolean }>,
        role: "member" as const,
        org: null,
        permissions: Object.fromEntries(
          PERMISSION_MODULE_KEYS.map((key) => [key, "write" as AccessLevel]),
        ) as Record<string, AccessLevel>,
      };
    }

    const [membership, moduleRows, org, [memberCountRow], subscription] =
      await Promise.all([
        ctx.db.query.members.findFirst({
          where: and(
            eq(members.userId, userId),
            eq(members.organizationId, orgId),
          ),
        }),
        ctx.db.query.organizationModules.findMany({
          where: eq(organizationModules.organizationId, orgId),
        }),
        ctx.db.query.organizations.findFirst({
          where: eq(organizations.id, orgId),
          columns: { id: true, name: true, slug: true },
        }),
        ctx.db
          .select({ value: count() })
          .from(members)
          .where(eq(members.organizationId, orgId)),
        ctx.db.query.subscriptions.findFirst({
          where: eq(subscriptions.organizationId, orgId),
          columns: { planTier: true },
        }),
      ]);

    const modules: Record<string, { available: boolean; enabled: boolean }> =
      {};
    for (const row of moduleRows) {
      modules[row.moduleKey] = {
        available: row.isAvailable,
        enabled: row.isEnabled,
      };
    }

    // Effektive modul-rettigheder — samme udledning som
    // rolePermissions.getMyPermissions (owner = alt, ellers rolle-opslag med
    // "write" som default), men som et map appen kan slå direkte op i.
    const effectiveRole = await resolveEffectiveOrgRole(ctx.db, userId, orgId);
    const permissions: Record<string, AccessLevel> = {};
    if (effectiveRole === "owner") {
      for (const key of PERMISSION_MODULE_KEYS) permissions[key] = "write";
    } else {
      const perms = await ctx.db.query.rolePermissions.findMany({
        where: and(
          eq(rolePermissions.organizationId, orgId),
          eq(rolePermissions.roleName, effectiveRole),
        ),
      });
      const permMap = new Map(perms.map((p) => [p.moduleKey, p.accessLevel]));
      for (const key of PERMISSION_MODULE_KEYS) {
        permissions[key] = (permMap.get(key) as AccessLevel) ?? "write";
      }
    }

    return {
      tier: deriveMobileTier({
        enterpriseEnabled: Boolean(modules.enterprise?.enabled),
        planTier: subscription?.planTier,
        memberCount: Number(memberCountRow?.value ?? 0),
      }),
      modules,
      role: (membership?.role ?? "member") as string,
      org: org ? { id: org.id, name: org.name, slug: org.slug } : null,
      permissions,
    };
  }),

  /**
   * Registrér (eller gen-registrér) enhedens Expo push-token. Upsert på
   * token: en enhed der skifter bruger får rækken flyttet, og et token der
   * tidligere blev deaktiveret (DeviceNotRegistered) genoplives.
   */
  registerPushToken: protectedProcedure
    .input(
      z.object({
        token: pushTokenSchema,
        platform: z.enum(["ios", "android"]),
        deviceName: z.string().trim().max(200).optional(),
        appVersion: z.string().trim().max(50).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const now = new Date();
      const values = {
        userId: ctx.session.user.id,
        organizationId: ctx.orgId ?? null,
        platform: input.platform,
        deviceName: input.deviceName ?? null,
        appVersion: input.appVersion ?? null,
        isActive: true,
        lastSeenAt: now,
        updatedAt: now,
      };
      const [row] = await ctx.db
        .insert(mobilePushTokens)
        .values({ token: input.token, ...values })
        .onConflictDoUpdate({
          target: mobilePushTokens.token,
          set: values,
        })
        .returning({ id: mobilePushTokens.id });
      return { id: row.id };
    }),

  /** Afmeld enhedens token (logout / slået fra i app-indstillinger). */
  unregisterPushToken: protectedProcedure
    .input(z.object({ token: pushTokenSchema }))
    .mutation(async ({ ctx, input }) => {
      // Kun brugerens egne tokens — et token må ikke kunne slukkes af andre.
      const result = await ctx.db
        .update(mobilePushTokens)
        .set({ isActive: false, updatedAt: new Date() })
        .where(
          and(
            eq(mobilePushTokens.token, input.token),
            eq(mobilePushTokens.userId, ctx.session.user.id),
          ),
        )
        .returning({ id: mobilePushTokens.id });
      return { removed: result.length > 0 };
    }),
});
