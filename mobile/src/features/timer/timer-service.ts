import type { CreateEntryInput, ServerTimerState, SessionGuard, StopOpts, TimerPersisted, TimerSelection } from './timer-logic';
import type { RouterInputs } from '~/api/app-router';
import { mayHaveSaved } from '~/features/offline/queue-logic';
import { trpcClient } from '~/lib/api/trpc';
import { isPrepaidDeductionError, resolveAutoPrepaidId } from './prepaid-auto';
import {
  buildEntryInput,
  buildStartSyncInput,
  buildUpdateSyncInput,
  canResumeClaim,
  computeElapsedSeconds,
  findSavedEntry,
  isClearedOnServer,
  isServerSession,
  isStaleStartRejection,
  isStoppingOnServer,
  mergeServerAndLocal,
  serverSessionId,
  serverToLocal,
  sessionGuard,
  TIMER_SOURCE,
} from './timer-logic';

/**
 * Netværkskoreografi mod `timerSync` — ingen React, ingen UI.
 * Kun ÉN kørende timer pr. bruger: vi spørger altid serveren først og
 * adopterer dens timer frem for at overskrive den.
 */

export type StartResult
  = | { kind: 'started'; state: TimerPersisted }
    | { kind: 'adopted'; state: TimerPersisted }
    | { kind: 'blocked'; reason: string };

export type StopResult
  = | { kind: 'saved'; hours: number; complianceWarnings: string[]; alreadySaved?: boolean; prepaidSkipped?: boolean }
    /**
     * Posten ER gemt, men claimet kunne ikke bekræftes. Tiden er altså ikke
     * tabt — kun serverens timer-række hænger. Journalen bliver liggende, så
     * næste recovery bekræfter (og springer posten over, den findes jo).
     */
    | { kind: 'saved_unconfirmed'; hours: number }
    | { kind: 'stopped_elsewhere' }
    /**
     * Serveren kører en ANDEN session end den, telefonen viser (stoppet og
     * startet igen på web, lagt på pause, …). Intet er rørt: den lokale
     * tilstand skal afstemmes, så brugeren ser den aktuelle timer.
     */
    | { kind: 'session_changed' }
    | { kind: 'claim_failed'; reason: string }
    /**
     * `claimKept`: gemningen fejlede uden et endeligt svar (tabt svar, netfejl,
     * 5xx), så posten KAN ligge på serveren. Claimet frigives ikke — et
     * `cancelStop` ville lade en gemt session køre videre (#783). Journalen
     * bliver liggende, og næste stop/recovery gør kæden færdig uden dublet.
     */
    | { kind: 'save_failed'; error: unknown; claimKept?: boolean };

export type SaveResult = { kind: 'saved'; hours: number; complianceWarnings: string[]; prepaidSkipped?: boolean };

/** Serverens svar, når rækken ikke (længere) er den session, vi så. */
const SESSION_MISMATCH_REASONS = new Set(['no_timer', 'session_mismatch']);

/** `cancelStop` afvist, fordi sessionen allerede er gemt: stoppet ER gennemført. */
const ALREADY_SAVED = 'already_saved';

/** Sessionens øjebliksbillede, som serveren returnerer fra et claim (#785). */
type ClaimedSession = {
  projectId: string | null;
  clientId: string | null;
  taskId?: string | null;
  description?: string | null;
};

/**
 * Posten bygges ud fra SERVERENS session, ikke telefonens kopi (#785): er
 * projektet skiftet på en anden enhed siden sidste afstemning, ville posten
 * ellers lande på det gamle projekt (og trække på det forkerte klippekort).
 * Visningsnavnene tages fra serverens række, når den peger på samme projekt;
 * ellers kendes de ikke, og beskrivelsen falder tilbage på standardteksten.
 */
