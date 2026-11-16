import type { TimerSelection } from './timer-logic';
import type { StartResult } from './timer-service';
import type { trpc } from '~/lib/api';
import * as React from 'react';
import { isOffline } from '~/features/offline/enqueue';
import { dropQueuedStarts, queueTimerStart } from '~/features/offline/timer-offline';
import { errorMessage } from '~/lib/api';
import { isNetworkFailure } from '~/lib/api/error-reporting';
import { translate } from '~/lib/i18n';
import { createInFlight } from '~/lib/in-flight';
import { announce, showMessage } from '~/lib/notify';
import { stopTimerNow } from './stop-timer';
import { isLocalOnly, isTimerRunning, selectionNames, startLocal } from './timer-logic';
import { getPendingStop, recoverPendingStop } from './timer-recovery';
import {
  discardTimerOnServer,
  startTimerOnServer,
  updateTimerOnServer,
} from './timer-service';
import { getTimerState, timerActions } from './timer-store';

export type StartOptions = Partial<TimerSelection>;

type Utils = ReturnType<typeof trpc.useUtils>;

type CommandDeps = {
  reconcile: () => Promise<void>;
  setBusy: (busy: boolean) => void;
  utils: Utils;
};

function toSelection(opts: StartOptions | undefined, current: TimerSelection): TimerSelection {
  return {
    projectId: opts?.projectId ?? null,
    clientId: opts?.clientId ?? null,
    taskId: opts?.taskId ?? null,
    description: opts?.description ?? current.description ?? '',
    projectName: opts?.projectName ?? null,
    clientName: opts?.clientName ?? null,
  };
}

/**
 * En start er det ene hændelsespar, appen ikke har nogen synlig kvittering for:
 * intet popper op, knappen bare bliver til Stop. Skærmlæser-brugeren får derfor
 * ingen at vide, om trykket virkede — så vi siger det, vi gør på samme navne som
 * timer-kortet viser.
 */
function announceStarted(selection: TimerSelection): void {
  const name = selectionNames(selection);
  announce(name ? translate('timer.started_for', { name }) : translate('timer.started'));
}

function danger(message: string) {
  showMessage({ message, type: 'danger' });
}

function invalidateAfterStop(utils: Utils) {
  void utils.time.invalidate();
  void utils.prepaid.invalidate();
  void utils.timerSync.invalidate();
}

/**
 * Ét start-kald ad gangen, uanset hvilken knap der trykkes.
 *
 * Projektvælgeren (`timer-card.tsx` `onPicked`) kan ramme to gange under
 * bundarkets dismiss-animation, og `FavoritesRow` deler samme kommando. To
 * `timerSync.sync`-kald med samme `source` passerer begge `otherOwnerGuard` på
 * serveren, så det er ikke en blokering der redder os — den bageste start får
 * bare et senere `startTime`, og den foregående tid forsvinder. Det andet kald
 * deler derfor det førstes svar i stedet for at sende sit eget.
 */
const startFlight = createInFlight<boolean>();

/** Serveren afviser en start, fordi et stop stadig er undervejs. */
const STOPPING_IN_PROGRESS = 'stopping_in_progress';

/**
 * Serveren afviste en frisk start, fordi tidsrummet allerede er gemt fra en
 * anden enhed (genopstandelses-guarden). Endelig — et nyt forsøg giver samme svar.
 */
const STALE_START = 'stale_start';

/**
 * Start, der genkøres ét gange efter at et afbrudt stop er færdiggjort.
 *
 * `saved_unconfirmed` (claimet kunne ikke bekræftes, posten ligger gemt) efterlader
 * serverens række i 'stopping'. Næste start bliver så afvist med
 * `stopping_in_progress` — og før dette kun recovery ved mount og forgrund kunne
 * fjerne blokeringen, så brugeren skulle lukke og åbne appen for at time videre.
 * Genkaldet er sikkert: det er kun vores egen journal, der færdiggøres, og
 * `findSavedEntry` springer den post over, det afbrudte stop allerede gemte, så
 * tiden hverken tabes eller dobbeltfaktureres.
 */
async function startAfterOwnStop(selection: TimerSelection, now: Date): Promise<StartResult> {
  const first = await startTimerOnServer(selection, now);
  if (first.kind !== 'blocked' || first.reason !== STOPPING_IN_PROGRESS || !getPendingStop())
    return first;
  await recoverPendingStop({ fallbackDescription: translate('timer.default_description') });
  return startTimerOnServer(selection, now);
}

/**
 * Start uden net: lokal session + en køet start (#703), så serveren og de
 * andre enheder får sessionen, når nettet er tilbage. Samme øjeblik bruges
 * begge steder — det er sessionens identitet i køen.
 */
