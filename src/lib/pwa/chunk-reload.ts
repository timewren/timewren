/**
 * Efter et deploy findes det gamle builds lazy chunks ikke længere. En åben
 * fane, der forsøger at hente en af dem, ender i en error boundary, som
 * "Prøv igen" ikke kan komme ud af. Den eneste udvej er en hård genindlæsning
 * — men kun én gang, så en reel fejl ikke bliver til en løkke.
 */

export const CHUNK_RELOAD_KEY = "timetrack:chunk-reload-at";
const RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR_PATTERN =
  /Loading (CSS )?chunk [\w-]+ failed|dynamically imported module|Importing a module script failed/i;

export function isChunkLoadError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === "ChunkLoadError") return true;
  return typeof message === "string" && CHUNK_ERROR_PATTERN.test(message);
}

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Returnerer true, hvis siden genindlæses. */
export function reloadOnceForChunkError(
  error: unknown,
  deps: { storage: StorageLike; reload: () => void; now: number },
): boolean {
  if (!isChunkLoadError(error)) return false;
  try {
    const last = Number(deps.storage.getItem(CHUNK_RELOAD_KEY));
    if (
      Number.isFinite(last) &&
      last > 0 &&
      deps.now - last < RELOAD_WINDOW_MS
    ) {
      return false;
    }
    deps.storage.setItem(CHUNK_RELOAD_KEY, String(deps.now));
  } catch {
    // Uden sessionStorage kan vi ikke vogte mod løkker — lad være.
    return false;
  }
  deps.reload();
  return true;
}

/** Browser-variant til error boundaries. */
export function reloadOnChunkError(error: unknown): boolean {
  if (typeof window === "undefined") return false;
  let storage: StorageLike;
  try {
    storage = window.sessionStorage;
  } catch {
    return false;
  }
  return reloadOnceForChunkError(error, {
    storage,
    reload: () => window.location.reload(),
    now: Date.now(),
  });
}
