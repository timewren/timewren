import type { TimerPersisted } from './timer-logic';
import type { StopResult } from './timer-service';
import type { Capabilities } from '~/features/capabilities/use-capabilities';
import { isOffline } from '~/features/offline/enqueue';
import { isAuthFailure, mayHaveSaved, stoppedSessionsInQueue } from '~/features/offline/queue-logic';
import { offlineQueue } from '~/features/offline/queue-store';
import { dropQueuedStarts, hasQueuedStart, queueTimerStop } from '~/features/offline/timer-offline';
import { errorMessage } from '~/lib/api';
import { isNetworkFailure } from '~/lib/api/error-reporting';
import { queryClient } from '~/lib/api/provider';
import { formatHours } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { captureError } from '~/lib/monitoring';
import { showMessage } from '~/lib/notify';
import { withStopLock } from './stop-lock';
import { computeElapsedSeconds, isLocalOnly, isTimerRunning, journalCoversSession, resolveStopMoment } from './timer-logic';
import { getPendingStop, recoverPendingStop, setPendingStop } from './timer-recovery';
import { reconcileTimer, saveLocalOnlyTimer, stopTimerOnServer } from './timer-service';
import { getTimerState, timerActions } from './timer-store';

/**
 * Stop-kæden som en ren async-funktion — uden React.
 *
 * Den skal kunne kaldes to steder: fra `useTimer().stop()` i appen og fra
 * stop-knappen i notifikationen, der ligger uden for React-træet. Derfor er
 * de tre bivirkninger (busy-indikator, cache-invalidering, afstemning)
 * valgfrie afhængigheder i stedet for hook-afhængigheder — ellers ville vi få
 * to stop-implementeringer, der kan komme til at divergere, og en dræbt app
 * ville miste den ene af dem.
 */

export type StopDeps = {
  setBusy?: (busy: boolean) => void;
  invalidate?: () => void;
  /** Uden denne køres standard-afstemningen; springes over når offline. */
  reconcile?: () => Promise<void>;
};

const INVALIDATE_PATHS = [['time'], ['prepaid'], ['timerSync']] as const;

/** Standard-invalidering uden React: tRPC-nøglen er `[[procedure], { input }]`. */
function invalidateTimerQueries() {
  for (const path of INVALIDATE_PATHS)
    void queryClient.invalidateQueries({ queryKey: [path] });
}

/**
 * Klippekort-modulet slået fra for organisationen? Læses fra cachen af
 * `mobile.getCapabilities` (samme regel som `deriveCapabilities`), fordi stoppet
 * også kører uden React — fra notifikationen. Ukendt = prøv: serveren afgør
 * selv, og et kort der afvises, gemmes uden kort.
 */
function autoPrepaidAllowed(): boolean {
  try {
    const cached = queryClient.getQueriesData<Capabilities>({ queryKey: [['mobile', 'getCapabilities']] });
    const data = cached.find(([, d]) => d)?.[1];
    if (!data?.org)
      return true;
    return data.modules?.klippekort?.enabled === true;
  }
  catch {
    return true;
  }
}

/** Sammenligningsnøgle for den lokale session — ændres den undervejs, er afstemningen forældet. */
function sessionKey(state: TimerPersisted): string {
  return `${state.startTime}|${state.version}|${state.pendingSync}|${state.projectId}|${state.clientId}|${state.sessionId}`;
}

/**
 * Afstem mod serveren: færdiggør først et afbrudt stop, ellers ville vi se
 * den kørende session og tro, at brugeren stadig tider.
 *
 * Kører også periodisk (`useTimerFreshness`), så svaret må kun lægges ind,
 * hvis den lokale tilstand ikke har flyttet sig, mens vi ventede: en start
 * eller et skift, der landede imens, er nyere end det, serveren svarede.
 */
export async function reconcileTimerNow(): Promise<void> {
  await recoverPendingStop({ fallbackDescription: translate('timer.default_description') });
  try {
    const before = getTimerState();
    // Sessioner vi selv har stoppet uden net, står stadig som "kørende" på
    // serveren, indtil køens dræning rydder dem. Uden listen ville afstemningen
    // adoptere dem, og næste stop ville gemme det samme tidsrum igen.
    const next = await reconcileTimer(before, stoppedSessionsInQueue(offlineQueue().items));
    if (sessionKey(getTimerState()) === sessionKey(before))
      timerActions().replace(next);
  }
  catch {
    // Offline: behold lokal tilstand, prøv igen ved næste forgrund.
  }
}

/**
 * Stop køet bag det fælles stop-lock.
 *
 * Notifikationsknappen, appens egen knap og en afstemning kan alle nå
 * stop-kæden for den samme session. Uden låsen lavede hvert kald sit eget
 * `stoppedAt`, så et gentaget stop ikke kunne genkende den post, et tidligere
 * kald gemte — og tiden blev faktureret to gange. Det genkald, der står i
 * køen, ser den nye tilstand (serverens session er ryddet, eller journalen er
 * væk), så det går ikke tabt.
 */
