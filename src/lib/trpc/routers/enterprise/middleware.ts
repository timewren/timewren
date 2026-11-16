import * as Sentry from "@sentry/nextjs";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { tr } from "@/i18n/server-text";
import { cached } from "@/lib/cache";
import {
  employeeProfiles,
  members,
  organizationModules,
  organizations,
  users,
} from "@/lib/db/schema";
import {
  ORG_MODULES_CACHE_TTL_SECONDS,
  orgModulesCacheKey,
} from "@/lib/modules/cache";
import {
  FREELANCE_BUNDLE,
  MODULE_KEYS,
  type ModuleKey,
} from "@/lib/modules/constants";
import {
  maxOrgRole,
  type OrgRole,
  roleCanWriteTeam,
} from "@/lib/permissions/org-role";
import { protectedProcedure } from "../../trpc";

export interface ModuleState {
  available: boolean;
  enabled: boolean;
}

export interface ModulesContext {
  raw: Map<ModuleKey, ModuleState>;
  isAvailable: (key: ModuleKey) => boolean;
  isEnabled: (key: ModuleKey) => boolean;
}

export async function resolveModules(
  db: typeof import("@/lib/db").db,
  orgId: string,
): Promise<ModulesContext> {
  // Kort Valkey-cache (ryddes ved skrivning, se modules/cache.ts). Tomme
  // svar caches ikke: en org midt i oprettelsen må ikke hænge fast i
  // fallbacken nedenfor, når rækkerne lander.
  const rows =
    (await cached(
      orgModulesCacheKey(orgId),
      ORG_MODULES_CACHE_TTL_SECONDS,
      async () => {
        const found = await db.query.organizationModules.findMany({
          where: eq(organizationModules.organizationId, orgId),
          columns: {
            moduleKey: true,
            isAvailable: true,
            isEnabled: true,
          },
        });
        return found.length > 0 ? found : null;
      },
    )) ?? [];

  // New orgs may have no module rows yet — fall back to FREELANCE_BUNDLE
  // so users aren't locked out of core features.
  if (rows.length === 0) {
    return makePermissiveModules();
  }

  const raw = new Map<ModuleKey, ModuleState>();
  for (const key of MODULE_KEYS) {
    raw.set(key, { available: false, enabled: false });
  }
  for (const row of rows) {
    if ((MODULE_KEYS as readonly string[]).includes(row.moduleKey)) {
      raw.set(row.moduleKey as ModuleKey, {
        available: row.isAvailable,
        enabled: row.isEnabled,
      });
    }
  }

  return {
    raw,
    isAvailable: (key) => raw.get(key)?.available ?? false,
    isEnabled: (key) => {
      const state = raw.get(key);
      return Boolean(state?.available && state?.enabled);
    },
  };
}

/**
 * Defensive fallback when an authenticated user has no resolvable active
 * organization (e.g., a prod user orphaned from a members-table backfill).
 * Returns a modules context where the entire FREELANCE_BUNDLE is enabled so
 * they aren't locked out of core features. Enterprise stays disabled.
 */
export function makePermissiveModules(): ModulesContext {
  const raw = new Map<ModuleKey, ModuleState>();
  for (const key of MODULE_KEYS) {
    const inFreelance = (FREELANCE_BUNDLE as readonly ModuleKey[]).includes(
      key,
    );
    raw.set(key, { available: inFreelance, enabled: inFreelance });
  }
  return {
    raw,
    isAvailable: (key) => raw.get(key)?.available ?? false,
    isEnabled: (key) => {
      const state = raw.get(key);
      return Boolean(state?.available && state?.enabled);
    },
  };
}

// OrgRole + maxOrgRole live in the client-safe helper so nav gating and
// RoleGuard share the exact same role ranking. Re-exported for existing callers.
export { maxOrgRole, type OrgRole } from "@/lib/permissions/org-role";

type EmployeeProfileRole = {
  id: string;
  role: string;
};

function findEmployeeProfile(
  db: typeof import("@/lib/db").db,
  orgId: string,
  userId: string,
): Promise<EmployeeProfileRole | undefined> {
  return db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.userId, userId),
      eq(employeeProfiles.organizationId, orgId),
    ),
    columns: { id: true, role: true },
  });
}

export async function ensureEnterpriseEmployeeProfile(
  db: typeof import("@/lib/db").db,
  orgId: string,
  userId: string,
  orgRole: OrgRole,
): Promise<EmployeeProfileRole | undefined> {
  const profile = await findEmployeeProfile(db, orgId, userId);
  if (profile || (orgRole !== "owner" && orgRole !== "admin")) return profile;

  const [created] = await db
    .insert(employeeProfiles)
    .values({
      userId,
      organizationId: orgId,
      role: "admin",
      employmentType: "full_time",
      weeklyHours: "37.0",
      workingDays: ["1", "2", "3", "4", "5"],
    })
    .onConflictDoNothing({
      target: [employeeProfiles.organizationId, employeeProfiles.userId],
    })
    .returning({ id: employeeProfiles.id, role: employeeProfiles.role });

  // Parallel batched enterprise calls can race on the lazy insert. If another
  // request won the unique constraint, reuse that row instead of surfacing a DB error.
  return created ?? findEmployeeProfile(db, orgId, userId);
}

/**
 * organizationProcedure — base procedure for all enterprise endpoints.
 *
 * 1. Extends protectedProcedure (user is already authenticated).
 * 2. Resolves the user's active organization from the session or DB.
 * 3. Verifies the user has an employeeProfile in that org.
 * 4. Injects ctx.orgId, ctx.orgRole, ctx.employeeProfileId.
 */
