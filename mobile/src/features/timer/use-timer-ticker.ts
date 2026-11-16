import { useIsFocused } from '@react-navigation/native';
import * as React from 'react';
import { AppState } from 'react-native';
import { computeElapsedSeconds } from './timer-logic';

/**
 * Forløbet tid der tikker hvert sekund — men kun når skærmen er fokuseret
 * og appen er i forgrunden. Tiden udledes altid af startTime, så et
 * pauset interval giver aldrig drift.
 */
export function useTimerTicker(startTime: string | null, baseSeconds: number): number {
  const isFocused = useIsFocused();
  const [appActive, setAppActive] = React.useState(AppState.currentState !== 'background');
  // Tælleren tvinger blot et re-render; selve tiden udledes af startTime.
  // useReducer, ikke useState, fordi værdien aldrig læses — kun dispatch'en.
  // Reduceren ignorerer sit input, så den tæller uanset hvad setInterval sender.
  const [, tick] = React.useReducer((n: number, _action?: number) => n + 1, 0);

  React.useEffect(() => {
    const sub = AppState.addEventListener('change', s => setAppActive(s === 'active'));
    return () => sub.remove();
  }, []);

  React.useEffect(() => {
    if (!startTime || !isFocused || !appActive)
      return;
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [startTime, isFocused, appActive]);

  return computeElapsedSeconds({ startTime, baseSeconds });
}
