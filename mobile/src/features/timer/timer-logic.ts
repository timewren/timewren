import type { RouterInputs, RouterOutputs } from '~/api/app-router';
import { toCopenhagenISODate } from '~/lib/format';

/**
 * Ren timer-logik uden React og uden netværk — testes i Jest.
 *
 * Princip: vi gemmer STARTTIDSPUNKTET (ISO) og udleder forløbet tid fra
 * det. `baseSeconds` er serverens faste forspring fra tidligere sessioner
 * (pause-funktionen på web) — aldrig lokalt optalt tid.
 */

export type TimerSelection = {
  projectId: string | null;
  clientId: string | null;
  taskId: string | null;
  description: string;
  /** Visningsnavne — cache, serveren er sandheden */
  projectName: string | null;
  clientName: string | null;
};

export type TimerPersisted = TimerSelection & {
  /** ISO-tidspunkt for sessionens start; null = ingen kørende timer */
  startTime: string | null;
  baseSeconds: number;
  /** Serverens optimistiske version (timerSync) */
  version: number;
  /**
   * Sessionen er startet lokalt (uden net) og er endnu ikke bekræftet af
   * serveren. Så længe flaget står, må intet røre serverens timer-state:
   * claim/stop-kæden ville rydde en session, der ikke er vores.
   */
  pendingSync: boolean;
  /**
   * Serverens id for sessionen (timer-sessioner fase 2). Sendes med på hver
   * skrivning, så serveren kun rammer netop denne session — og bliver posten
   * gemt, kan den aldrig blive til to. Null = ukendt (lokal session, ældre
   * server eller en tilstand gemt før feltet fandtes).
   */
  sessionId: string | null;
};

export type ServerTimerState = RouterOutputs['timerSync']['getStateWithVersion'];
export type SyncInput = RouterInputs['timerSync']['sync'];
export type CreateEntryInput = RouterInputs['time']['create'];

/**
 * Valg til et kald af stop-kæden.
 *
 * `ownClaim` er beviset på, at et stopping-intent på serveren er VORT: kun
 * når stop-journalen dækker den session, vi stopper, må claimet genbruges
 * (se `canResumeClaim`). Det er ikke tilfældigt, at kilden ikke kan bruges —
 * `timerSync`s enum har kun web/extension, så web-appen sender det samme
 * `"web"` som mobilen.
 */
export type StopOpts = {
  fallbackDescription: string;
  /** Stop-øjeblikket — fra journalen ved et gentaget stop, ellers nu. */
  now?: Date;
  ownClaim?: boolean;
  /**
   * Serverens `version` i det øjeblik, vi besluttede at rækken skulle reddes
   * eller ryddes. Kun den række med NØJagtig den version må ryddes: en pause
   * brugeren lagde på web efter vores læsning har samme form (ikke kørende,
   * uden claim, med tid i `baseSeconds`) og ville blive nulstillet som om den
   * var vores. Uden værdien ryddes intet — en synlig pause er bedre end tabt tid.
   */
  expectedVersion?: number;
  /**
   * Træk på kundens auto-træk-klippekort (`prepaid-auto.ts`). Standard til;
   * false når klippekort-modulet er slået fra for organisationen.
   */
  autoPrepaid?: boolean;
};

/**
 * timerSync's `source`-enum har kun web/extension — mobilen melder sig som "web".
 * Et "mobile" ville serverens zod afvise, så hvert timer-kald fejlede. Skift
 * først, når serveren har fået værdien i sin enum.
 */
export const TIMER_SOURCE = 'web' as const;

/** Sessioner over et døgn regnes som fejl (spejler web's loft). */
const MAX_SESSION_SECONDS = 86_400;

export const EMPTY_TIMER: TimerPersisted = {
  startTime: null,
  baseSeconds: 0,
  version: 0,
  pendingSync: false,
  sessionId: null,
  projectId: null,
  clientId: null,
  taskId: null,
  description: '',
  projectName: null,
  clientName: null,
};

export function isTimerRunning(state: Pick<TimerPersisted, 'startTime'>): boolean {
  return state.startTime !== null;
}

/** Sandt for en session, der kun findes på enheden (startet uden net). */
export function isLocalOnly(state: Pick<TimerPersisted, 'startTime' | 'pendingSync'>): boolean {
  return state.startTime !== null && state.pendingSync;
}