export function stopTimerNow(deps: StopDeps = {}): Promise<boolean> {
  return withStopLock(() => runStop(deps));
}

async function runStop(deps: StopDeps): Promise<boolean> {
  const { setBusy, invalidate = invalidateTimerQueries } = deps;
  const reconcile = deps.reconcile ?? reconcileTimerNow;
  const snapshot = getTimerState();
  if (!isTimerRunning(snapshot))
    return false;
  // Ét stop-øjeblik for hele kæden: det er `endTime` på posten, og nøglen
  // `findSavedEntry` matcher på. Ligger der allerede en journal for DENNE
  // session, genbruges dens tidspunkt, så et gentaget stop rammer den samme
  // post i stedet for at lave en ny.
  const pending = getPendingStop();
  const now = resolveStopMoment(pending, snapshot, new Date());
  // Beviset for at et stopping-intent på serveren er VORT — kun en journal for
  // DENNE session tæller. Skelnes der ikke, overtager mobilen web'ens stop, for
  // begge sender `source: 'web'`, og samme time gemmes to gange. Læses FØR den
  // egen journal skrives, ellers ville ethvert stop tro, at det var et genkald.
  const ownClaim = journalCoversSession(pending, snapshot);
  // Beregnes i stop-øjeblikket — ingen ticker, så skærmen ikke gen-renderes hvert sekund.
  const failedText = () => translate('timer.save_failed', { hours: formatHours(computeElapsedSeconds(snapshot) / 3600) });
  // Også online, når sessionens start stadig ligger i køen (#703): så skal
  // stoppet bag starten i køen — ellers gemmes posten først, og starten
  // afspilles bagefter som en timer, ingen stopper.
  if (isOffline() || (isLocalOnly(snapshot) && hasQueuedStart(snapshot.startTime))) {
    // Uden net kan vi ikke claime på serveren: gem posten i køen og stop lokalt.
    // Køens egen post er skrivebogen her, så ingen stop-journal nødvendig.
    const hours = queueTimerStop(snapshot, translate('timer.default_description'), { now });
    timerActions().reset();
    showMessage({ message: translate('offline.timer_saved', { hours: formatHours(hours) }), description: translate('offline.saved_body'), type: 'info' });
    invalidate();
    return true;
  }
  if (isLocalOnly(snapshot)) {
    // Startet uden net: serveren har ingen session at claime, så claim-kæden
    // må ikke bruges — den ville tage et claim på en helt anden enheds timer.
    return stopLocalOnlySession({ snapshot, now, failedText, invalidate });
  }
  setBusy?.(true);
  try {
    // Journal først: går appen død i kæden getState→claim→create→confirm,
    // er dette det eneste, der fortæller næste start at stoppet aldrig blev
    // gemt. Ryddes igen i hvert eneste kendte udfald.
    setPendingStop({ state: snapshot, stoppedAt: now.toISOString() });
    const result = await stopTimerOnServer(snapshot, {
      fallbackDescription: translate('timer.default_description'),
      now,
      ownClaim,
      autoPrepaid: autoPrepaidAllowed(),
    });
    if (result.kind === 'saved') {
      setPendingStop(null);
      timerActions().reset();
      showSaved(result);
      invalidate();
      return true;
    }
    if (result.kind === 'saved_unconfirmed') {
      captureError(new Error('timer.stop: saved_unconfirmed'), { reason: 'saved_unconfirmed' });
      // Posten ligger gemt, men serverens claim kunne ikke bekræftes, så
      // rækken hænger i 'stopping' og næste claim ville blive afvist med
      // `already_stopping`. Den lokale timer ryddes (tiden ER gemt), men
      // journalen BEHOLDES: næste recovery bekræfter, og springer posten
      // over, så hverken tid tabes eller dobbeltfaktureres.
      timerActions().reset();
      showMessage({ message: translate('timer.saved', { hours: formatHours(result.hours) }), type: 'success' });
      invalidate();
      return true;
    }
    if (result.kind === 'stopped_elsewhere' || result.kind === 'session_changed' || result.kind === 'claim_failed')
      return handleNotStopped(result, { invalidate, reconcile });
    // save_failed: journalen ryddes KUN når serveren afviste endeligt — ellers
    // kan et genkald ikke genkende den post, kaldet må have oprettet (se
    // `mayHaveSaved`). Endelig afvisning: cancelStop er sendt, timeren kører
    // videre begge steder. Ellers står claimet (`claimKept`, #783), og næste
    // stop eller afstemning gør kæden færdig ud fra journalen.
    if (!mayHaveSaved(result.error))
      setPendingStop(null);
    if (!isAuthFailure(result.error))
      captureError(result.error, { reason: 'save_failed' });
    if (result.claimKept) {
      showMessage({ message: translate('timer.save_uncertain'), type: 'warning' });
      return false;
    }
    showMessage({ message: errorMessage(result.error, failedText()), type: 'danger' });
    return false;
  }
  catch (error) {
    // Her ved vi ikke, hvor langt kæden nåede, før nettet/appen døde.
    // Journalen BLIVER liggende, så næste start kan genkøre stoppet.
    if (!isNetworkFailure(error) && !isAuthFailure(error))
      captureError(error, { reason: 'stop_chain_threw' });
    showMessage({ message: errorMessage(error, failedText()), type: 'danger' });
    return false;
  }
  finally {
    setBusy?.(false);
  }
}