function withServerDetails(
  state: TimerPersisted,
  session: ClaimedSession,
  server: Pick<ServerTimerState, 'projectId' | 'clientId' | 'project' | 'client'>,
): TimerPersisted {
  const projectId = session.projectId ?? null;
  const clientId = session.clientId ?? null;
  const projectName = projectId === state.projectId
    ? state.projectName
    : projectId && server.projectId === projectId ? server.project?.name ?? null : null;
  const clientName = clientId === state.clientId
    ? state.clientName
    : clientId && server.clientId === clientId ? server.client?.name ?? null : null;
  return {
    ...state,
    projectId,
    clientId,
    projectName,
    clientName,
    taskId: session.taskId === undefined ? state.taskId : session.taskId,
    // Serverens tekst vinder — også en tom (ryddet på en anden enhed).
    description: session.description ?? state.description,
  };
}

type CreateOutcome = { complianceWarnings: string[]; prepaidSkipped: boolean };

function warningsOf(created: unknown): string[] {
  return (created as { complianceWarnings?: string[] } | null)?.complianceWarnings ?? [];
}

/**
 * Opret timer-posten — med klippekort efter den fælles auto-træk-regel.
 *
 * Afviser serveren posten PÅ GRUND AF kortet (udløbet, opbrugt, inaktivt),
 * gemmes tiden uden kort i stedet, ligesom extensionen gør: en registrering
 * må aldrig gå tabt på et klippekort. Afvisningen ruller hele transaktionen
 * tilbage, så genkaldet laver ikke en dublet.
 */
async function createTimerEntry(
  entryInput: CreateEntryInput,
  state: Pick<TimerPersisted, 'clientId'>,
  opts: Pick<StopOpts, 'autoPrepaid'> & { at: Date },
): Promise<CreateOutcome> {
  const prepaidPackageId = opts.autoPrepaid === false ? null : await resolveAutoPrepaidId(state.clientId, opts.at);
  if (!prepaidPackageId)
    return { complianceWarnings: warningsOf(await trpcClient.time.create.mutate(entryInput)), prepaidSkipped: false };
  try {
    const created = await trpcClient.time.create.mutate({ ...entryInput, prepaidPackageId });
    return { complianceWarnings: warningsOf(created), prepaidSkipped: false };
  }
  catch (error) {
    if (!isPrepaidDeductionError(error))
      throw error;
    return { complianceWarnings: warningsOf(await trpcClient.time.create.mutate(entryInput)), prepaidSkipped: true };
  }
}

/**
 * Serverens rå tilstand. Recovery har brug for `isRunning`, som den
 * lokale form ikke bærer med.
 */
export function fetchRawServerTimer(): Promise<ServerTimerState> {
  return trpcClient.timerSync.getStateWithVersion.query();
}

export async function fetchServerTimer(): Promise<TimerPersisted & { pendingStopInProgress?: boolean }> {
  const server = await fetchRawServerTimer();
  return server.intent === 'stopping'
    ? { ...serverToLocal(server), pendingStopInProgress: true }
    : serverToLocal(server);
}

/**
 * Start en ny session. Kører der allerede en timer på serveren (fx fra
 * web), overtager vi den i stedet for at starte en ny.
 */
export async function startTimerOnServer(selection: TimerSelection, now: Date = new Date()): Promise<StartResult> {
  const existing = await fetchServerTimer();
  // Serveren står med et uafsluttet stop. Den kørende session er så allerede
  // gemt som post, så den må hverken adopteres eller startes oveni — det ville
  // tælle det samme tidsrum to gange. `recoverPendingStop` færdiggør i stedet
  // stoppet, hvorefter næste start virker normalt.
  if (existing.pendingStopInProgress)
    return { kind: 'blocked', reason: 'stopping_in_progress' };
  if (existing.startTime)
    return { kind: 'adopted', state: existing };

  const result = await trpcClient.timerSync.sync.mutate(buildStartSyncInput(selection, now));
  if (result.success) {
    return {
      kind: 'started',
      state: {
        ...selection,
        startTime: now.toISOString(),
        baseSeconds: 0,
        version: result.version,
        pendingSync: false,
        sessionId: (result as { sessionId?: string | null }).sessionId ?? null,
      },
    };
  }
  if (result.reason === 'already_running') {
    const adopted = await fetchServerTimer();
    if (adopted.startTime)
      return { kind: 'adopted', state: adopted };
  }
  // `not_running` + `staleStart`: genopstandelses-guarden afviste starten, fordi
  // tidsrummet allerede er gemt. Endeligt — samme svar ved hvert forsøg.
  if (isStaleStartRejection(result))
    return { kind: 'blocked', reason: 'stale_start' };
  return { kind: 'blocked', reason: result.reason ?? 'unknown' };
}

