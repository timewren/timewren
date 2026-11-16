/**
 * Versionstjek på web-heartbeats (audit A5, P1-4).
 *
 * Web-faner og mobil skriver alle som `source: "web"`. Uden versionstjek kan
 * et periodisk heartbeat fra en fane med forældede detaljer (fx den gamle
 * kunde) overskrive en nyere ændring fra en anden fane — og den anden fane
 * spejler så den gamle værdi tilbage ("timeren skifter kunde").
 *
 * Reglen: et rent KEEP-ALIVE-heartbeat (lokale detaljer = det serveren sidst
 * viste os) sender `expectedVersion`. Serveren afviser det med
 * `version_conflict`, hvis rækken er skrevet siden, og fanen afstemmer i
 * stedet for at skrive. Har brugeren ændret noget lokalt (detaljerne afviger
 * fra serverens), er det en bevidst ændring, som sendes ubetinget som før —
 * den må ikke tabes.
 *
 * Mobil og ældre klienter sender ingen `expectedVersion` og opfører sig som
 * hidtil.
 */

export interface TimerDetails {
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
}

export function normalizeDetails(d: {
  projectId?: string | null;
  clientId?: string | null;
  taskId?: string | null;
  description?: string | null;
}): TimerDetails {
  return {
    projectId: d.projectId || null,
    clientId: d.clientId || null,
    taskId: d.taskId || null,
    description: d.description ?? "",
  };
}

/**
 * `taskId` indgår bevidst ikke: adoption/mirror skriver ikke altid serverens
 * opgave ind lokalt, og så ville versionstjekket aldrig slå til.
 */
export function sameDetails(a: TimerDetails, b: TimerDetails): boolean {
  return (
    a.projectId === b.projectId &&
    a.clientId === b.clientId &&
    a.description === b.description
  );
}

/**
 * `expectedVersion` til en sync, eller `undefined` når skrivningen skal være
 * ubetinget (fresh start, adoption, pause, ikke-etableret session, ukendt
 * serverstand eller en lokal ændring der endnu ikke er synket).
 */
export function heartbeatExpectedVersion(input: {
  isRunning: boolean;
  isFreshStart: boolean;
  isAdoption: boolean;
  sessionEstablished: boolean;
  /** Detaljerne serveren sidst bekræftede/viste; null = ukendt. */
  lastServerDetails: TimerDetails | null;
  local: TimerDetails;
  serverVersion: number;
}): number | undefined {
  if (
    !input.isRunning ||
    input.isFreshStart ||
    input.isAdoption ||
    !input.sessionEstablished ||
    input.lastServerDetails === null ||
    input.serverVersion <= 0
  ) {
    return undefined;
  }
  return sameDetails(input.lastServerDetails, input.local)
    ? input.serverVersion
    : undefined;
}

/**
 * Server-side klassifikation af et afvist heartbeat med `expectedVersion`:
 * kører rækken stadig hos samme kilde, var afvisningen en versionskonflikt
 * (en anden fane/enhed med samme kilde har skrevet) — ikke en anden ejer.
 */
export function isHeartbeatVersionConflict(input: {
  expectedVersion: number | undefined;
  current: { isRunning: boolean | null; lastSyncedFrom: string | null } | null;
  source: string;
}): boolean {
  if (input.expectedVersion === undefined || !input.current?.isRunning) {
    return false;
  }
  return (
    input.current.lastSyncedFrom === null ||
    input.current.lastSyncedFrom === input.source
  );
}
