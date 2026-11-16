// src/lib/start-page.server.ts
//
// Server-side spejl af klient-gatingen i DashboardShell/useModules/useOrgRole
// (#startside) — bruges af /dashboard/start (redirect) og user.updateProfile
// (gem), så en lagret eller valgt startside altid tjekkes mod de SAMME
// modul-/rolle-/feature-flag-regler som selve navigationen.

import { eq } from "drizzle-orm";
import { isNavItemVisible } from "@/components/dashboard-nav/navigation-config";
import type { db as DbType } from "@/lib/db";
import { featureFlags, organizationModules, users } from "@/lib/db/schema";
import { FREELANCE_BUNDLE } from "@/lib/modules/constants";
import { resolveOrgProfile } from "@/lib/modules/org-profile";
import {
  accessSatisfies,
  type PermissionModuleKey,
  resolveEffectiveOrgRole,
  resolveModuleAccess,
} from "@/lib/permissions/role-access";
import {
  DEFAULT_START_PAGE,
  findStartPageNavItem,
  isKnownStartPage,
  type StartPageHref,
} from "@/lib/start-page";

type Db = typeof DbType;

/**
 * Er `href` en tilgængelig startside for denne bruger i denne org lige nu?
 * `/dashboard` er altid tilgængelig (selve fallback-destinationen).
 */
export async function isStartPageAccessible(
  db: Db,
  userId: string,
  orgId: string | null,
  href: string,
): Promise<boolean> {
  if (href === DEFAULT_START_PAGE) return true;
  if (!isKnownStartPage(href)) return false;
  const item = findStartPageNavItem(href);
  if (!item) return false;

  const flagRows = await db
    .select({ key: featureFlags.key, enabled: featureFlags.enabled })
    .from(featureFlags);
  const flagMap = new Map(flagRows.map((f) => [f.key, f.enabled]));
  // Spejler useFeatureFlags() på klienten: platform-rollerne admin/supporter
  // ser alt bag feature-flags, uanset flagMap (#startside).
  const viewer = await db.query.users.findFirst({
    where: eq(users.id, userId),
    columns: { role: true },
  });
  const isPrivilegedViewer =
    viewer?.role === "admin" || viewer?.role === "supporter";
  const isFlagEnabled = (key: string) =>
    isPrivilegedViewer || (flagMap.get(key) ?? false);

  if (!orgId) {
    // Solo-freelancer uden org: samme fallback som organization.getCurrent
    // (FREELANCE_BUNDLE) og rolePermissions.getMyRole (owner, intet skjult).
    return isNavItemVisible(item, {
      isFlagEnabled,
      isModuleEnabled: (key) =>
        (FREELANCE_BUNDLE as readonly string[]).includes(key),
      canAccessModule: () => true,
      role: "owner",
      orgProfile: "freelance",
    });
  }

  const moduleRows = await db.query.organizationModules.findMany({
    where: eq(organizationModules.organizationId, orgId),
  });
  const moduleOn = (key: string) =>
    moduleRows.some((r) => r.moduleKey === key && r.isAvailable && r.isEnabled);

  const org = await db.query.organizations.findFirst({
    where: (o, { eq: eqOp }) => eqOp(o.id, orgId),
    columns: { metadata: true },
  });
  const metadataType = (org?.metadata as { type?: string } | null)?.type;
  const orgProfile = resolveOrgProfile(metadataType, moduleOn);
  const role = await resolveEffectiveOrgRole(db, userId, orgId);

  let canAccess = true;
  if (item.permissionModule) {
    const level = await resolveModuleAccess(
      db,
      userId,
      orgId,
      item.permissionModule as PermissionModuleKey,
    );
    canAccess = accessSatisfies(level, "read");
  }

  return isNavItemVisible(item, {
    isFlagEnabled,
    isModuleEnabled: moduleOn,
    canAccessModule: () => canAccess,
    role,
    orgProfile,
  });
}

/**
 * Den lagrede/valgte startside, afgjort til den faktiske destination: ukendt,
 * null eller ikke-tilgængelig falder altid tilbage til /dashboard.
 */
export async function resolveStartPage(
  db: Db,
  userId: string,
  orgId: string | null,
  candidate: string | null | undefined,
): Promise<StartPageHref> {
  if (!isKnownStartPage(candidate)) return DEFAULT_START_PAGE;
  const accessible = await isStartPageAccessible(db, userId, orgId, candidate);
  return accessible ? candidate : DEFAULT_START_PAGE;
}