/**
 * Opdatér projekt/kunde/beskrivelse på den kørende session (heartbeat-sync).
 *
 * Læser serveren først: kører den en anden session end vores (stoppet og
 * startet igen på web), ville heartbeat'en ellers skrive vores gamle start og
 * kunde ind over den nye session. Null = afstem i stedet.
 */
export async function updateTimerOnServer(state: TimerPersisted): Promise<TimerPersisted | null> {
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  if (!server.isRunning || isStoppingOnServer(server) || !isServerSession(server, state))
    return null;
  // Et id lært ved afstemningen bæres med, også når den lokale kopi er ældre.
  const known = { ...state, sessionId: state.sessionId ?? serverSessionId(server) };
  const input: RouterInputs['timerSync']['sync'] & SessionGuard = {
    ...buildUpdateSyncInput(known),
    ...sessionGuard(server, known),
  };
  const result = await trpcClient.timerSync.sync.mutate(input);
  if (result.success)
    return { ...known, version: result.version, sessionId: (result as { sessionId?: string | null }).sessionId ?? known.sessionId };
  // Serveren kører ikke længere vores session (stoppet fra en anden enhed,
  // `session_mismatch`, midt i et stop) — tag dens tilstand.
  return null;
}

/**
 * Stop-flow i fast rækkefølge: getStateWithVersion → claimForStop →
 * time.create → confirmStop. Fejler gemningen, frigives claimet med
 * cancelStop, så timeren kører videre både lokalt og på serveren.
 *
 * Kæden er IDEMPOTENT, fordi et afbrudt stop ellers efterlader serveren i
 * `intent: 'stopping'` — og så afviser `claimForStop` med
 * `already_stopping` for evigt, hvilket gjorde timeren umulig at stoppe
 * igen. Derfor:
 *  1. står serveren med VORT eget stopping (bevis: `opts.ownClaim`), tages
 *     intet nyt claim, men den eksisterende version bruges (serveren svarer
 *     ellers med `no_timer`, fordi rækken er markeret i flugt);
 *  2. slås posten op før den oprettes igen, så et dræb mellem `time.create`
 *     og `confirmStop` ikke dobbeltfakturerer;
 *  3. prøves `confirmStop` igen på `version_mismatch` — ellers bliver rækken
 *     hængende i 'stopping' til cronen parker den.
 *
 * Et claim uden bevis for, at det er vort (altså web'ens eller extensionens)
 * røres ikke: kæden stopper med `already_stopping`, så vi hverken opretter en
 * post oveni eller bekræfter en række, der ikke er vores.
 */