export const organizationProcedure = protectedProcedure.use(
  async ({ next, ctx }) => {
    let orgId: string | null = null;
    let orgRole: OrgRole | null = null;

    // Try session first (Better-Auth organization plugin stores activeOrganizationId)
    const sessionData = ctx.session as Record<string, unknown>;
    if (
      sessionData.activeOrganizationId &&
      typeof sessionData.activeOrganizationId === "string"
    ) {
      orgId = sessionData.activeOrganizationId;
    }

    // Fallback: find user's membership from DB
    if (!orgId) {
      const membership = await ctx.db.query.members.findFirst({
        where: eq(members.userId, ctx.session.user.id),
        orderBy: (members, { desc }) => [desc(members.createdAt)],
      });
      if (membership) {
        orgId = membership.organizationId;
        orgRole = membership.role as OrgRole;
      }
    }

    if (!orgId) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.mw.noActiveOrg"),
      });
    }

    // Verify membership and resolve role if not already done
    if (!orgRole) {
      const membership = await ctx.db.query.members.findFirst({
        where: and(
          eq(members.userId, ctx.session.user.id),
          eq(members.organizationId, orgId),
        ),
      });
      if (!membership) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: await tr("serverErrors", "common.notOrgMember"),
        });
      }
      orgRole = membership.role as OrgRole;
    }

    // Lazy-create a default profile for org owners/admins whose org was
    // created via Better-Auth's org plugin (which doesn't run our
    // enterprise.organization.create path). Regular members still need
    // an admin to add them, but owners/admins should never get locked
    // out of their own org.
    const profile = await ensureEnterpriseEmployeeProfile(
      ctx.db,
      orgId,
      ctx.session.user.id,
      orgRole,
    );

    if (!profile) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.mw.noEmployeeProfile"),
      });
    }

    // Combine the auth role (members) with the HR role (employeeProfiles) so
    // managers get manager-level enterprise access without losing any access an
    // org admin/owner already had. See maxOrgRole.
    orgRole = maxOrgRole(orgRole, profile.role as OrgRole);

    Sentry.setUser({ id: ctx.session.user.id });
    Sentry.setTag("orgId", orgId);

    // isAuthed already resolved modules for the active org; reuse instead of
    // hitting organization_modules a second time per request.
    const existingCtx = ctx as typeof ctx & { modules?: ModulesContext };
    const modules =
      existingCtx.modules ?? (await resolveModules(ctx.db, orgId));

    return next({
      ctx: {
        session: ctx.session,
        db: ctx.db,
        orgId,
        orgRole,
        employeeProfileId: profile.id,
        modules,
      },
    });
  },
);

/**
 * 2FA-krav for ledere/HR/admins (E12, #470). Org-indstillingen
 * requireTwoFactorForManagers håndhæves på alle manager+/admin-tiers, så en
 * leder uden 2FA stadig kan registrere egen tid men ikke godkende, se
 * teamdata eller ændre indstillinger. Aktivering af kravet kræver at den
 * handlende admin selv har 2FA (se sso-router), så ingen låser sig ude.
 */
export async function assertTwoFactorIfRequired(
  db: typeof import("@/lib/db").db,
  orgId: string,
  userId: string,
): Promise<void> {
  const [org, user] = await Promise.all([
    db.query.organizations.findFirst({
      where: eq(organizations.id, orgId),
      columns: { requireTwoFactorForManagers: true },
    }),
    db.query.users.findFirst({
      where: eq(users.id, userId),
      columns: { twoFactorEnabled: true },
    }),
  ]);
  if (org?.requireTwoFactorForManagers && !user?.twoFactorEnabled) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: await tr("serverErrors", "enterprise.mw.twoFactorRequired"),
    });
  }
}

/**
 * orgManagerProcedure — requires "manager", "admin", or "owner" role.
 * SKRIVE-tier: godkend/afvis/postér. "hr" afvises eksplicit (read-all-rolle,
 * se org-role.ts) — brug orgManagerReadProcedure til lister og rapporter.
 */
export const orgManagerProcedure = organizationProcedure.use(
  async ({ next, ctx }) => {
    if (!roleCanWriteTeam(ctx.orgRole)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          ctx.orgRole === "hr"
            ? await tr("serverErrors", "enterprise.mw.hrReadOnly")
            : await tr("serverErrors", "enterprise.mw.managerRequired"),
      });
    }
    await assertTwoFactorIfRequired(ctx.db, ctx.orgId, ctx.session.user.id);
    return next({ ctx });
  },
);

/**
 * orgManagerReadProcedure — LÆSE-tier: manager, hr, admin eller owner.
 * Til rapporter, oversigter og lister; hvem der ses afgøres af
 * getVisibleScope (src/lib/enterprise/scope.ts).
 */
export const orgManagerReadProcedure = organizationProcedure.use(
  async ({ next, ctx }) => {
    if (!roleCanWriteTeam(ctx.orgRole) && ctx.orgRole !== "hr") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.mw.viewRequiresRole"),
      });
    }
    await assertTwoFactorIfRequired(ctx.db, ctx.orgId, ctx.session.user.id);
    return next({ ctx });
  },
);

/**
 * orgAdminProcedure — requires "admin" or "owner" role.
 */
export const orgAdminProcedure = organizationProcedure.use(
  async ({ next, ctx }) => {
    if (ctx.orgRole !== "admin" && ctx.orgRole !== "owner") {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: await tr("serverErrors", "enterprise.mw.ownersAdminsOnly"),
      });
    }
    await assertTwoFactorIfRequired(ctx.db, ctx.orgId, ctx.session.user.id);
    return next({ ctx });
  },
);