/** Frisk start, der kun lever lokalt, indtil den gemmes som en tidspost. */
export function startLocal(selection: TimerSelection, startedAt: Date, version = 0): TimerPersisted {
  return {
    ...selection,
    startTime: startedAt.toISOString(),
    baseSeconds: 0,
    version,
    pendingSync: true,
    sessionId: null,
  };
}

/** Forløbet tid i hele sekunder — udledt af startTime, aldrig gemt. */
export function computeElapsedSeconds(
  state: Pick<TimerPersisted, 'startTime' | 'baseSeconds'>,
  now: number = Date.now(),
): number {
  if (!state.startTime)
    return 0;
  const started = new Date(state.startTime).getTime();
  if (!Number.isFinite(started))
    return 0;
  const session = Math.max(0, Math.floor((now - started) / 1000));
  return (state.baseSeconds || 0) + Math.min(session, MAX_SESSION_SECONDS);
}

/** Frisk start: ny session fra `startedAt`. */
export function buildStartSyncInput(selection: TimerSelection, startedAt: Date): SyncInput {
  const ms = startedAt.getTime();
  return {
    isRunning: true,
    startTime: ms,
    sessionStartTime: ms,
    elapsedSeconds: 0,
    baseSeconds: 0,
    projectId: selection.projectId,
    clientId: selection.clientId,
    taskId: selection.taskId,
    description: selection.description,
    source: TIMER_SOURCE,
    isFreshStart: true,
    isAdoption: false,
  };
}

/** Heartbeat/opdatering af en kørende timer (projektskift, beskrivelse). */
export function buildUpdateSyncInput(state: TimerPersisted, now: number = Date.now()): SyncInput {
  const ms = state.startTime ? new Date(state.startTime).getTime() : null;
  return {
    isRunning: true,
    startTime: ms,
    sessionStartTime: ms,
    elapsedSeconds: computeElapsedSeconds(state, now),
    baseSeconds: state.baseSeconds,
    projectId: state.projectId,
    clientId: state.clientId,
    taskId: state.taskId,
    description: state.description,
    source: TIMER_SOURCE,
    isFreshStart: false,
    isAdoption: false,
  };
}

/** Beskrivelse til tidsposten: egen tekst > projekt > kunde > fallback. */
export function resolveEntryDescription(state: TimerSelection, fallback: string): string {
  return state.description.trim() || state.projectName || state.clientName || fallback;
}

/**
 * Navnene på den kørende/valgte tid, som "Kunde · Projekt" — tomt hvis intet
 * er valgt. Én kilde til navnet, så timer-kortets etiket og det, skærmlæseren
 * hører ved start, ikke kan komme til at sige forskellige ting.
 */
export function selectionNames(selection: Pick<TimerSelection, 'clientName' | 'projectName'>): string {
  return [selection.clientName, selection.projectName].filter(Boolean).join(' · ');
}

/** Tidspost ud fra sessionen — samme regler som web's TimerWidget. */
export function buildEntryInput(
  state: TimerPersisted,
  stoppedAt: Date,
  fallbackDescription: string,
): CreateEntryInput {
  const elapsed = computeElapsedSeconds(state, stoppedAt.getTime());
  const hours = Math.max(0.01, Math.round((elapsed / 3600) * 100) / 100);
  const started = state.startTime ? new Date(state.startTime) : stoppedAt;
  return {
    projectId: state.projectId ?? undefined,
    clientId: state.clientId ?? undefined,
    taskId: state.taskId ?? undefined,
    description: resolveEntryDescription(state, fallbackDescription),
    // Dansk kalenderdag, som web og rapporter tæller — ikke telefonens zone.
    date: toCopenhagenISODate(started),
    hours,
    startTime: started.toISOString(),
    endTime: stoppedAt.toISOString(),
    fromTimer: true,
    // Serveren gemmer højst én post pr. session; et gentaget gem får den
    // eksisterende tilbage i stedet for en dublet.
    ...(state.sessionId && { timerSessionId: state.sessionId }),
  };
}

/**
 * Serverens tilstand → lokal tilstand. Kører serveren ikke, får vi en tom
 * timer med serverens version (så næste claim/sync rammer rigtigt).
 */
