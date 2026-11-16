/**
 * Header, som offline-køens afspilning sender med, så en post lagt i køen i
 * org A gemmes i org A — også hvis brugeren har skiftet til org B imens.
 * Serveren accepterer den kun, når brugeren er medlem af organisationen.
 */
export const ORG_OVERRIDE_HEADER = "x-timetrack-org-id";

const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;

/**
 * Org-override fra et cookie-baseret web-kald til /api/trpc — og KUN dét.
 * Kald med API-nøgle, extension-token eller fra en extension-origin får
 * aldrig lov at skifte org via headeren: en nøgle bundet til org A må ikke
 * kunne læse eller skrive i org B, blot fordi ejeren er medlem dér.
 */
export function orgOverrideFromRequest(headers: Headers): string | null {
  const requested = headers.get(ORG_OVERRIDE_HEADER)?.trim();
  if (!requested) return null;
  if (
    headers.has("authorization") ||
    headers.has("x-extension-token") ||
    headers.has("x-api-key") ||
    EXTENSION_ORIGIN.test(headers.get("origin") ?? "")
  ) {
    return null;
  }
  return requested;
}

/** Kopi af headers uden org-override (til API-nøgle-callers). */
export function withoutOrgOverride(headers: Headers): Headers {
  const copy = new Headers(headers);
  copy.delete(ORG_OVERRIDE_HEADER);
  return copy;
}
