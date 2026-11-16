import { invalidateCached } from "@/lib/cache";

/**
 * Valkey-nøglen for en orgs modul-rækker (`resolveModules`). Rækkerne læses
 * ved hvert tRPC-kald, men ændres sjældent, så de caches kort og ryddes, når
 * nogen skriver til organization_modules.
 */
export const ORG_MODULES_CACHE_TTL_SECONDS = 60;

export function orgModulesCacheKey(orgId: string): string {
  return `orgModules:${orgId}`;
}

/** Kald efter hver skrivning til organization_modules for orgen. */
export function invalidateOrgModules(orgId: string): Promise<void> {
  return invalidateCached(orgModulesCacheKey(orgId));
}
