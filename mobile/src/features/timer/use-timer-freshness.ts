import * as React from 'react';
import { AppState } from 'react-native';
import { isOffline } from '~/features/offline/enqueue';
import { reconcileTimerNow } from './stop-timer';

/** Hvor tit timeren afstemmes med serveren, mens appen er i forgrunden. */
export const TIMER_POLL_MS = 30_000;

/**
 * Hold timeren frisk, mens appen er åben.
 *
 * Appen har ingen realtime, og serveren sender ingen push ved timer-stop. Før
 * blev der kun afstemt ved mount og forgrund, så en timer stoppet (og en ny
 * startet) på web stod uændret på telefonen — og et stop herfra ramte så den
 * forkerte session. Nu afstemmes der hvert 30. sekund i forgrunden og straks
 * ved genoptagelse. Afstemningen lægger kun svaret ind, hvis intet er ændret
 * lokalt imens (se `reconcileTimerNow`). Monteres én gang i (app)-layoutet.
 */
export function useTimerFreshness(enabled: boolean): void {
  React.useEffect(() => {
    if (!enabled)
      return;
    let interval: ReturnType<typeof setInterval> | null = null;

    function tick() {
      if (!isOffline())
        void reconcileTimerNow();
    }
    function startPolling() {
      if (interval === null)
        interval = setInterval(tick, TIMER_POLL_MS);
    }
    function stopPolling() {
      if (interval !== null) {
        clearInterval(interval);
        interval = null;
      }
    }

    if (AppState.currentState === 'active')
      startPolling();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        tick();
        startPolling();
      }
      else {
        stopPolling();
      }
    });
    return () => {
      stopPolling();
      sub.remove();
    };
  }, [enabled]);
}
