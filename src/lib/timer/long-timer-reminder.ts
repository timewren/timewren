/**
 * Efter så lang tid minder baren venligt om, at timeren stadig kører. Samme
 * grænse som stabilitetsvagtens runaway_timer (RUNAWAY_HOURS i
 * src/lib/stability/detectors.ts), så brugeren hører om det, før vi gør.
 */
export const LONG_TIMER_SECONDS = 10 * 60 * 60;

const KEY_PREFIX = "timetrack:long-timer-reminded:";

/**
 * Nøglen identificerer den kørende timer. Uden sessionStartTime (genoprettet
 * fra serveren) falder den tilbage til sessionId eller segmentets start, så to
 * forskellige timere i samme fane ikke deler nøgle.
 */
export function longTimerKey(timer: {
  sessionStartTime: number | null;
  sessionId: string | null;
  startTime: number | null;
}): string {
  return `${KEY_PREFIX}${
    timer.sessionStartTime ?? timer.sessionId ?? timer.startTime ?? "session"
  }`;
}

type ReminderStorage = Pick<Storage, "getItem" | "setItem">;

export interface LongTimerReminderDeps {
  /** Viser påmindelsen med nøglen som toast-id. */
  show: (key: string, hours: number) => void;
  dismiss: (key: string) => void;
  /** sessionStorage; null, når den ikke kan bruges. */
  storage: () => ReminderStorage | null;
}

/**
 * Én påmindelse pr. timer (også efter genindlæsning via sessionStorage). Den
 * viste påmindelse hører til én bestemt timer: stoppes eller skiftes timeren
 * ad anden vej, lukkes den, og dens stop-knap virker kun, mens det stadig er
 * den samme timer, der kører.
 */
export function createLongTimerReminder(deps: LongTimerReminderDeps) {
  let reminded: string | null = null;
  let shown: string | null = null;

  return {
    update(state: { isRunning: boolean; elapsedSeconds: number; key: string }) {
      if (shown && (!state.isRunning || shown !== state.key)) {
        deps.dismiss(shown);
        shown = null;
      }
      if (!state.isRunning || state.elapsedSeconds < LONG_TIMER_SECONDS) return;
      if (reminded === state.key) return;
      reminded = state.key;
      try {
        const storage = deps.storage();
        if (storage?.getItem(state.key)) return;
        storage?.setItem(state.key, "1");
      } catch {
        // Uden sessionStorage vises påmindelsen højst én gang pr. sideindlæsning.
      }
      deps.show(state.key, Math.floor(state.elapsedSeconds / 3600));
      shown = state.key;
    },
    /** Må påmindelsen med denne nøgle stoppe den kørende timer? */
    canStop(key: string): boolean {
      return shown === key;
    },
    /** Brugeren lukkede påmindelsen selv. */
    dismissed(key: string) {
      if (shown === key) shown = null;
    },
  };
}
