import { onlineManager } from '@tanstack/react-query';
import * as React from 'react';

/**
 * Online-status som React-state.
 *
 * `onlineManager` ved det hele, men intet re-renderer uden abonnent. Uden denne
 * hook ville en skærm, der skjuler sig offline, stå med forældede tal indtil
 * en tilfældig state-ændring gen-tegner den.
 */
export function useIsOnline(): boolean {
  return React.useSyncExternalStore(
    onlineManager.subscribe,
    () => onlineManager.isOnline(),
    () => true,
  );
}
