import type { QueryClient } from "@tanstack/react-query";

/**
 * Kunder og projekter caches af baggrunden i storage.local (hvert 10. min).
 * Popup og ny fane bruger cachen som startdata for ["projectsAndClients",
 * orgId], så kundevælger og timerens navn vises med det samme, mens den
 * friske liste hentes.
 */
export const CACHED_CLIENTS_KEY = "cachedClients";
export const CACHED_PROJECTS_KEY = "cachedProjects";
export const CACHED_AT_KEY = "cachedClientsAt";
/** Organisationen cachen er hentet for. */
export const CACHED_ORG_KEY = "cachedClientsOrgId";

export const PROJECTS_CACHE_KEYS = [
  CACHED_CLIENTS_KEY,
  CACHED_PROJECTS_KEY,
  CACHED_AT_KEY,
  CACHED_ORG_KEY,
];

/** Læg cachen i query-cachen, hvis den hører til den valgte organisation. */
export async function seedProjectsCache(
  queryClient: QueryClient,
): Promise<void> {
  try {
    const stored = await chrome.storage.local.get([
      ...PROJECTS_CACHE_KEYS,
      "selectedOrgId",
    ]);
    const orgId =
      typeof stored.selectedOrgId === "string" ? stored.selectedOrgId : null;
    const cachedOrg = stored[CACHED_ORG_KEY] ?? null;
    const clients = stored[CACHED_CLIENTS_KEY];
    const projects = stored[CACHED_PROJECTS_KEY];
    const at = stored[CACHED_AT_KEY];
    if (
      cachedOrg !== orgId ||
      !Array.isArray(clients) ||
      !Array.isArray(projects) ||
      typeof at !== "number"
    ) {
      return;
    }
    const key = ["projectsAndClients", orgId];
    // Er listen allerede hentet, vinder den. Cachen vises straks, men tæller
    // som forældet, så listen altid hentes frisk (nye kunder fra web-appen).
    if (queryClient.getQueryData(key)) return;
    queryClient.setQueryData(key, { clients, projects }, { updatedAt: 0 });
  } catch {
    // Uden cache hentes listen som før
  }
}
