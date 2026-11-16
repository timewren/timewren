/**
 * Service workerens caches med offentlige filer: hashede build-filer og
 * offline-siden. Alt andet med timetrack-præfiks kan indeholde private svar
 * (ældre SW-versioner cachede tRPC og HTML) og ryddes ved logout og orgskift.
 */
const PUBLIC_CACHE_PREFIXES = ["timetrack-static-", "timetrack-shell-"];

interface CacheStorageLike {
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

export async function clearPrivateCaches(
  storage: CacheStorageLike | undefined = typeof caches === "undefined"
    ? undefined
    : caches,
): Promise<void> {
  if (!storage) return;
  try {
    const names = await storage.keys();
    await Promise.all(
      names
        .filter(
          (name) =>
            name.startsWith("timetrack-") &&
            !PUBLIC_CACHE_PREFIXES.some((p) => name.startsWith(p)),
        )
        .map((name) => storage.delete(name)),
    );
  } catch {
    // Cache Storage kan være slået fra (privat vindue) — intet at rydde.
  }
}
