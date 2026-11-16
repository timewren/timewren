/**
 * Global cache-politik efter mutationer.
 *
 * QueryClient'en kører med 5 min staleTime og ingen refetch ved fokus, så en
 * mutation der glemmer at invalidere sine queries efterlader UI'et med gamle
 * data indtil en hård genindlæsning ("man skal refreshe før det loader").
 * I stedet for at jagte hver enkelt onSuccess invaliderer MutationCache'en
 * ALT efter enhver vellykket mutation — undtagen de mutationer der fyres
 * hyppigt uden at ændre noget brugeren ser (timer-heartbeat, tællere,
 * "set"-markeringer). De ville ellers refetche hele dashboardet hvert
 * få sekunder.
 *
 * tRPC's mutationKey er `[["router","procedure"]]`.
 */
const NOISY_MUTATION_PATHS: ReadonlyArray<string> = [
  "timerSync.", // sync/heartbeat/claimForStop/... — kører kontinuerligt
  "timerTemplates.recordUsage",
  "reportTemplates.bumpUsage",
  "changelog.markSeen",
  "user.dismissBanner",
  "nudges.", // måling + afvisning af nudges invaliderer selv det de ændrer
  "helpFeedback.",
  "feedback.",
  "analytics.",
  "marketing.",
  "extension.", // extension-token-baserede kald bruges ikke i web-UI'et
];

/** Udtrækker "router.procedure" fra en tRPC mutationKey; null hvis ukendt. */
export function mutationPathFromKey(key: unknown): string | null {
  if (!Array.isArray(key) || key.length === 0) return null;
  const path = key[0];
  if (Array.isArray(path)) {
    return path.every((p) => typeof p === "string") ? path.join(".") : null;
  }
  return typeof path === "string" ? path : null;
}

/**
 * Skal hele query-cachen invalideres efter denne mutation?
 * Ukendte nøgler (ikke-tRPC-mutationer) invaliderer for en sikkerheds skyld.
 */
export function shouldInvalidateAfterMutation(mutationKey: unknown): boolean {
  const path = mutationPathFromKey(mutationKey);
  if (!path) return true;
  return !NOISY_MUTATION_PATHS.some((prefix) =>
    prefix.endsWith(".") ? path.startsWith(prefix) : path === prefix,
  );
}
