import { isStaleStartOnClearedRow } from "./resurrection";

/**
 * Ren beslutningslogik for web-klientens forsoning med serverens timer-række
 * (#589 — "timeren starter forfra").
 *
 * Der findes præcis ÉN timer-række pr. bruger, så et `already_running`-svar
 * handler altid om brugerens egen timer. Et periodisk heartbeat der bliver
 * afvist fordi extensionen lige har skrevet til rækken må derfor ALDRIG
 * nulstille den lokale timer — det er netop den vej brugeren oplever som
 * "00:00:00 / starter forfra".
 */

export type AlreadyRunningAction =
  /** Behold lokal elapsed og adoptér serverens tilstand. */
  | "adopt"
  /** Brugerens forsøg på at genoptage en pauset timer blev blokeret. */
  | "park-paused"
  /** Brugerens forsøg på at starte en HELT ny timer blev blokeret. */
  | "reset";

export function decideAlreadyRunningAction(input: {
  /**
   * Var skrivningen brugerens eksplicitte start/genoptag? Falsk for
   * periodiske heartbeats og adoption.
   */
  isFreshStart: boolean;
  /** Lokal baseTime (sekunder) — bærer allerede optjent, upgemt arbejde. */
  baseTime: number;
}): AlreadyRunningAction {
  if (!input.isFreshStart) return "adopt";
  if (input.baseTime > 0) return "park-paused";
  return "reset";
}

/**
 * Må mirror-grenen re-ankre til serverens elapsed?
 *
 * Et tilbagespring (serverens elapsed er lavere end den lokale) accepteres kun
 * når rækken sidst blev skrevet af en ANDEN kilde end web — ellers er det
 * webbens egen, forsinkede skrivning der trækker displayet baglæns.
 */
export function shouldAcceptMirrorReanchor(input: {
  localElapsed: number;
  serverElapsed: number;
  lastSyncedFrom: string | null;
}): boolean {
  const isBackwards = input.serverElapsed < input.localElapsed;
  if (!isBackwards) return true;
  return input.lastSyncedFrom !== "web";
}

export type PersistedRunningAction =
  /** Serveren har en kørende timer — adoptér den i stedet for at starte. */
  | "adopt-server"
  /** Sessionen er stoppet (og gemt) et andet sted efter den lokale start. */
  | "drop-local"
  /** Den lokale start nåede aldrig serveren — send den som fresh start. */
  | "re-establish"
  /** Pauset/midt i et stop — lad den almindelige afstemning afgøre det. */
  | "defer";

/**
 * En kørende timer der er GENINDLÆST fra localStorage ved sideindlæsning, er
 * ikke en brugerhandling og må aldrig sendes som fresh start før den er
 * afstemt med serveren (kunde A 1/10: en stoppet timer kom tilbage med gammel
 * start og gammel kunde og blev gemt igen).
 *
 * Samme regel som serverens genopstandelses-guard: på en ryddet række er den
 * lokale session kun gyldig, hvis den er startet efter rydningen.
 */
export function decidePersistedRunningOnMount(input: {
  server: {
    isRunning: boolean | null;
    elapsedSeconds: number | null;
    baseSeconds: number | null;
    intent: string | null;
    lastSyncedAt: string | null;
  };
  /** Den lokale sessions starttid (ms) — det en sync ville sende. */
  localStartTime: number | null;
}): PersistedRunningAction {
  const { server } = input;
  if (server.intent === "stopping") return "defer";
  if (server.isRunning) return "adopt-server";
  if ((server.elapsedSeconds ?? 0) > 0 || (server.baseSeconds ?? 0) > 0) {
    return "defer";
  }
  const stale = isStaleStartOnClearedRow(
    {
      isRunning: false,
      elapsedSeconds: 0,
      baseSeconds: 0,
      lastSyncedAt: server.lastSyncedAt ? new Date(server.lastSyncedAt) : null,
    },
    input.localStartTime !== null ? new Date(input.localStartTime) : null,
  );
  return stale ? "drop-local" : "re-establish";
}

export interface TimerSelection {
  projectId: string | null | undefined;
  clientId: string | null | undefined;
}

function sameSelection(a: TimerSelection, b: TimerSelection): boolean {
  return (
    (a.projectId || null) === (b.projectId || null) &&
    (a.clientId || null) === (b.clientId || null)
  );
}

/**
 * Må mirror-grenen IKKE overtage serverens projekt/kunde lige nu?
 *
 * Skifter brugeren kunde på en kørende timer, synkes det straks — men indtil
 * synken er bekræftet, bærer serveren stadig den gamle kunde. En afstemning
 * i det vindue (fx fordi extensionen bumpede versionen) ville ellers rulle
 * kunden tilbage: "timeren skifter pludselig kunde" (kunde A 1/10).
 */
export function shouldHoldUnsyncedSelection(input: {
  unsynced: TimerSelection | null;
  local: TimerSelection;
  server: TimerSelection;
}): boolean {
  const { unsynced } = input;
  if (!unsynced) return false;
  if (!sameSelection(unsynced, input.local)) return false;
  return !sameSelection(unsynced, input.server);
}
