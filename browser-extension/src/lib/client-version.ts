/**
 * Klientversion: extensionen fortæller serveren hvilken version den er
 * (`x-timetrack-client: extension/<manifest-version>`), og serveren kan afvise
 * skrivninger fra for gamle versioner med fejlkoden CLIENT_TOO_OLD. Så viser
 * extensionen "Opdatér TimeTrack-udvidelsen", beder Chrome om at hente
 * opdateringen og genstarter, når den er klar og intet gem er i gang.
 *
 * Rene hjælpere her (testes med vitest); Chrome-kaldene ligger i
 * background/updates.ts.
 */

export const CLIENT_HEADER = "x-timetrack-client";
export const CLIENT_TOO_OLD = "CLIENT_TOO_OLD";

/** Mindst så længe mellem to requestUpdateCheck-kald fra os. */
export const UPDATE_CHECK_INTERVAL_MS = 10 * 60_000;
/** Svarer Chrome "throttled", venter vi længere. */
export const UPDATE_CHECK_THROTTLED_BACKOFF_MS = 60 * 60_000;
/** Et gem der aldrig meldte sig færdigt (popup lukket midt i) tæller ikke. */
export const SAVE_IN_FLIGHT_TTL_MS = 60_000;
/** Længst vi venter på igangværende gem før genstart efter opdatering. */
export const RELOAD_MAX_WAIT_MS = 2 * 60_000;

export function extensionVersion(): string {
  try {
    return chrome.runtime.getManifest().version;
  } catch {
    return "0.0.0";
  }
}

export function clientHeaders(
  version: string = extensionVersion(),
): Record<string, string> {
  return { [CLIENT_HEADER]: `extension/${version}` };
}

/**
 * appCode fra et fejlsvar: tRPC (`{ error: { json: { data: { appCode } } } }`
 * eller uden superjson-indpakning) og REST (`{ error: { code } }`).
 */
export function appCodeFromErrorBody(body: unknown): string | null {
  const error = (body as { error?: unknown } | null)?.error as
    | {
        json?: { data?: { appCode?: unknown } };
        data?: { appCode?: unknown };
        code?: unknown;
      }
    | undefined;
  if (!error || typeof error !== "object") return null;
  const appCode = error.json?.data?.appCode ?? error.data?.appCode;
  if (typeof appCode === "string") return appCode;
  return error.code === CLIENT_TOO_OLD ? CLIENT_TOO_OLD : null;
}

/** Må vi kalde requestUpdateCheck nu? `nextAllowedAt` gemmes i storage. */
export function shouldRequestUpdateCheck(
  nextAllowedAt: number | null | undefined,
  now: number,
): boolean {
  return !nextAllowedAt || now >= nextAllowedAt;
}

/** Hvornår må næste tjek ske, givet Chromes svar? */
export function nextUpdateCheckAt(
  status: string | undefined,
  now: number,
): number {
  return (
    now +
    (status === "throttled"
      ? UPDATE_CHECK_THROTTLED_BACKOFF_MS
      : UPDATE_CHECK_INTERVAL_MS)
  );
}

/** Gem i gang (id → starttid), uden dem der er for gamle til at tælle. */
export function liveSaves(
  saves: Record<string, number> | null | undefined,
  now: number,
): Record<string, number> {
  const live: Record<string, number> = {};
  for (const [id, startedAt] of Object.entries(saves ?? {})) {
    if (now - startedAt < SAVE_IN_FLIGHT_TTL_MS) live[id] = startedAt;
  }
  return live;
}

/**
 * Skal genstarten efter en opdatering vente? Popup'en kan have en ugemt
 * manuel registrering — så ventes der, så længe den er åben (den lukker,
 * når brugeren klikker væk). Igangværende gem ventes der på op til fristen.
 */
export function shouldDeferReload(input: {
  savesInFlight: number;
  popupOpen: boolean;
  now: number;
  deadline: number;
}): boolean {
  if (input.popupOpen) return true;
  return input.savesInFlight > 0 && input.now < input.deadline;
}