function startOffline(selection: TimerSelection, now: Date): void {
  timerActions().replace(startLocal(selection, now, getTimerState().version));
  queueTimerStart(selection, now);
  showMessage({ message: translate('timer.started_offline'), description: translate('offline.saved_body'), type: 'info' });
}

function useStart({ setBusy, utils, reconcile }: CommandDeps) {
  return React.useCallback((opts?: StartOptions) => startFlight('start', async () => {
    const selection = toSelection(opts, getTimerState());
    const now = new Date();
    if (isOffline()) {
      // Uden net kan vi ikke læse serverens timer, så vi starter lokalt. Den
      // køede start sender sessionen til serveren, når nettet er tilbage.
      startOffline(selection, now);
      return true;
    }
    setBusy(true);
    try {
      const result = await startAfterOwnStop(selection, now);
      if (result.kind === 'blocked') {
        danger(translate(result.reason === STALE_START ? 'timer.stale_start' : 'timer.blocked'));
        if (result.reason === STALE_START)
          void reconcile();
        return false;
      }
      timerActions().replace(result.state);
      if (result.kind === 'adopted')
        showMessage({ message: translate('timer.adopted'), type: 'info' });
      else
        announceStarted(selection);
      void utils.timerSync.invalidate();
      return true;
    }
    catch (error) {
      // Tabt forbindelse midt i starten (flosset net, "online" men ingen
      // svar): start lokalt og læg starten i køen i stedet for at tabe den.
      // Landede starten alligevel, genkender dræningen sessionen på tidspunktet.
      if (isNetworkFailure(error)) {
        startOffline(selection, now);
        return true;
      }
      danger(errorMessage(error, translate('timer.start_failed')));
      return false;
    }
    finally {
      setBusy(false);
    }
  }), [reconcile, setBusy, utils]);
}

function useStop({ setBusy, utils, reconcile }: CommandDeps) {
  // Samme kæde som stop-knappen i notifikationen bruger — den kalder
  // `stopTimerNow` uden React, og de to må aldrig komme til at divergere.
  return React.useCallback(
    () => stopTimerNow({ setBusy, invalidate: () => invalidateAfterStop(utils), reconcile }),
    [reconcile, setBusy, utils],
  );
}

/** Telefonen viste en forældet session: vis den aktuelle i stedet for at handle. */
async function showCurrentSession(reconcile: () => Promise<void>): Promise<void> {
  showMessage({ message: translate('timer.session_changed'), type: 'info' });
  await reconcile();
}

function useDiscard({ setBusy, utils, reconcile }: CommandDeps) {
  return React.useCallback(async () => {
    // En lokalt startet session findes kun på enheden. `timerSync.clear`
    // ville rydde serverens session — og den tilhører måske en anden enhed.
    if (isLocalOnly(getTimerState())) {
      // Den køede start må ikke afspille den kasserede session bagefter.
      dropQueuedStarts(getTimerState().startTime);
      timerActions().reset();
      void utils.timerSync.invalidate();
      return;
    }
    setBusy(true);
    try {
      const result = await discardTimerOnServer(getTimerState());
      if (result.kind === 'session_changed') {
        // Serveren kører en anden session end den, vi ville kassere — den må
        // ikke ryddes. Hent den i stedet, så brugeren ser hvad der kører.
        await showCurrentSession(reconcile);
        return;
      }
      timerActions().reset();
    }
    catch {
      // Serveren rydder selv en forældet timer — lokalt kasserer vi uanset.
      timerActions().reset();
    }
    finally {
      void utils.timerSync.invalidate();
      setBusy(false);
    }
  }, [reconcile, setBusy, utils]);
}

function useSwitchTo({ reconcile }: CommandDeps) {
  return React.useCallback(async (selection: Partial<TimerSelection>) => {
    timerActions().setSelection(selection);
    const next = getTimerState();
    if (!isTimerRunning(next))
      return;
    // Lokal session: serveren kender den ikke, så valget gemmes lokalt og
    // følger med i tidsposten, der gemmes ved stop.
    if (isLocalOnly(next))
      return;
    try {
      const synced = await updateTimerOnServer(next);
      if (synced)
        timerActions().setVersion(synced.version);
      // Serveren kører ikke (længere) vores session: skriv ikke ind over den.
      else await showCurrentSession(reconcile);
    }
    catch (error) {
      danger(errorMessage(error));
    }
  }, [reconcile]);
}

/** Start/stop/kassér/skift — hver kommando som sin egen memoiserede callback. */
export function useTimerCommands(deps: CommandDeps) {
  const start = useStart(deps);
  const stop = useStop(deps);
  const discard = useDiscard(deps);
  const switchTo = useSwitchTo(deps);
  return { start, stop, discard, switchTo };
}