export async function stopTimerOnServer(
  state: TimerPersisted,
  opts: StopOpts,
): Promise<StopResult> {
  const now = opts.now ?? new Date();
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  if (isClearedOnServer(server))
    return { kind: 'stopped_elsewhere' };

  // Et afbrudt stop efterlader rækken i `intent: 'stopping'`, og så afviser
  // `claimForStop` med `already_stopping` for evigt. Vort eget claim må derfor
  // genbruges i stedet for at tages på ny — men kun når journalen beviser, at
  // det faktisk er vores. Ellers ville mobilen overtage web'ens stop (samme
  // source) og gemme det samme tidsrum to gange.
  if (server.intent === 'stopping') {
    if (!canResumeClaim(server, state, opts.ownClaim === true))
      return { kind: 'claim_failed', reason: 'already_stopping' };
    // Rækken står frosset i vores claim, så dens detaljer ER sessionens.
    // `getStateWithVersion` mangler opgaven; den hentes fra `getState`.
    const taskId = await fetchRowTaskId();
    const resumed = withServerDetails(
      { ...state, sessionId: serverSessionId(server) ?? state.sessionId ?? null },
      { projectId: server.projectId, clientId: server.clientId, description: server.description, taskId },
      server,
    );
    return finishStop({ state: resumed, now, opts, version: server.version });
  }

  // Serveren kører ikke den session, vi stopper: et claim ville stoppe (og
  // `confirmStop` rydde) en anden sessions tid, mens vi gemte vores gamle.
  if (!server.isRunning || !isServerSession(server, state))
    return { kind: 'session_changed' };

  const known = { ...state, sessionId: state.sessionId ?? serverSessionId(server) };
  const claimInput: RouterInputs['timerSync']['claimForStop'] & SessionGuard = {
    source: TIMER_SOURCE,
    ...sessionGuard(server, known),
  };
  const claim = await trpcClient.timerSync.claimForStop.mutate(claimInput);
  if (!claim.success) {
    const reason: string = claim.reason ?? 'unknown';
    if (SESSION_MISMATCH_REASONS.has(reason))
      return { kind: 'session_changed' };
    return { kind: 'claim_failed', reason };
  }

  // En ældre server sender hverken id eller øjebliksbillede med claimet.
  const claimed = claim as { sessionId?: string | null; session?: ClaimedSession | null };
  const withId = { ...known, sessionId: claimed.sessionId ?? known.sessionId ?? null };
  const stopped = claimed.session ? withServerDetails(withId, claimed.session, server) : withId;
  return finishStop({ state: stopped, now, opts, version: claim.version });
}

/**
 * Opgaven på serverens række — undefined når den ikke kan læses, så den
 * lokale værdi bevares i stedet for at blive ryddet på et netbump.
 */
async function fetchRowTaskId(): Promise<string | null | undefined> {
  try {
    const row = await trpcClient.timerSync.getState.query();
    return row.taskId ?? null;
  }
  catch {
    return undefined;
  }
}

type FinishArgs = {
  state: TimerPersisted;
  now: Date;
  opts: StopOpts;
  /** Claim-version, der skal bekræftes — aldrig et gammelt version-tal. */
  version: number;
};

/**
 * Slutningen af stop-kæden: opret posten (medmindre den findes i forvejen)
 * og bekræft claimet.
 */
async function finishStop({ state, now, opts, version }: FinishArgs): Promise<StopResult> {
  const entryInput = buildEntryInput(state, now, opts.fallbackDescription);
  const alreadySaved = findSavedEntry(
    (await trpcClient.time.list.query({
      startDate: entryInput.date,
      endDate: entryInput.date,
      onlyOwn: true,
      limit: 50,
    })).entries,
    state,
    now,
  ) !== null;

  let outcome: CreateOutcome = { complianceWarnings: [], prepaidSkipped: false };
  try {
    if (!alreadySaved)
      outcome = await createTimerEntry(entryInput, state, { autoPrepaid: opts.autoPrepaid, at: now });
  }
  catch (error) {
    // Uden et endeligt svar kan posten ligge gemt (svaret gik tabt). Så må
    // claimet ikke frigives: sessionen ville køre videre og blive gemt igen
    // (#783). Journalen gør kæden færdig — `timerSessionId`/`findSavedEntry`
    // sikrer, at genkaldet ikke laver posten igen.
    if (mayHaveSaved(error))
      return { kind: 'save_failed', error, claimKept: true };
    const cancelled = await trpcClient.timerSync.cancelStop.mutate({
      version,
      source: TIMER_SOURCE,
      ...(state.sessionId && { sessionId: state.sessionId }),
    }).catch(() => null);
    // Serveren har allerede sessionens post (fx et samtidigt gem) og har
    // selv gjort stoppet færdigt: intet at annullere, intet at prøve igen.
    if (cancelled && !cancelled.success && cancelled.reason === ALREADY_SAVED)
      return { kind: 'saved', hours: entryInput.hours, complianceWarnings: [], alreadySaved: true };
    return { kind: 'save_failed', error };
  }

  if (!await confirmStop(version, state.sessionId))
    return { kind: 'saved_unconfirmed', hours: entryInput.hours };

  return {
    kind: 'saved',
    hours: entryInput.hours,
    complianceWarnings: outcome.complianceWarnings,
    ...(alreadySaved && { alreadySaved: true }),
    ...(outcome.prepaidSkipped && { prepaidSkipped: true }),
  };
}

