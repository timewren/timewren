/**
 * Ved fanen, at serveren kører en nyere build? Sættes af "Ny version"-
 * prompten (tRPC-svarets versions-header, /api/version eller en ny service
 * worker). Bevidst sit eget lille modul: instrumentation-client læser det på
 * alle sider, også marketing.
 */
let staleBuild = false;

export function markStaleBuild(): void {
  staleBuild = true;
}

type NavigationType = "push" | "replace" | "traverse";
type HardNavigator = Pick<Location, "assign">;
type GuardStorage = Pick<Storage, "getItem" | "setItem">;

/** Højst én fuld sideindlæsning pr. fane i dette tidsrum. */
export const STALE_RELOAD_COOLDOWN_MS = 5 * 60 * 1000;
const STALE_RELOAD_KEY = "tt-stale-build-reload";

function sessionStorageOrNull(): GuardStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

/**
 * En fane med en gammel build sender et router-træ, som den nye server
 * måske ikke kan læse ("The router state header was sent but could not be
 * parsed", Sentry TIMETRACK-1S), og den henter chunks, der ikke findes
 * længere. Når fanen ved, at den er forældet, bliver næste klik-navigation
 * (push) i stedet en fuld sideindlæsning af den nye build.
 *
 * replace og tilbage/frem røres ikke: replace bruges af koden selv (filtre,
 * redirects ved indlæsning). Højst én gang pr. STALE_RELOAD_COOLDOWN_MS pr.
 * fane, så en vedvarende versionsforskel (fx under en rullende deploy, hvor
 * kald rammer både gammel og ny server) aldrig kan give en genindlæsnings-
 * løkke.
 */
export function hardNavigateIfStale(
  url: string,
  navigationType: NavigationType,
  location: HardNavigator = window.location,
  storage: GuardStorage | null = sessionStorageOrNull(),
  now: number = Date.now(),
): boolean {
  if (!staleBuild || navigationType !== "push") return false;
  const last = Number(storage?.getItem(STALE_RELOAD_KEY) ?? 0);
  if (now - last < STALE_RELOAD_COOLDOWN_MS) return false;
  storage?.setItem(STALE_RELOAD_KEY, String(now));
  location.assign(url);
  return true;
}

/** Kun til tests. */
export function __resetStaleBuildForTests(): void {
  staleBuild = false;
}
