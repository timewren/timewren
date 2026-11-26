/**
 * Web-klientens regler for server-udstedte timer-sessioner (fase 1) — rene
 * funktioner, så de kan testes uden React. Se
 * docs/architecture/timer-sessions.md.
 */

/** Sessionens øjebliksbillede fra et vellykket claim (#785). */
export interface ClaimSnapshot {
  sessionId: string | null;
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
  /** Sessionens rigtige start (ISO) */
  startedAt: string;
}

/** Den session et stop blev startet for: id (hvis kendt) og lokal start. */
export interface StopTarget {
  sessionId: string | null;
  sessionStartTime: number | null;
}

/**
 * Er fanens timer stadig den session, stoppet blev startet for (#1333)? Et
 * claim-svar kan lande efter, at afstemningen har adopteret en anden session
 * (B); så må svaret for A hverken skrive A's id og detaljer oven i B eller
 * pause den. Med kendt id afgør id'et. Uden id (tabt svar på starten) er det
 * stadig samme session, hvis den lokale start er uændret, og et id fanen
 * har lært imens er det, claimet fandt.
 */
export function isStillStopTarget(
  target: StopTarget,
  local: StopTarget,
  claimedSessionId?: string | null,
): boolean {
  if (target.sessionId) return local.sessionId === target.sessionId;
  return (
    local.sessionStartTime === target.sessionStartTime &&
    (local.sessionId === null || local.sessionId === claimedSessionId)
  );
}

let stopClaimsInFlight = 0;

/**
 * Markér et stop-claim som undervejs (#1333). Imens kan afstemningen se
 * fanens EGET claim som "stopping", før svaret er her; den må så ikke rydde
 * stopmålets lokale start, for så afviser svaret sin egen session. Kald den
 * returnerede funktion, når svaret er håndteret.
 */
export function beginStopClaim(): () => void {
  stopClaimsInFlight++;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    stopClaimsInFlight--;
  };
}

/** Venter fanen på svar på et stop-claim? */
export function isStopClaimInFlight(): boolean {
  return stopClaimsInFlight > 0;
}

/** Tolerance for "samme start" (serveren gemmer ms, men ur/afrunding). */
export const OWN_START_TOLERANCE_MS = 1_000;

/**
 * Er serverens kørende session vores EGEN start, der landede selvom svaret
 * gik tabt? Web sender sin lokale starttid ved en ny start, så serverens
 * `startTime` er den samme (±1 s).
 */
export function isOwnLandedStart(
  serverStart: string | number | null | undefined,
  localStart: number | null | undefined,
): boolean {
  if (serverStart === null || serverStart === undefined) return false;
  if (localStart === null || localStart === undefined) return false;
  const s =
    typeof serverStart === "string"
      ? new Date(serverStart).getTime()
      : serverStart;
  if (!Number.isFinite(s)) return false;
  return Math.abs(s - localStart) <= OWN_START_TOLERANCE_MS;
}

/**
 * Svar på en gentaget start (samme clientOpId): kører den session starten
 * oprettede stadig, overtager klienten den ("adopt-own"); ellers er den gemt
 * eller kasseret et andet sted, og den lokale kopi droppes ("drop-local").
 */
export function decideDedupedStart(result: {
  sessionId?: string | null;
  sessionStatus?: string | null;
  sessionCurrent?: boolean;
}): "adopt-own" | "drop-local" {
  const active =
    result.sessionStatus === "running" ||
    result.sessionStatus === "paused" ||
    result.sessionStatus === "stopping";
  return result.sessionId && result.sessionCurrent && active
    ? "adopt-own"
    : "drop-local";
}

/**
 * Review P2-2: en afvisning der siger, at startnøglen aldrig fandt en session
 * (starten nåede ikke serveren). Den lokale tid findes kun hos klienten og må
 * ikke smides væk — den gemmes via offline-stoppet i stedet.
 */
export function startNeverLanded(result: {
  reason?: string;
  startNeverLanded?: boolean;
}): boolean {
  return (
    result.reason === "session_mismatch" && result.startNeverLanded === true
  );
}