export function serverToLocal(server: ServerTimerState): TimerPersisted {
  if (!server.isRunning || !server.startTime)
    return { ...EMPTY_TIMER, version: server.version };
  return {
    startTime: server.startTime,
    baseSeconds: server.baseSeconds || 0,
    version: server.version,
    pendingSync: false,
    sessionId: serverSessionId(server),
    projectId: server.projectId ?? null,
    clientId: server.clientId ?? null,
    taskId: null,
    description: server.description ?? '',
    projectName: server.project?.name ?? null,
    clientName: server.client?.name ?? null,
  };
}

/** Serverens sessions-id — en ældre server sender ikke feltet. */
export function serverSessionId(server: Pick<ServerTimerState, 'sessionId'>): string | null {
  return server.sessionId ?? null;
}

/**
 * Kører serveren den session, telefonen viser?
 *
 * Starttiden skal stemme (`isSameSession`) — den er det, posten bygges ud fra.
 * Kender begge sider sessionens id, skal det også stemme: to sessioner kan
 * ikke forveksles, selv om de er startet i samme sekund. Mangler id'et på den
 * ene side (ældre server, lokal tilstand fra før feltet), afgør starttiden alene.
 */
export function isServerSession(
  server: Pick<ServerTimerState, 'startTime' | 'sessionId'>,
  state: Pick<TimerPersisted, 'startTime' | 'sessionId'>,
): boolean {
  if (!isSameSession(server.startTime, state.startTime))
    return false;
  const serverId = serverSessionId(server);
  const localId = state.sessionId ?? null;
  return serverId === null || localId === null || serverId === localId;
}

/** Sandt når serveren er helt ryddet efter et stop+gem fra en anden enhed. */
export function isClearedOnServer(server: ServerTimerState): boolean {
  return !server.isRunning
    && !server.elapsedSeconds
    && !server.baseSeconds
    && server.version > 0;
}

/**
 * Sandt når rækken er lagt til side som en pause uden en gemt post.
 *
 * Serverens cron (`api/cron/timer-cleanup`) parkerer et `stopping`-intent,
 * der har stået over fem minutter, i stedet for at nulstille det — fordi
 * rækken så er det ENESTE sted, sessionen findes. Rækken er altså hverken
 * kørende eller ryddet: den bærer den optalte tid i `baseSeconds`, men der
 * ligger ingen tidspost ved siden af. Skelnes der ikke, tolkes en parkeret
 * række som "posten er gemt", og det afbrudte stop går tabt.
 *
 * Kan ikke skelnes fra en bevidst pause på web, og det behøver det heller
 * ikke: i begge tilfælde mangler posten, så afgørelsen træffes ved at slå
 * den op (se `rescueParkedStop`).
 */
export function isParkedOnServer(server: ServerTimerState): boolean {
  return !server.isRunning && !server.startTime && Boolean(server.baseSeconds || server.elapsedSeconds);
}

/** Står serveren midt i et stop? Uanset hvilken klient der har taget claimet. */
export function isStoppingOnServer(server: ServerTimerState): boolean {
  return server.intent === 'stopping';
}

/**
 * Må vi genbruge et stopping-intent, der allerede står på serveren?
 *
 * `timerSync`s `source`-enum har kun `web` og `extension`, så både web-appen
 * og mobilen sender præcis `"web"` — et claim med `intentFrom: 'web'` er derfor
 * IKKE bevis for, at det er mobilens. Skelnedes der ikke på kilden, overtog
 * mobilen web'ens igangværende stop: den oprettede sin egen post, bekræftede
 * web'ens claim og ryddede rækken — og web'ens egen gemning landede oveni, så
 * samme time blev faktureret to gange.
 *
 * Beviset er lokalt: et claim må kun genbruges, når VI selv har taget det til
 * den session, vi er ved at stoppe — altså når stop-journalen står der fra et
 * stop, der aldrig blev bekræftet (`journalCoversSession`). Kilden bruges kun
 * til at UDELUKE: et claim fra en anden kilde end vores er aldrig vores.
 *
 * Sessions-øjeblikket skal også stemme. `confirmStop` rydder HELE rækken, så
 * et claim på en anden session ville rydde en tid, vi aldrig har gemt.
 */
