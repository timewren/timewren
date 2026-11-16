import { offlineQueue } from '~/features/offline/queue-store';
import { isTimerRunning } from '~/features/timer/timer-logic';
import { getPendingStop } from '~/features/timer/timer-recovery';
import { getTimerState } from '~/features/timer/timer-store';

/**
 * Tid, der er startet eller gemt på telefonen, men endnu ikke er landet
 * på serveren.
 *
 * Log ud rydder både timeren og offline-køen — det er nødvendigt, ellers
 * arver næste konto på enheden en fremmed kundes usendte tid. Men brugeren
 * skal vide det, før han trykker: en kørende timer mister sin forløbne tid,
 * en stop-journal mister sit stop-øjeblik, og køens poster forsvinder.
 */
export type UafsluttetTid = {
  /** Registreringer i køen, hverken sendte eller fejlede. */
  iKoen: number;
  /** Der er en kørende timer, som log ud smider den forløbne tid fra. */
  koeendeTimer: boolean;
  /** Et afbrudt stop ligger i journalen og er ikke nået på serveren. */
  afbrudtStop: boolean;
};

/**
 * Hvor mange registreringer log ud ville slette. Ren funktion, så regnestykket
 * kan testes uden en kørende app.
 */
export function antalDaLogUdsletter(tid: UafsluttetTid): number {
  return tid.iKoen + (tid.koeendeTimer ? 1 : 0) + (tid.afbrudtStop ? 1 : 0);
}

/** Læser den nuværende tilstand lige inden log-ud-bekræftelsen vises. */
export function uafsluttetTidNu(): UafsluttetTid {
  // Alle elementer tælles, også fejlede: de er stadig tid, serveren aldrig
  // har set, og de forsvinder med køen.
  return {
    iKoen: offlineQueue().items.length,
    koeendeTimer: isTimerRunning(getTimerState()),
    afbrudtStop: getPendingStop() !== null,
  };
}
