import { isDefiniteRejection } from "./api-error";

/**
 * Gem af en stoppet timer-session (#dubletter).
 *
 * Samme `save` (og dermed samme payload og clientEntryId) bruges i ALLE
 * forsøg — serveren er idempotent på clientEntryId, så et nyt forsøg efter en
 * timeout, hvor serveren faktisk nåede at gemme, giver den eksisterende post
 * tilbage i stedet for en ny.
 *
 * Udfald:
 * - `saved`: serveren bekræftede posten.
 * - `rejected`: serveren afviste med sikkerhed (4xx) — intet er gemt, og
 *   timeren må gerne køre videre.
 * - `unconfirmed`: vi ved det ikke (timeout/netværk/5xx efter alle forsøg).
 *   Timeren må IKKE genoptages; sessionen skal ligge som "afventer gem" i
 *   offline-køen med samme clientEntryId.
 */
export type SaveOutcome<T> =
  | { status: "saved"; result: T; attempts: number }
  | { status: "rejected"; error: unknown; attempts: number }
  | { status: "unconfirmed"; error: unknown; attempts: number };

export const STOP_SAVE_RETRY_DELAYS_MS = [1000, 3000] as const;

export async function saveWithRetry<T>(
  save: () => Promise<T>,
  options: {
    /** Pause før forsøg 2, 3, … — længden afgør antal forsøg (+1). */
    delaysMs?: readonly number[];
    sleep?: (ms: number) => Promise<void>;
    onUncertainFailure?: (error: unknown, attempt: number) => void;
    /** Kaldes før hvert forsøg — fx for at skubbe write-ahead-fristen. */
    onBeforeAttempt?: (attempt: number) => Promise<void> | void;
  } = {},
): Promise<SaveOutcome<T>> {
  const delays = options.delaysMs ?? STOP_SAVE_RETRY_DELAYS_MS;
  const sleep =
    options.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  let lastError: unknown = null;
  let sawUncertain = false;
  for (let attempt = 1; attempt <= delays.length + 1; attempt++) {
    if (attempt > 1) await sleep(delays[attempt - 2]);
    try {
      await options.onBeforeAttempt?.(attempt);
      const result = await save();
      return { status: "saved", result, attempts: attempt };
    } catch (error) {
      if (isDefiniteRejection(error)) {
        // Var et tidligere forsøg usikkert, kan serveren allerede have gemt
        // posten — så er en senere 4xx ikke bevis for, at intet er gemt.
        return sawUncertain
          ? { status: "unconfirmed", error, attempts: attempt }
          : { status: "rejected", error, attempts: attempt };
      }
      sawUncertain = true;
      lastError = error;
      options.onUncertainFailure?.(error, attempt);
    }
  }
  return {
    status: "unconfirmed",
    error: lastError,
    attempts: delays.length + 1,
  };
}

/**
 * Hvor længe et "write-ahead"-gem i offline-køen venter, før baggrunden må
 * afspille det. Popup'en skubber fristen til nu + denne værdi før HVERT
 * forsøg (ét forsøg tager højst 2 × 20 s med klippekort-fallback), så
 * baggrunden aldrig kører samtidig med en levende popup. Lukkes popup'en
 * midt i et gem, overtager baggrunden senest ca. 3,5 min efter (frist +
 * alarm hvert 2. min) — inden oprydnings-cronen (5 min) parkerer en hængende
 * "stopping"-række som pauset tid, der ellers ville blive gemt igen.
 */
export const WRITE_AHEAD_GRACE_MS = 90_000;

/** True når en kø-post endnu ikke må afspilles af baggrunden. */
export function isNotYetDue(
  action: { notBefore?: string | null },
  now: number,
): boolean {
  if (!action.notBefore) return false;
  const due = new Date(action.notBefore).getTime();
  return Number.isFinite(due) && due > now;
}

/**
 * Over en kørende (eller pauset) timer med mere end dette tracket må et
 * site-forslag aldrig flytte tiden til en anden kunde — kun tilbyde
 * "stop & start". Under grænsen er det en rettelse af en timer, der lige er
 * startet forkert.
 */
export const RELABEL_GRACE_SECONDS = 60;

export function suggestionMayRelabel(trackedSeconds: number): boolean {
  return trackedSeconds <= RELABEL_GRACE_SECONDS;
}

/**
 * Har serveren en timer, som en frisk start ville overskrive? Serverens
 * one-running-timer-guard stopper kun skrivninger fra en ANDEN kilde — to
 * extension-instanser (flere Chrome-profiler/computere) har samme kilde og
 * ville tavst overskrive hinandens timer uden at gemme den.
 *
 * En række midt i et stop ("stopping") tæller med, medmindre det er vores
 * eget stop, hvis bekræftelse ligger i vores kø.
 */
/** Et "stopping" ældre end dette regnes for forladt (popup lukket). */
export const ABANDONED_STOP_MS = 30_000;

export function serverHasActiveSession(
  state: {
    isRunning?: boolean | null;
    baseSeconds?: number | null;
    elapsedSeconds?: number | null;
    intent?: string | null;
    version?: number | null;
    /** Hvornår stoppet blev claimet (fra nyere servere; ellers fraværende). */
    intentAt?: string | null;
  } | null,
  /** Versioner, som vores egen kø har en ventende confirmStop for. */
  ownStopVersions: readonly number[] = [],
  now: number = Date.now(),
): boolean {
  if (!state) return false;
  if (state.intent === "stopping") {
    // Vores eget efterladte stop: tiden ligger i køen — det må afløses.
    // Alle andre: rækken kan være eneste kopi af tiden (en popup lukket
    // midt i stoppet), så den overskrives ikke — medmindre serveren siger,
    // at stoppet er forladt (> 30 s): så parkerer cronen tiden, og serverens
    // merge forhindrer dubletter. Uden intentAt (ældre server): blokér.
    if (
      typeof state.version === "number" &&
      ownStopVersions.includes(state.version)
    ) {
      return false;
    }
    const intentAtMs = state.intentAt
      ? new Date(state.intentAt).getTime()
      : NaN;
    if (Number.isFinite(intentAtMs) && now - intentAtMs > ABANDONED_STOP_MS) {
      return false;
    }
    return true;
  }
  return (
    state.isRunning === true ||
    (state.baseSeconds ?? 0) > 0 ||
    (state.elapsedSeconds ?? 0) > 0
  );
}

/**
 * En write-ahead-confirmStop hører sammen med sit gem (samme `group`). Er
 * gemmet opgivet (sikker afvisning), må bekræftelsen ikke nulstille rækken —
 * så ville tiden forsvinde. Samme adfærd som forgrundens 4xx → cancelStop.
 */
export function confirmBlockedByPairedSave(
  action: { group?: string | null },
  gaveUpGroups: ReadonlySet<string>,
): boolean {
  return !!action.group && gaveUpGroups.has(action.group);
}

/**
 * Review P1: en confirmStop afspilles først, når dens parrede gem (samme
 * `group`) er landet. Ligger gemmet stadig i køen (ikke forfaldent, fejlet
 * og venter på næste forsøg), venter bekræftelsen — ellers markerer serveren
 * sessionen som gemt uden post, før posten findes.
 */
export function confirmWaitsForPairedSave(
  action: { group?: string | null },
  unsavedGroups: ReadonlySet<string>,
): boolean {
  return !!action.group && unsavedGroups.has(action.group);
}
