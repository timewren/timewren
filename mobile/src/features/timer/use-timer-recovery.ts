import * as React from 'react';
import { AppState } from 'react-native';
import { translate } from '~/lib/i18n';
import { recoverPendingStop } from './timer-recovery';

/**
 * Færdiggør et timer-stop, der blev afbrudt af et dræb eller tabt net.
 *
 * Mountes i fanernes layout, ikke på hemskærmen, så det også kører hvis
 * appen genstarter direkte i en registreringsskærm. Kaster aldrig selv —
 * `recoverPendingStop` slugter netfejl og prøver igen næste forgrund.
 */
export function useTimerRecovery(): void {
  React.useEffect(() => {
    const run = () => {
      void recoverPendingStop({ fallbackDescription: translate('timer.default_description') });
    };
    run();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active')
        run();
    });
    return () => sub.remove();
  }, []);
}
