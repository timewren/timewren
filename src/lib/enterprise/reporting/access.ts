/**
 * Adgang til enterprise-rapporter (E4, #462):
 *   manager  → egne afdelinger/reports (getVisibleScope), ikke løn
 *   hr/admin/owner → hele org'en inkl. lønrapport
 * Cron'en (planlagt mail) genskaber ejerens scope via resolveScopeCtxForUser
 * så en leder aldrig får mailet mere end vedkommende selv kan se.
 */
import { and, eq } from "drizzle-orm";
import type { db as dbClient } from "@/lib/db";
import { employeeProfiles } from "@/lib/db/schema";
import { type OrgRole, roleSeesWholeOrg } from "@/lib/permissions/org-role";
import { resolveEffectiveOrgRole } from "@/lib/permissions/role-access";
import type { ScopeCtx } from "../scope";
import { type EnterpriseReportType, REPORT_TYPE_DEFINITIONS } from "./config";

type Db = typeof dbClient;

/** Må rollen køre rapporttypen? (løn = kun HR/admin/owner) */
export function canRunReportType(
  role: OrgRole | string | null | undefined,
  type: EnterpriseReportType,
): boolean {
  if (!REPORT_TYPE_DEFINITIONS[type].restricted) return true;
  return roleSeesWholeOrg(role as OrgRole);
}

/** Må rollen gemme org-delte skabeloner (alle i org'en ser dem)? */
export function canShareTemplates(
  role: OrgRole | string | null | undefined,
): boolean {
  return roleSeesWholeOrg(role as OrgRole);
}

/** Genskab ScopeCtx for en bruger uden for en request (cron). */
export async function resolveScopeCtxForUser(
  db: Db,
  userId: string,
  orgId: string,
): Promise<ScopeCtx | null> {
  const [role, profile] = await Promise.all([
    resolveEffectiveOrgRole(db, userId, orgId),
    db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.userId, userId),
        eq(employeeProfiles.organizationId, orgId),
      ),
      columns: { id: true },
    }),
  ]);
  if (!profile) return null;
  return {
    orgId,
    orgRole: role,
    employeeProfileId: profile.id,
    session: { user: { id: userId } },
  };
}
