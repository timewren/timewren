import { copenhagenToday } from "@/lib/time/copenhagen";
/**
 * Hvem er "lederen" for en medarbejder? Fælles opslag for leder-hændelser
 * (timeseddel indsendt, fravær anmodet, sygemelding, compliance):
 *
 *   nærmeste leder (employee_profiles.managerId)
 *   ∪ aktive afdelingsledere/stedfortrædere (department_managers, E6)
 *   → ellers org'ens ejer/admins (så intet sidder ubemærket i små teams)
 */

import { and, eq, or } from "drizzle-orm";
import type { db as dbClient } from "@/lib/db";
import { departmentManagers, employeeProfiles, members } from "@/lib/db/schema";
import { isManagershipActive } from "@/lib/enterprise/scope";

type Db = typeof dbClient;

export async function resolveManagerRecipientIds(
  db: Db,
  params: { orgId: string; employeeUserId: string; excludeUserId?: string },
): Promise<string[]> {
  const profile = await db.query.employeeProfiles.findFirst({
    where: and(
      eq(employeeProfiles.userId, params.employeeUserId),
      eq(employeeProfiles.organizationId, params.orgId),
    ),
    columns: { managerId: true, departmentId: true },
    with: { manager: { columns: { userId: true, isActive: true } } },
  });

  const ids = new Set<string>();
  if (profile?.manager?.userId && profile.manager.isActive !== false) {
    ids.add(profile.manager.userId);
  }
  if (profile?.departmentId) {
    const today = copenhagenToday();
    const leads = await db.query.departmentManagers.findMany({
      where: and(
        eq(departmentManagers.organizationId, params.orgId),
        eq(departmentManagers.departmentId, profile.departmentId),
      ),
      columns: {
        userId: true,
        departmentId: true,
        role: true,
        validFrom: true,
        validTo: true,
      },
    });
    for (const lead of leads) {
      if (isManagershipActive(lead, today)) ids.add(lead.userId);
    }
  }
  ids.delete(params.excludeUserId ?? "");

  if (ids.size === 0) {
    const admins = await db.query.members.findMany({
      where: and(
        eq(members.organizationId, params.orgId),
        or(eq(members.role, "owner"), eq(members.role, "admin")),
      ),
      columns: { userId: true },
    });
    for (const a of admins) {
      if (a.userId !== params.excludeUserId) ids.add(a.userId);
    }
  }
  return Array.from(ids);
}

/** Org'ens ejer/admins — til eskalering. */
export async function resolveOrgAdminIds(
  db: Db,
  orgId: string,
): Promise<string[]> {
  const admins = await db.query.members.findMany({
    where: and(
      eq(members.organizationId, orgId),
      or(eq(members.role, "owner"), eq(members.role, "admin")),
    ),
    columns: { userId: true },
  });
  return Array.from(new Set(admins.map((a) => a.userId)));
}
