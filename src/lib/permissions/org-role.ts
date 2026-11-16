// src/lib/permissions/org-role.ts
//
// Pure (client-safe) org-role helpers shared by the enterprise tRPC middleware,
// rolePermissions, nav gating and RoleGuard. Keep this file free of server
// imports — it is bundled into client components.

/**
 * Organization roles — aligned with Better-Auth organization plugin.
 * "owner" maps to the org creator; "admin" and "manager" have elevated access;
 * "member" is the default role.
 *
 * "hr" (#464) er en *parallel* read-all-rolle: HR/lønansvarlig ser alle
 * medarbejdere, fravær, saldi og rapporter i hele organisationen, men har
 * INGEN skriverettigheder på timesedler, fravær, projekter eller profiler.
 * Rollen lever kun i employee_profiles.role (members.role forbliver
 * "member"). I rangordenen ligger hr mellem manager og admin, så alle
 * læse-gates med minRole "manager" åbner for hr — skrive-gates
 * (orgManagerProcedure / orgAdminProcedure) tjekker eksplicit via
 * roleCanWriteTeam og afviser hr.
 */
export type OrgRole = "owner" | "admin" | "hr" | "manager" | "member";

export const ORG_ROLES: readonly OrgRole[] = [
  "owner",
  "admin",
  "hr",
  "manager",
  "member",
];

/**
 * Two role systems coexist: `members.role` (owner/admin/member — auth & billing)
 * and `employeeProfiles.role` (admin/hr/manager/member — HR org-chart). The
 * "manager" and "hr" roles only live in employeeProfiles, so deriving the
 * enterprise role from members alone left every manager stuck at "member"
 * (they couldn't approve absence or see their team). We take the HIGHER of
 * the two roles so no existing access regresses while the manager capability
 * is unlocked.
 */
export const ORG_ROLE_RANK: Record<OrgRole, number> = {
  owner: 5,
  admin: 4,
  hr: 3,
  manager: 2,
  member: 1,
};

export function maxOrgRole(a: OrgRole, b: OrgRole): OrgRole {
  return ORG_ROLE_RANK[a] >= ORG_ROLE_RANK[b] ? a : b;
}

/** True if `role` is at least `minRole` (member < manager < hr < admin < owner). */
export function roleSatisfies(
  role: OrgRole | null | undefined,
  minRole: OrgRole,
): boolean {
  if (!role) return false;
  return ORG_ROLE_RANK[role] >= ORG_ROLE_RANK[minRole];
}

/**
 * Må rollen godkende/afvise timesedler og fravær samt postere overtid?
 * hr er bevidst udeladt — read-all, ingen writes.
 */
export function roleCanWriteTeam(role: OrgRole | null | undefined): boolean {
  return role === "manager" || role === "admin" || role === "owner";
}

/** Ser rollen hele organisationen (ikke kun egne afdelinger/reports)? */
export function roleSeesWholeOrg(role: OrgRole | null | undefined): boolean {
  return role === "hr" || role === "admin" || role === "owner";
}
