/**
 * Observatør-tilstand for web-fanens keep-alive (kunde A 5/10).
 *
 * To skrivere holder den samme kørende timer i live hvert 30. sekund — fx to
 * faner der begge adopterede extensionens timer. Den ene skriver altid lige
 * før den anden, så den andens heartbeat (med `expectedVersion`) får
 * `version_conflict` hver gang: den afstemmer, lærer den nye version, og
 * taber igen 30 s senere. Intet data går tabt, men konflikterne fortsætter
 * så længe begge er åbne.
 *
 * Reglen: en fane hvis rene keep-alive afvises med `version_conflict`, bliver
 * OBSERVATØR. Den viser timeren (afstemning, polling, realtime), men sender
 * ikke keep-alive — ejeren holder rækken i live. Den skriver igen når:
 * - brugeren ændrer noget lokalt (kunde/projekt/beskrivelse, pause, stop) —
 *   så er skrivningen ikke et rent keep-alive, og
 * - ejeren er væk: ingen fremmed skrivning set i `OWNER_STALE_MS`. Så
 *   genoptager fanen sine heartbeats med den aktuelle version og session.
 *
 * "Set" måles på fanens eget ur, når en afstemning viser en ny version eller
 * en ny `lastSyncedAt` — aldrig ved at sammenligne serverens ur med fanens.
 */

import { sameDetails, type TimerDetails } from "./heartbeat-version";

/** Uden fremmede skrivninger så længe, regnes ejeren for væk. */
export const OWNER_STALE_MS = 2 * 60 * 1000;

/**
 * Er skrivningen et rent keep-alive (intet nyt at fortælle serveren)? Kun
 * sådan en springes over i observatør-tilstand.
 */
export function isPureKeepAlive(input: {
  isRunning: boolean;
  isFreshStart: boolean;
  sessionEstablished: boolean;
  /** Detaljerne serveren sidst bekræftede/viste; null = ukendt. */
  lastServerDetails: TimerDetails | null;
  local: TimerDetails;
  /** Et lokalt kunde-/projektskift der endnu ikke er synket. */
  hasUnsyncedSelection: boolean;
}): boolean {
  return (
    input.isRunning &&
    !input.isFreshStart &&
    input.sessionEstablished &&
    !input.hasUnsyncedSelection &&
    input.lastServerDetails !== null &&
    sameDetails(input.lastServerDetails, input.local)
  );
}

export type ObserverDecision =
  /** Skriv som normalt. */
  | "send"
  /** Observatør, ejeren lever: spring keep-alive over. */
  | "skip"
  /** Observatør, men ejeren er ikke set længe: afstem og afgør igen. */
  | "check-owner";

export function observerKeepAliveDecision(input: {
  observer: boolean;
  pureKeepAlive: boolean;
  /** Fanens ur da en fremmed skrivning sidst blev set. */
  ownerSeenAt: number;
  now: number;
}): ObserverDecision {
  if (!input.observer || !input.pureKeepAlive) return "send";
  return input.now - input.ownerSeenAt < OWNER_STALE_MS
    ? "skip"
    : "check-owner";
}

/**
 * Har en afstemning set en skrivning fra en anden klient siden sidst? En
 * observatør skriver ikke selv, så en ny version eller en ny `lastSyncedAt`
 * betyder at ejeren stadig lever.
 */
export function sawOwnerActivity(input: {
  prevVersion: number;
  version: number | undefined;
  /** `lastSyncedAt` i ms (serverens ur — kun sammenlignet med sig selv) */
  prevLastSyncedAt: number | null;
  lastSyncedAt: number | null;
}): boolean {
  if (typeof input.version === "number" && input.version > input.prevVersion) {
    return true;
  }
  return (
    input.lastSyncedAt !== null &&
    input.prevLastSyncedAt !== null &&
    input.lastSyncedAt !== input.prevLastSyncedAt
  );
}