type NotStopped = Extract<StopResult, { kind: 'stopped_elsewhere' | 'session_changed' | 'claim_failed' }>;

/** Stop-kæden endte uden at gemme noget — serverens række er urørt eller allerede ryddet. */
function handleNotStopped(
  result: NotStopped,
  { invalidate, reconcile }: { invalidate: () => void; reconcile: () => Promise<void> },
): false {
  setPendingStop(null);
  if (result.kind === 'stopped_elsewhere') {
    timerActions().reset();
    showMessage({ message: translate('timer.stopped_elsewhere'), type: 'danger' });
    invalidate();
    return false;
  }
  if (result.kind === 'session_changed') {
    // Telefonen viste en forældet session (stoppet/skiftet på en anden
    // enhed). Intet er rørt på serveren: hent den aktuelle og vis den, så
    // brugeren selv kan vælge, om DEN skal stoppes.
    showMessage({ message: translate('timer.session_changed'), type: 'info' });
    invalidate();
  }
  else {
    // Claimet blev aldrig taget, så serverens session kører videre.
    captureError(new Error(`timer.stop: claim_failed ${result.reason}`), { reason: result.reason });
    showMessage({ message: translate('timer.claim_failed'), type: 'danger' });
  }
  // Bevidst ikke awaited: afstemningen går via `recoverPendingStop`, som
  // står i samme kø som dette kald. Journalen er ryddet, så den finder
  // intet og gør straks videre.
  void reconcile();
  return false;
}

/** Kvittering for en gemt post — med advarsel, hvis klippekortet ikke kunne trækkes. */
function showSaved(result: { hours: number; complianceWarnings: string[]; prepaidSkipped?: boolean }): void {
  showMessage({ message: translate('timer.saved', { hours: formatHours(result.hours) }), type: 'success' });
  if (result.prepaidSkipped)
    showMessage({ message: translate('timer.prepaid_skipped'), type: 'warning' });
  for (const w of result.complianceWarnings)
    showMessage({ message: w, type: 'warning' });
}

type LocalStopArgs = {
  snapshot: TimerPersisted;
  now: Date;
  /** Fejltekst med den forløbne tid, hvis kaldet døde med en reel fejl. */
  failedText: () => string;
  invalidate: () => void;
};

/**
 * Stop af en session, serveren aldrig har set (startet uden net).
 *
 * Posten gemmes direkte, og lægges i køen hvis kaldet fejlede forbigående —
 * ellers tabes tiden. Men kun forbigående: en permanent afvisning (zod,
 * manglet adgang, lukket projekt) bliver ved med at fejle i køen, og brugeren
 * så en "gemt offline"-melding oveni en fejl, han aldrig løser. Den vises i
 * stedet, og timeren kører videre, så han kan rette årsagen og prøve igen.
 *
 * Det samme gælder en udløbet session (401): den løses ikke ved at prøve igen,
 * og køen ville bare dræne fem 401'er over ca. 30 minutter, mens brugeren så
 * en løfte om en gemt tid, der aldrig nåede serveren. En kø-post der *allerede*
 * ligger i køen overlever derimod en udløbet cookie — næste login sender den.
 *
 * En 5xx kommer MED i køen: kaldet kan have nået serveren og oprettet posten,
 * før den svarede med en fejl. Gentrykket ville så skabe den samme time to
 * gange, mens køens ubekræft-markering får dræningen til at slå dagen op
 * først.
 */
async function stopLocalOnlySession({ snapshot, now, failedText, invalidate }: LocalStopArgs): Promise<boolean> {
  try {
    const result = await saveLocalOnlyTimer(snapshot, {
      fallbackDescription: translate('timer.default_description'),
      now,
      autoPrepaid: autoPrepaidAllowed(),
    });
    dropQueuedStarts(snapshot.startTime);
    timerActions().reset();
    showSaved(result);
    invalidate();
    return true;
  }
  catch (error) {
    if (!mayHaveSaved(error)) {
      captureError(error, { reason: 'local_save_failed' });
      showMessage({ message: errorMessage(error, failedText()), type: 'danger' });
      return false;
    }
    // Serveren kan have gemt posten, før svaret forsvandt, så den markeres
    // ubekræftet — dræningen slår den op, før den opretter den igen.
    const hours = queueTimerStop(snapshot, translate('timer.default_description'), { now, unconfirmed: true });
    timerActions().reset();
    showMessage({ message: translate('offline.timer_saved', { hours: formatHours(hours) }), description: translate('offline.saved_body'), type: 'info' });
    invalidate();
    return true;
  }
}
