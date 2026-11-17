/** Attribut på <html>, som DocumentLayout sætter til deployets version. */
export const APP_VERSION_ATTRIBUTE = "data-app-version";

/**
 * Deployets version på serveren (CI: git-SHA via APP_VERSION). Læses ved
 * kørsel i stedet for at blive bagt ind som NEXT_PUBLIC_*: en define, der
 * skifter ved hvert commit, ville ugyldiggøre Turbopacks build-cache.
 * NEXT_PUBLIC_APP_VERSION i miljøet virker stadig som fallback.
 */
export function deployedVersion(
  env: Record<string, string | undefined> = process.env,
): string | null {
  return env.APP_VERSION || env.NEXT_PUBLIC_APP_VERSION || null;
}

/** Props til <html> i DocumentLayout: deployets version, når den kendes. */
export function appVersionAttributes(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  const version = deployedVersion(env);
  return version ? { [APP_VERSION_ATTRIBUTE]: version } : {};
}

/** Det af document, buildVersion læser (testbart uden DOM). */
type VersionDocument = {
  documentElement: Pick<Element, "getAttribute">;
};

/**
 * Fanens egen version: den, serveren skrev på <html>, da siden blev
 * renderet (samme build som bundtet). Null i lokale builds og under SSR —
 * så bruges den første version, fanen henter.
 */
export function buildVersion(
  doc: VersionDocument | undefined = typeof document === "undefined"
    ? undefined
    : document,
): string | null {
  return doc?.documentElement.getAttribute(APP_VERSION_ATTRIBUTE) || null;
}

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
