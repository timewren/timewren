import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { rolePermissions } from "@/lib/db/schema";
import type { OrgRole } from "@/lib/permissions/org-role";
import {
  PERMISSION_MODULE_KEYS,
  resolveEffectiveOrgRole,
} from "@/lib/permissions/role-access";
import { orgAdminProcedure, protectedProcedure, router } from "../trpc";

const MODULE_KEYS = PERMISSION_MODULE_KEYS;

export const rolePermissionsRouter = router({
  /**
   * getMyRole — the caller's effective org role, taking the HIGHER of
   * members.role (auth) and employeeProfiles.role (HR) exactly like the
   * enterprise middleware does (see maxOrgRole). Drives client-side nav
   * gating (minRole / freelancerOnly) and RoleGuard. Users without an org
   * are solo freelancers → "owner" so nothing is hidden for them.
   */
  getMyRole: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return { role: "owner" as OrgRole };
    return {
      role: await resolveEffectiveOrgRole(
        ctx.db,
        ctx.session.user.id,
        ctx.orgId,
      ),
    };
  }),

  getForOrg: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) return [];
    return ctx.db.query.rolePermissions.findMany({
      where: eq(rolePermissions.organizationId, ctx.orgId),
    });
  }),

  getMyPermissions: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.orgId) {
      return MODULE_KEYS.map((key) => ({
        moduleKey: key,
        accessLevel: "write" as const,
      }));
    }

    // Effective role (members ∨ employeeProfiles) so the "manager" column in
    // Adgangsstyring actually applies to managers — and matches the server-side
    // enforcement in resolveModuleAccess.
    const role = await resolveEffectiveOrgRole(
      ctx.db,
      ctx.session.user.id,
      ctx.orgId,
    );

    if (role === "owner") {
      return MODULE_KEYS.map((key) => ({
        moduleKey: key,
        accessLevel: "write" as const,
      }));
    }

    const perms = await ctx.db.query.rolePermissions.findMany({
      where: and(
        eq(rolePermissions.organizationId, ctx.orgId),
        eq(rolePermissions.roleName, role),
      ),
    });

    const permMap = new Map(perms.map((p) => [p.moduleKey, p.accessLevel]));

    return MODULE_KEYS.map((key) => ({
      moduleKey: key,
      accessLevel: (permMap.get(key) || "write") as "none" | "read" | "write",
    }));
  }),

  update: orgAdminProcedure
    .input(
      z.object({
        roleName: z.enum(["admin", "hr", "manager", "member"]),
        moduleKey: z.enum(MODULE_KEYS),
        accessLevel: z.enum(["none", "read", "write"]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      if (!ctx.orgId) return;

      const existing = await ctx.db.query.rolePermissions.findFirst({
        where: and(
          eq(rolePermissions.organizationId, ctx.orgId),
          eq(rolePermissions.roleName, input.roleName),
          eq(rolePermissions.moduleKey, input.moduleKey),
        ),
      });

      if (existing) {
        await ctx.db
          .update(rolePermissions)
          .set({ accessLevel: input.accessLevel, updatedAt: new Date() })
          .where(eq(rolePermissions.id, existing.id));
      } else {
        await ctx.db.insert(rolePermissions).values({
          organizationId: ctx.orgId,
          roleName: input.roleName,
          moduleKey: input.moduleKey,
          accessLevel: input.accessLevel,
        });
      }

      return { success: true };
    }),
});