export function canResumeClaim(
  server: ServerTimerState,
  state: Pick<TimerPersisted, 'startTime' | 'sessionId'>,
  ownClaim: boolean,
): boolean {
  const serverId = serverSessionId(server);
  const localId = state.sessionId ?? null;
  return ownClaim
    && server.intent === 'stopping'
    // En eksplicit ANDEN kilde er bevis på, at claimet ikke er vores. Det
    // samme `source` er derimod intet bevis — web-appen sender det også.
    && server.intentFrom === TIMER_SOURCE
    && server.startTime != null
    && server.startTime === state.startTime
    // Kender begge sider sessionens id, skal også det stemme.
    && (serverId === null || localId === null || serverId === localId);
}

/**
 * Afviste serveren en start som forældet? Genopstandelses-guarden (web #767)
 * svarer `stale_start` på en køet start og `not_running` + `staleStart` på en
 * frisk: tidsrummet er allerede gemt fra en anden enhed. Svaret er ENDELIGT —
 * hvert nyt forsøg får det samme, så det må ikke behandles som en netfejl.
 */
export function isStaleStartRejection(result: { success: boolean; reason?: string | null }): boolean {
  if (result.success)
    return false;
  const staleStart = (result as { staleStart?: boolean }).staleStart === true;
  return result.reason === 'stale_start' || (result.reason === 'not_running' && staleStart);
}

/** Tolerance ved sammenligning af to sessions-starter (afrunding på vejen). */
const SAME_SESSION_TOLERANCE_MS = 1_000;

/**
 * Er serverens session den samme, som telefonen tror kører?
 *
 * `startTime` er sessionens identitet: version flytter sig ved hver heartbeat
 * fra web, så den kan ikke skelne "samme session, nyere skrivning" fra "en
 * helt ny session". Uden dette tjek stoppede en forældet lokal timer (fx
 * notifikationens stop-knap efter et stop+ny start på web) den ANDEN
 * sessions række og gemte sin egne gamle tid i stedet.
 */
export function isSameSession(
  serverStart: string | Date | null | undefined,
  localStart: string | null | undefined,
): boolean {
  const a = toMillis(serverStart);
  const b = toMillis(localStart);
  return a !== null && b !== null && Math.abs(a - b) <= SAME_SESSION_TOLERANCE_MS;
}

/**
 * Felterne som serverens sessions-tjek (web `fix/stop-session-check`) læser
 * på stop/rydning/skift: rækken må kun røres, hvis den stadig er den session,
 * vi har set. En server, der ikke kender felterne, stripper dem (zod), så de
 * er harmløse indtil da.
 */
export type SessionGuard = {
  expectedVersion: number;
  /** Serverens sessions-id — udelades når det er ukendt (ældre server, lokal session). */
  sessionId?: string;
  /**
   * Sessionens start i epoch-ms — samme form som `sync`'s `startTime`.
   * Udelades uden kendt start: serverens zod-skema er `optional()`, ikke `nullable()`.
   */
  expectedStartTime?: number;
};

export function sessionGuard(
  server: Pick<ServerTimerState, 'version'>,
  state: Pick<TimerPersisted, 'startTime' | 'sessionId'>,
): SessionGuard {
  const expectedStartTime = toMillis(state.startTime);
  return {
    expectedVersion: server.version,
    ...(expectedStartTime !== null && { expectedStartTime }),
    ...(state.sessionId && { sessionId: state.sessionId }),
  };
}

/** Tidsposter som serveren svarer med — kun de felter, vi matcher på. */
export type SavedEntryLike = {
  startTime?: Date | string | null;
  endTime?: Date | string | null;
};

