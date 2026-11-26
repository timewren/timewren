import type { ServerConfirmation } from "./server-confirmation";

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
  /**
   * Viser påmindelsen under et toast-id, der er nyt for hver visning: Sonner
   * fjerner også en ny toast med et id, der stadig er under lukning, så en
   * genvisning med samme id forsvinder igen. `closedByUser` kaldes, når
   * brugeren lukker den. Sonner kalder onDismiss også efter fanens egen
   * toast.dismiss, så et kald for en visning, fanen selv har skjult, ignoreres.
   */
  show: (toastId: string, hours: number, closedByUser: () => void) => void;
  dismiss: (toastId: string) => void;
  /** sessionStorage; null, når den ikke kan bruges. */
  storage: () => ReminderStorage | null;
  /**
   * Serverens bekræftelse af timeren efter seneste genindlæsning eller fokus
   * (useTimerSync). Påmindelsen regner kun varigheden derfra: fanens egen
   * elapsed kan være regnet fra en forældet start, så den tager aldrig imod
   * den (#1324).
   */
  confirmation: Pick<ServerConfirmation, "elapsedSeconds" | "subscribe">;
  now?: () => number;
}

interface ReminderState {
  isRunning: boolean;
  sessionId: string | null;
  key: string;
}

/**
 * Én påmindelse pr. timer (også efter genindlæsning via sessionStorage). Den
 * viste påmindelse hører til én bestemt timer: stoppes eller skiftes timeren
 * ad anden vej, lukkes den, og dens stop-knap virker kun, mens det stadig er
 * den samme timer, der kører. Mister varigheden sin bekræftelse (fokus),
 * skjules påmindelsen, til serveren har bekræftet timeren igen.
 */
export function createLongTimerReminder(deps: LongTimerReminderDeps) {
  const now = deps.now ?? Date.now;
  let last: ReminderState | null = null;
  let reminded: string | null = null;
  /** Den aktuelle visning; en lukning af en ældre visning tæller ikke. */
  let shown: { key: string; toastId: string } | null = null;
  let shows = 0;
  /** Var vist, men er skjult, mens fanen venter på serverens bekræftelse. */
  let suspended: string | null = null;
  const confirmedElapsed = (state: ReminderState) =>
    deps.confirmation.elapsedSeconds(state, now());
  const hide = () => {
    if (!shown) return;
    const { toastId } = shown;
    shown = null;
    deps.dismiss(toastId);
  };

  const reminder = {
    update(state: ReminderState) {
      last = state;
      if (shown && (!state.isRunning || shown.key !== state.key)) hide();
      if (!state.isRunning || suspended !== state.key) suspended = null;
      if (!state.isRunning) return;
      const elapsed = confirmedElapsed(state);
      if (elapsed === null) {
        if (shown) {
          suspended = shown.key;
          hide();
        }
        return;
      }
      if (elapsed < LONG_TIMER_SECONDS) {
        suspended = null;
        return;
      }
      if (suspended === state.key) {
        suspended = null;
      } else {
        if (reminded === state.key) return;
        reminded = state.key;
        try {
          const storage = deps.storage();
          if (storage?.getItem(state.key)) return;
          storage?.setItem(state.key, "1");
        } catch {
          // Uden sessionStorage vises påmindelsen højst én gang pr. sideindlæsning.
        }
      }
      const view = { key: state.key, toastId: `${state.key}#${++shows}` };
      shown = view;
      deps.show(view.toastId, Math.floor(elapsed / 3600), () => {
        if (shown === view) shown = null;
      });
    },
    /**
     * Følg bekræftelsen, så påmindelsen skjules straks ved fokus og ikke først
     * ved næste tick: et serversvar kan hænge, og fanens elapsed står stille
     * ved loftet. Giver en funktion, der stopper igen.
     */
    connect(): () => void {
      return deps.confirmation.subscribe(() => {
        if (last) reminder.update(last);
      });
    },
    /** Må påmindelsen med dette toast-id stoppe den kørende timer? */
    canStop(toastId: string): boolean {
      return (
        shown?.toastId === toastId &&
        last?.key === shown.key &&
        confirmedElapsed(last) !== null
      );
    },
    /** Bjælken forsvinder: luk en vist påmindelse. */
    close() {
      hide();
    },
  };
  return reminder;
}
