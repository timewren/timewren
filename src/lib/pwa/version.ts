/**
 * Bundtets egen version, bagt ind ved build (CI: git-SHA via APP_VERSION).
 * Null i lokale builds — så bruges den første version, fanen henter.
 */
export const BUILD_VERSION: string | null =
  process.env.NEXT_PUBLIC_APP_VERSION || null;

/** Svar-header på tRPC-kald med den kørende deployments version. */
export const SERVER_VERSION_HEADER = "x-timetrack-server-version";

/** Endpoint der svarer med den kørende deployments version. */
export const VERSION_ENDPOINT = "/api/version";

/** Ny deployment = kendt baseline og en anden version fra serveren. */
export function isNewDeployment(
  baseline: string | null,
  current: string | null,
): boolean {
  return !!baseline && !!current && baseline !== current;
}

/**
 * Svarer TimeTrack selv? `navigator.onLine` lyver bag captive portals og
 * ustabile forbindelser, så offline-siden sender først brugeren videre,
 * når /api/version giver et rigtigt svar (JSON med en version).
 */
export async function isAppReachable(
  fetchFn: typeof fetch = fetch,
): Promise<boolean> {
  try {
    const res = await fetchFn(VERSION_ENDPOINT, { cache: "no-store" });
    if (!res.ok) return false;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === "string";
  } catch {
    return false;
  }
}