/**
 * `confirmStop` med afgrænset genkørsel på `version_mismatch`: en anden
 * skrivning (fx en heartbeat fra web) kan flytte rækkens version mellem
 * claim og confirm. Serveren giver den nye version tilbage, så vi bruger
 * den — ligesom web-appen gør.
 */
async function confirmStop(version: number, sessionId: string | null): Promise<boolean> {
  let next = version;
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await trpcClient.timerSync.confirmStop.mutate({
      version: next,
      source: TIMER_SOURCE,
      ...(sessionId && { sessionId }),
    });
    if (result.success)
      return true;
    if (result.reason === 'version_mismatch' && typeof result.version === 'number') {
      next = result.version;
      continue;
    }
    // no_timer / not_stopping / wrong_source / session_mismatch: intet mere at bekræfte.
    return false;
  }
  return false;
}

export type DiscardResult = { kind: 'discarded' } | { kind: 'session_changed' };

/**
 * Kassér sessionen uden at gemme — lokalt og på serveren.
 *
 * `clear` nulstiller hele rækken, så den må kun sendes, når serveren stadig
 * kører PRÆCIS vores session. Er den stoppet og startet igen på web, lagt på
 * pause eller midt i et stop, ville kassér ellers slette en anden sessions tid.
 * En tom række er allerede ryddet — så er der intet at sende.
 */
export async function discardTimerOnServer(state: Pick<TimerPersisted, 'startTime' | 'sessionId'>): Promise<DiscardResult> {
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  const empty = !server.isRunning && !server.startTime && !server.baseSeconds && !server.elapsedSeconds;
  if (empty && !isStoppingOnServer(server))
    return { kind: 'discarded' };
  if (!server.isRunning || isStoppingOnServer(server) || !isServerSession(server, state))
    return { kind: 'session_changed' };
  const input: RouterInputs['timerSync']['clear'] & SessionGuard = {
    source: TIMER_SOURCE,
    ...sessionGuard(server, { ...state, sessionId: state.sessionId ?? serverSessionId(server) }),
  };
  const result = await trpcClient.timerSync.clear.mutate(input) as { success?: boolean; reason?: string } | undefined;
  if (result?.success === false && SESSION_MISMATCH_REASONS.has(result.reason ?? ''))
    return { kind: 'session_changed' };
  return { kind: 'discarded' };
}

export type ParkedRescueResult
  = | { kind: 'saved'; hours: number; complianceWarnings: string[]; alreadySaved: boolean }
    | { kind: 'save_failed'; error: unknown };

/**
 * Red et afbrudt stop, som cronen har parkeret som pause (se
 * `isParkedOnServer`).
 *
 * Claim-kæden kan ikke bruges: serveren kører ikke længere, så
 * `claimForStop` ville svare `no_timer`. I stedet slås posten op først —
 * blev den gemt af det afbrudte stop, må den ikke laves igen — og ellers
 * genoprettes den fra journalens `stoppedAt`, så den bliver bit-for-bit
 * den post, brugeren stoppede. Rækken ryddes bagefter, så den parkerede
 * pause ikke hænger ved som en synlig rest.
 *
 * Rækken ryddes kun hvis den stadig står parkeret OG har den version, vi så
 * da vi besluttede at redde (se `clearParkedRow`). Er der i mellemtiden
 * startet en ny session (på web eller en anden telefon), eller lagt en pause,
 * røres den ikke.
 */
