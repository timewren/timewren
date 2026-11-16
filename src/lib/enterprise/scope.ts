import { tr } from "@/i18n/server-text";
import { copenhagenToday } from "@/lib/time/copenhagen";
/**
 * Leder-scoping (#464): hvem må en bruger se/behandle i organisationen?
 *
 *   owner/admin/hr  → alle profiler i org'en (hr er read-only, se org-role.ts)
 *   manager         → profiler i afdelinger hvor brugeren er lead/deputy med
 *                     gyldig periode ∪ profiler med managerId = egen profil
 *                     ∪ sig selv
 *   member          → sig selv
 *
 * Den rene del (resolveVisibleProfileIds) er testbar uden DB; getVisibleScope
 * henter profiler + department_managers og returnerer et sæt id'er som
 * routerne bruger i deres egne queries (inArray) i stedet for de tidligere
 * dublerede `managerId = ctx.employeeProfileId`-checks.
 */

import { TRPCError } from "@trpc/server";
import { and, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { db as dbClient } from "@/lib/db";
import { departmentManagers, employeeProfiles } from "@/lib/db/schema";
import { type OrgRole, roleSeesWholeOrg } from "@/lib/permissions/org-role";

type Db = typeof dbClient;

export interface ScopeCtx {
  orgId: string;
  orgRole: OrgRole | string;
  employeeProfileId: string;
  session: { user: { id: string } };
}

export interface ScopeProfile {
  id: string;
  userId: string;
  departmentId: string | null;
  managerId: string | null;
  isActive: boolean;
}

export interface Managership {
  departmentId: string;
  role: string; // lead | deputy
  validFrom: string | null; // YYYY-MM-DD
  validTo: string | null; // YYYY-MM-DD
}

/** Gælder lederskabet i dag? Åbne ender (null) = ubegrænset. */
export function isManagershipActive(m: Managership, today: string): boolean {
  if (m.validFrom && m.validFrom > today) return false;
  if (m.validTo && m.validTo < today) return false;
  return true;
}

export interface ResolveScopeInput {
  role: OrgRole | string;
  selfProfileId: string;
  profiles: ScopeProfile[];
  managerships: Managership[];
  today: string;
}

export interface ResolvedScope {
  /** true = hele organisationen (ingen filtrering nødvendig) */
  all: boolean;
  profileIds: Set<string>;
}

/** Ren beregning af synlige profil-id'er — se filens hoved. */
export function resolveVisibleProfileIds(
  input: ResolveScopeInput,
): ResolvedScope {
  if (roleSeesWholeOrg(input.role as OrgRole)) {
    return { all: true, profileIds: new Set(input.profiles.map((p) => p.id)) };
  }
  const ids = new Set<string>([input.selfProfileId]);
  if (input.role === "manager") {
    const deptIds = new Set(
      input.managerships
        .filter((m) => isManagershipActive(m, input.today))
        .map((m) => m.departmentId),
    );
    for (const p of input.profiles) {
      if (p.managerId === input.selfProfileId) ids.add(p.id);
      else if (p.departmentId && deptIds.has(p.departmentId)) ids.add(p.id);
    }
  }
  return { all: false, profileIds: ids };
}

export interface VisibleScope extends ResolvedScope {
  userIds: Set<string>;
  /** Synlige profiler (inkl. inaktive — filtrér selv på isActive) */
  profiles: ScopeProfile[];
}

/** Hent scope fra DB for den kaldende bruger. */
export async function getVisibleScope(
  db: Db,
  ctx: ScopeCtx,
): Promise<VisibleScope> {
  const [profiles, managerships] = await Promise.all([
    db.query.employeeProfiles.findMany({
      where: eq(employeeProfiles.organizationId, ctx.orgId),
      columns: {
        id: true,
        userId: true,
        departmentId: true,
        managerId: true,
        isActive: true,
      },
    }),
    ctx.orgRole === "manager"
      ? db.query.departmentManagers.findMany({
          where: and(
            eq(departmentManagers.organizationId, ctx.orgId),
            eq(departmentManagers.userId, ctx.session.user.id),
          ),
          columns: {
            departmentId: true,
            role: true,
            validFrom: true,
            validTo: true,
          },
        })
      : Promise.resolve([] as Managership[]),
  ]);

  const resolved = resolveVisibleProfileIds({
    role: ctx.orgRole,
    selfProfileId: ctx.employeeProfileId,
    profiles,
    managerships,
    today: copenhagenToday(),
  });
  const visible = profiles.filter((p) => resolved.profileIds.has(p.id));
  return {
    ...resolved,
    userIds: new Set(visible.map((p) => p.userId)),
    profiles: visible,
  };
}

/**
 * Where-betingelse på employee_profiles.id. undefined når hele org'en er
 * synlig (så kalderen kun filtrerer på organizationId); `false` ved tomt
 * scope så der aldrig lækker rækker.
 */
export function profileScopeCondition(scope: VisibleScope): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.profileIds.size === 0) return sql`false`;
  return inArray(employeeProfiles.id, Array.from(scope.profileIds));
}

/** Samme for en vilkårlig user_id-kolonne (absence_requests, time_entries…). */
export function userScopeCondition(
  scope: VisibleScope,
  column: Parameters<typeof inArray>[0],
): SQL | undefined {
  if (scope.all) return undefined;
  if (scope.userIds.size === 0) return sql`false`;
  return inArray(column, Array.from(scope.userIds));
}

export function canSeeUser(scope: VisibleScope, userId: string): boolean {
  return scope.all || scope.userIds.has(userId);
}

/**
 * Guard til skrive-handlinger: kaster NOT_FOUND hvis brugeren ikke findes i
 * org'en og FORBIDDEN hvis vedkommende ligger uden for kalderens scope.
 * Rolle-gaten (manager+) ligger i orgManagerProcedure — her tjekkes kun scope.
 */
export async function assertUserInScope(
  db: Db,
  ctx: ScopeCtx,
  targetUserId: string,
  forbiddenMessage?: string,
): Promise<VisibleScope> {
  const scope = await getVisibleScope(db, ctx);
  if (!canSeeUser(scope, targetUserId)) {
    const exists = await db.query.employeeProfiles.findFirst({
      where: and(
        eq(employeeProfiles.userId, targetUserId),
        eq(employeeProfiles.organizationId, ctx.orgId),
      ),
      columns: { id: true },
    });
    if (!exists) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: await tr("serverErrors", "enterprise.team.employeeNotInOrg"),
      });
    }
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        forbiddenMessage ??
        (await tr("serverErrors", "enterprise.scope.ownEmployees")),
    });
  }
  return scope;
}
