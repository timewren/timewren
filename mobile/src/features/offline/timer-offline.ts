import type { ExecuteOutcome } from './drain';
import type { QueueItem } from './queue-logic';
import type { TimerPersisted, TimerSelection } from '~/features/timer/timer-logic';
import { buildEntryInput, buildStartSyncInput, isLocalOnly } from '~/features/timer/timer-logic';
import { getTimerState, timerActions } from '~/features/timer/timer-store';
import { formatTime } from '~/lib/format';
import { translate } from '~/lib/i18n';
import { showMessage } from '~/lib/notify';
import { startSessionOf } from './queue-logic';
import { offlineQueue } from './queue-store';

/**
 * Timerstart uden net (#703): læg den i køen, så serveren — og dermed de
 * andre enheder — får sessionen, når nettet er tilbage. Indtil da er den
 * lokal (`pendingSync`), præcis som før. `startedAt` SKAL være samme øjeblik
 * som den lokale session: det er sessionens identitet i køen.
 */
export function queueTimerStart(selection: TimerSelection, startedAt: Date): void {
  offlineQueue().enqueue({ type: 'timer.start', payload: buildStartSyncInput(selection, startedAt) });
}

/** Er der en køet start for sessionen (serveren har den endnu ikke)? */
export function hasQueuedStart(sessionStart: string | null): boolean {
  if (!sessionStart)
    return false;
  const ms = new Date(sessionStart).getTime();
  return offlineQueue().items.some(i => i.type === 'timer.start' && !i.failed && new Date(startSessionOf(i as QueueItem & { type: 'timer.start' })).getTime() === ms);
}

/**
 * Fjern ALLE køede starter for en session, der er afsluttet lokalt (gemt
 * direkte eller kasseret) — også fejlede. Ellers kunne "Prøv igen" senere
 * starte den afsluttede session som en spøgelsestimer på serveren.
 */
export function dropQueuedStarts(sessionStart: string | null): void {
  if (!sessionStart)
    return;
  const ms = new Date(sessionStart).getTime();
  offlineQueue().patchItems(items => items.filter(i => !(i.type === 'timer.start' && new Date(startSessionOf(i as QueueItem & { type: 'timer.start' })).getTime() === ms)));
}

/**
 * Lokal reaktion på en afspillet timerstart.
 *
 * - Landet: kører sessionen stadig lokalt, er den nu serverens — `pendingSync`
 *   ryddes, så stop går gennem claim-kæden som enhver anden session.
 * - Konflikt: en anden enhed havde en timer kørende. Den vinder (én timer pr.
 *   bruger). Kører vores session stadig, gemmes den som post klippet til det
 *   øjeblik, den anden startede, og den lokale timer nulstilles, så
 *   afstemningen adopterer den kørende. Er den allerede stoppet, er posten i
 *   køen klippet af `afterTimerStartConflict`.
 */
export function applyStartOutcomeLocally(
  item: QueueItem & { type: 'timer.start' },
  outcome: ExecuteOutcome,
  dropped: number,
): void {
  const session = startSessionOf(item);
  const local = getTimerState();
  const ours = isLocalOnly(local) && local.startTime !== null
    && new Date(local.startTime).getTime() === new Date(session).getTime();

  if (outcome.kind === 'timer_started') {
    if (ours)
      timerActions().replace({ ...local, pendingSync: false, version: outcome.version, sessionId: outcome.sessionId ?? null });
    return;
  }

  if (outcome.kind === 'timer_stale') {
    // Sessionen bliver lokal (`pendingSync`), så et stop gemmer posten direkte
    // uden at røre serverens række. Brugeren får at vide, hvorfor den ikke
    // ses på de andre enheder.
    showMessage({ message: translate('offline.timer_stale_title'), description: translate('offline.timer_stale_body'), type: 'warning' });
    return;
  }

  if (!ours) {
    showMessage({ message: translate('offline.timer_conflict_title'), description: translate(dropped > 0 ? 'offline.timer_conflict_dropped' : 'offline.timer_conflict_clipped'), type: 'warning' });
    return;
  }
  const sessionMs = new Date(session).getTime();
  const clipAt = Math.min(Date.now(), outcome.otherStart ?? Date.now());
  timerActions().reset();
  if (clipAt > sessionMs) {
    offlineQueue().enqueue({
      type: 'time.create',
      payload: buildEntryInput(local, new Date(clipAt), translate('timer.default_description')),
      meta: { clearTimer: false },
    });
    showMessage({
      message: translate('offline.timer_conflict_title'),
      description: translate('offline.timer_conflict_saved', { from: formatTime(new Date(sessionMs)), to: formatTime(new Date(clipAt)) }),
      type: 'warning',
    });
  }
  else {
    showMessage({ message: translate('offline.timer_conflict_title'), description: translate('offline.timer_conflict_dropped'), type: 'warning' });
  }
}

/**
 * Timer-stop uden net: byg tidsposten lokalt og læg den i køen.
 *
 * `clearTimer` rydder serverens session, når posten synkroniseres — men kun
 * hvis serveren faktisk har vores session. En lokalt startet timer
 * (`pendingSync`) findes kun på enheden, så en `clear` ville ramme en helt
 * anden enheds kørende timer. Tjekket på den kørende session tages i
 * `clearOwnSession` (`drain.ts`) ved selve dræningen — en session kan nå at
 * skifte, mens posten ligger i køen.
 *
 * `unconfirmed` sættes, når `time.create` faktisk blev kaldt og døde med tabt
 * forbindelse: serveren kan have gemt posten, så dræningen slår den op først.
 *
 * Returnerer timerne der bliver gemt.
 */
export function queueTimerStop(
  state: TimerPersisted,
  fallbackDescription: string,
  opts: { now?: Date; unconfirmed?: boolean } = {},
): number {
  const now = opts.now ?? new Date();
  const payload = buildEntryInput(state, now, fallbackDescription);
  offlineQueue().enqueue({
    type: 'time.create',
    payload,
    meta: {
      clearTimer: !state.pendingSync,
      unconfirmed: opts.unconfirmed ?? false,
      // Kaldet døde lige nu, så det er herfra serverens `createdAt` måtte
      // stamme — ellers kan opslaget ikke kende vores post fra en ægte
      // tidligere på dagen.
      ...(opts.unconfirmed ? { firstAttemptAt: now.toISOString() } : {}),
    },
  });
  return payload.hours;
}
