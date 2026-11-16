// src/lib/permissions/role-access.ts
//
// Server-side resolution + enforcement of the per-org rolePermissions system
// (organization/permissions page + usePermission hook). Each (org, role,
// module) has an access level: "none" | "read" | "write". Owners always have
// "write". A missing row defaults to "write" (permissive) — mirroring
// rolePermissions.getMyPermissions / usePermission, so enforcement only bites
// where an owner has explicitly restricted a role.

import { and, eq } from "drizzle-orm";
import type { db as defaultDb } from "@/lib/db";
import { employeeProfiles, members, rolePermissions } from "@/lib/db/schema";
import { maxOrgRole, type OrgRole } from "@/lib/permissions/org-role";

type Db = typeof defaultDb;

/**
 * The caller's effective org role: the HIGHER of members.role (auth) and
 * employeeProfiles.role (HR) — same rule as the enterprise middleware, so a
 * "manager" (which only exists in employeeProfiles) is looked up under the
 * manager row in rolePermissions instead of silently falling back to member.
 */
export async function resolveEffectiveOrgRole(
  db: Db,
  userId: string,
  orgId: string,
): Promise<OrgRole> {
  const [membership, profile] = await Promise.all([
    db.query.members.findFirst({
      where: and(eq(members.userId, userId), eq(members.organizationId, orgId)),
      columns: { role: true },
    }),
    db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.userId, userId),
        eq(employeeProfiles.organizationId, orgId),
      ),
      columns: { role: true },
    }),
  ]);
  return maxOrgRole(
    (membership?.role ?? "member") as OrgRole,
    (profile?.role ?? "member") as OrgRole,
  );
}

export type AccessLevel = "none" | "read" | "write";

export const PERMISSION_MODULE_KEYS = [
  "time",
  "tasks",
  "invoices",
  "klippekort",
  "reports",
  "settings",
  "clients",
  "projects",
  "templates",
  "calendar",
  "enterprise",
] as const;

export type PermissionModuleKey = (typeof PERMISSION_MODULE_KEYS)[number];

/**
 * The caller's effective access level for a module in the given org. Owners get
 * "write"; everyone else is looked up by their role, defaulting to "write".
 */
export async function resolveModuleAccess(
  db: Db,
  userId: string,
  orgId: string,
  moduleKey: PermissionModuleKey,
): Promise<AccessLevel> {
  const role = await resolveEffectiveOrgRole(db, userId, orgId);
  if (role === "owner") return "write";

  const perm = await db.query.rolePermissions.findFirst({
    where: and(
      eq(rolePermissions.organizationId, orgId),
      eq(rolePermissions.roleName, role),
      eq(rolePermissions.moduleKey, moduleKey),
    ),
    columns: { accessLevel: true },
  });
  return (perm?.accessLevel as AccessLevel | undefined) ?? "write";
}

/** True if `level` satisfies the `required` access level. */
export function accessSatisfies(
  level: AccessLevel,
  required: "read" | "write",
): boolean {
  if (required === "read") return level === "read" || level === "write";
  return level === "write";
}