export async function rescueParkedStop(
  state: TimerPersisted,
  opts: StopOpts,
): Promise<ParkedRescueResult> {
  // Uden et stop-øjeblik fra journalen er det her og nu, sessionen reddes til.
  const stoppedAt = opts.now ?? new Date();
  const entryInput = buildEntryInput(state, stoppedAt, opts.fallbackDescription);
  const alreadySaved = findSavedEntry(
    (await trpcClient.time.list.query({
      startDate: entryInput.date,
      endDate: entryInput.date,
      onlyOwn: true,
      // Serveren sorterer nyeste først, så vores post ligger SIDST på dagen.
      // En lille limit ville finde den i de sjældne dage med mange poster — og
      // så oprettede vi den igen, altså dobbeltfakturerede.
      limit: 200,
    })).entries,
    state,
    stoppedAt,
  ) !== null;

  let outcome: CreateOutcome = { complianceWarnings: [], prepaidSkipped: false };
  try {
    if (!alreadySaved)
      outcome = await createTimerEntry(entryInput, state, { autoPrepaid: opts.autoPrepaid, at: stoppedAt });
  }
  catch (error) {
    return { kind: 'save_failed', error };
  }

  await clearParkedRow(opts.expectedVersion);
  return { kind: 'saved', hours: entryInput.hours, complianceWarnings: outcome.complianceWarnings, alreadySaved };
}

/**
 * Ryd kun den række, vi lige har redet — og kun hvis den stadig er den.
 *
 * `clear` nulstiller hele rækken: `isRunning`, `startTime`, `elapsedSeconds`,
 * `baseSeconds`, projekt, kunde og beskrivelse. Det er rigtigt for den
 * parkerede rest fra et afbrudt stop, for den skal ikke vise som en pause
 *Brugeren sådan aldrig anmodede om.
 *
 * Men rækken kan være blevet skrevet om, siden vi læste den. Den mest
 * realistiske: brugeren åbner web, lægger en pause med egen tid i
 * `baseSeconds`, og imens vores redning kører. Pauseformen er IDENTISK med
 * den parkerede rest (ikke kørende, intet claim, tid i `baseSeconds`), så
 * `isRunning`/`intent` kan ikke skelne — og `clear` ville slette den pause og
 * dermed den tid, brugeren lige har registreret.
 *
 * Derfor kræver rydningen den præcise version, vi så, da vi besluttede at
 * redde. Beviset på, at rækken stadig er den, vi redder, er altså serverens
 * egen versions-tæller — samme greb som web's cron bruger i sin race-guard.
 * Kan vi ikke se versionen, rydder vi intet: en pause der bliver stående er
 * en synlig, redelig tilstand, tabt tid er ikke.
 */
async function clearParkedRow(expectedVersion: number | undefined): Promise<void> {
  const server = await trpcClient.timerSync.getStateWithVersion.query();
  if (server.isRunning || isStoppingOnServer(server))
    return;
  if (expectedVersion === undefined || server.version !== expectedVersion)
    return;
  await trpcClient.timerSync.clear.mutate({ source: TIMER_SOURCE });
}

/**
 * Gem en session, serveren aldrig har set (startet uden net).
 *
 * Claim-kæden bruges IKKE: serveren har ingen session at claime, så
 * `claimForStop` ville enten fejle med `no_timer` — eller værre: tage et claim
 * på en helt anden enheds kørende timer og rydde den. Derfor gemmes posten
 * direkte, og serverens timer-state røres ikke.
 */
export async function saveLocalOnlyTimer(
  state: TimerPersisted,
  opts: StopOpts,
): Promise<SaveResult> {
  const now = opts.now ?? new Date();
  const entryInput = buildEntryInput(state, now, opts.fallbackDescription);
  const outcome = await createTimerEntry(entryInput, state, { autoPrepaid: opts.autoPrepaid, at: now });
  return {
    kind: 'saved',
    hours: entryInput.hours,
    complianceWarnings: outcome.complianceWarnings,
    ...(outcome.prepaidSkipped && { prepaidSkipped: true }),
  };
}

/**
 * Afstem lokal tilstand med serveren (app-start/forgrund). Serverens
 * kørende timer vinder; er serveren stoppet, ryddes den lokale — med
 * undtagelse af en lokal session, serveren aldrig har set, og af en session
 * vi selv har stoppet og lagt i `stoppedInQueue` (se `mergeServerAndLocal`).
 */
export async function reconcileTimer(local: TimerPersisted, stoppedInQueue: readonly string[] = []): Promise<TimerPersisted> {
  const server = await fetchRawServerTimer();
  return mergeServerAndLocal(server, local, stoppedInQueue);
}

export { computeElapsedSeconds };