function toMillis(value: Date | string | null | undefined): number | null {
  if (value == null)
    return null;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Findes posten fra et tidligere stop af DENNE session allerede?
 *
 * Nøglen er (startTime, endTime) — de to er afledt af sessionens start og
 * stop-øjeblikket, så et gentaget stop med samme journal-opsøger præcis den
 * samme post. Det er det, der gør stop-kæden idempotent: dræber appen
 * mellem `time.create` og `confirmStop`, må genkørsel ALDRIG lave den samme
 * post igen — den ville dobbeltfakturere.
 *
 * Bemærk at serveren svarer med Date (superjson) på den ene side og vi
 * sender ISO-strenge på den anden, så begge normaliseres til millisekunder.
 */
export function findSavedEntry<T extends SavedEntryLike>(
  entries: T[],
  state: Pick<TimerPersisted, 'startTime'>,
  stoppedAt: Date,
): T | null {
  const start = toMillis(state.startTime);
  if (start === null)
    return null;
  const end = stoppedAt.getTime();
  return entries.find(entry => toMillis(entry.startTime) === start && toMillis(entry.endTime) === end) ?? null;
}

/** Standset-et i en stop-journal, som `resolveStopMoment` læser. */
export type PendingStopMoment = {
  stoppedAt: string;
  state: { startTime: string | null };
};

/**
 * Hvilket stop-øjeblik skal et (gen)kald af stop-kæden bruge?
 *
 * `findSavedEntry` matcher på præcis `(startTime, endTime)`, og `endTime`
 * kommer fra `stoppedAt`. Skriver hvert kald sit eget tidspunkt, kan et
 * gentaget stop ikke genkende den post, det første gemte — og samme
 * tidsrum faktureres to gange. Derfor genbruges journalens `stoppedAt`, når
 * den beskriver DEN SAMME session.
 *
 * En journal fra en anden session (eller uden kørende session) hører ikke til
 * dette stop, så den nye kæde får sit eget øjeblik. En beskadiget streng må
 * heller ikke give `Invalid Date` videre som `endTime`.
 */
export function resolveStopMoment(
  pending: PendingStopMoment | null,
  state: Pick<TimerPersisted, 'startTime'>,
  now: Date,
): Date {
  if (!journalCoversSession(pending, state))
    return now;
  const reused = new Date(pending.stoppedAt);
  return Number.isFinite(reused.getTime()) ? reused : now;
}

/**
 * Beskriver journalen præcis DEN session, der stoppes nu?
 *
 * Det er både betingelsen for at genbruge `stoppedAt` (samme post skal genkendes)
 * og beviset for, at et stopping-intent på serveren er VORT (se `canResumeClaim`).
 */
export function journalCoversSession(
  pending: PendingStopMoment | null,
  state: Pick<TimerPersisted, 'startTime'>,
): pending is PendingStopMoment & { state: { startTime: string } } {
  return pending?.state.startTime != null && pending.state.startTime === state.startTime;
}

/**
 * Afstemning: serveren mod den lokale session.
 *
 * Undtagelsen er en LOKAL session (startet uden net). Den findes kun på
 * enheden, så serveren kan hverken bekræfte eller rydde den. Uden denne
 * regel ville afstemningen slette en igangværende timer ved hvert app-start
 * og hvert forgrundsskift — altså tabe tid, præcis det vi bygger imod.
 *
 * Den anden undtagelse er omvendt: en session serveren stadig kører, som vi
 * selv har stoppet og lagt i `stoppedInQueue`. Her er det den LOKALE tilstand
 * der er rigtig — posten ligger i køen, og serverens række er bare ikke
 * ryddet endnu.
 *
 * @param server Serverens timer-state.
 * @param local Den lokale, persisterede session.
 * @param stoppedInQueue `startTime` for timere, der er stoppet uden net og
 *   venter i køen på at blive synkroniseret (`stoppedSessionsInQueue`).
 */
export function mergeServerAndLocal(server: ServerTimerState, local: TimerPersisted, stoppedInQueue: readonly string[] = []): TimerPersisted {
  if (isLocalOnly(local))
    return local;
  // Serveren kører præcis den session, vi selv stoppede uden net, og posten
  // ligger endnu i køen. Rækken ryddes først når dræningen har synkroniseret
  // den, så en afstemning i mellemtiden ville genoplusse timeren med en
  // længere tid — og næste stop ville gemme det samme tidsrum en gang til.
  if (server.isRunning && server.startTime && stoppedInQueue.includes(server.startTime))
    return local;
  const next = serverToLocal(server);
  if (!next.startTime)
    return next;
  // Behold lokale visningsnavne/opgave hvis serveren peger på det samme.
  const sameSelection = next.projectId === local.projectId && next.clientId === local.clientId;
  return sameSelection
    ? { ...next, taskId: local.taskId, projectName: next.projectName ?? local.projectName, clientName: next.clientName ?? local.clientName }
    : next;
}
