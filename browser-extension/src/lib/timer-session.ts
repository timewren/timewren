import { t } from "../i18n/core";
/**
 * Server-udstedte timer-sessioner i extensionen (2.6.0) — se
 * docs/architecture/timer-sessions.md i web-repoet.
 *
 * Serveren giver hver timer-kørsel et `sessionId`. Extensionen husker det
 * (chrome.storage.local, så det overlever at service-workeren og popup'en
 * lukkes) og sender det med på ALLE skrivninger til timeren. Serveren lader
 * kun skrivningen lande på netop den session; står en anden session på
 * rækken, skrives intet, og svaret er serverens tilstand, som extensionen
 * adopterer. Så kan en forældet popup, en anden extension-instans eller en
 * gammel kø-post aldrig skifte kunde på, pause eller stoppe en anden session.
 */

export const TIMER_SESSION_KEY = "timerSessionId";

/** Felter et tilstandssvar kan bære om sessionen og om skrivningen landede. */
export interface SessionAwareResponse {
  sessionId?: string | null;
  intent?: string | null;
  /** En anden session står på rækken — intet er skrevet. */
  sessionMismatch?: boolean;
  /** Sessionen er midt i et stop — intet er skrevet. */
  stoppingInProgress?: boolean;
  /** En frisk start blev afvist; svaret er serverens tilstand. */
  startRejected?:
    | "already_running"
    | "paused_session"
    | "stale_start"
    | null
    | undefined;
  /** Samme start (samme nøgle) var allerede landet — intet er skrevet. */
  deduplicated?: boolean;
}

export type WriteOutcome =
  | "landed"
  | "session_mismatch"
  | "stopping"
  | "start_rejected"
  | "deduplicated";

/** Landede skrivningen — eller skal extensionen adoptere serverens tilstand? */
export function writeOutcome(
  res: SessionAwareResponse | null | undefined,
): WriteOutcome {
  if (!res) return "landed";
  if (res.sessionMismatch) return "session_mismatch";
  if (res.stoppingInProgress) return "stopping";
  if (res.startRejected) return "start_rejected";
  if (res.deduplicated) return "deduplicated";
  return "landed";
}

/**
 * `sessionId`-feltet til en skrivning. Ukendt id (ingen session, eller en
 * række fra før sessionerne) → intet felt: serveren falder tilbage til de
 * gamle guards og giver rækken et id, som svaret bringer tilbage.
 */
export function sessionField(
  sessionId: string | null | undefined,
): { sessionId: string } | Record<string, never> {
  return sessionId ? { sessionId } : {};
}

/** Brugervendt besked når en skrivning ikke landede. */
export function adoptMessage(
  outcome: WriteOutcome,
  startRejected?: SessionAwareResponse["startRejected"],
): string | null {
  switch (outcome) {
    case "session_mismatch":
      return t("errors.timer.sessionMismatch");
    case "stopping":
      return t("errors.timer.beingStopped");
    case "start_rejected":
      return startRejected === "paused_session"
        ? t("errors.timer.startRejectedPaused")
        : startRejected === "stale_start"
          ? t("errors.timer.startRejectedStale")
          : t("errors.timer.startRejectedRunning");
    default:
      return null;
  }
}

/** Husk serverens session (eller glem den, når rækken er ryddet). */
export async function rememberSession(
  state: { sessionId?: string | null } | null | undefined,
): Promise<void> {
  if (!state || !("sessionId" in state)) return;
  try {
    // Hvert tilstandssvar bærer sessionen; skriv kun ved ændring, så
    // storage.onChanged ikke fyrer i alle visninger ved hver sync
    const next = state.sessionId || null;
    if ((await readStoredSessionId()) === next) return;
    if (next) {
      await chrome.storage.local.set({ [TIMER_SESSION_KEY]: next });
    } else {
      await chrome.storage.local.remove([TIMER_SESSION_KEY]);
    }
  } catch {
    // Best-effort — svarene bærer altid det aktuelle id
  }
}

export async function readStoredSessionId(): Promise<string | null> {
  try {
    const result = await chrome.storage.local.get([TIMER_SESSION_KEY]);
    const id = result[TIMER_SESSION_KEY];
    return typeof id === "string" && id ? id : null;
  } catch {
    return null;
  }
}
