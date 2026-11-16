/**
 * Hurtig tidsregistrering i popup'en: +5 / +10 / +15 / +30 minutter oven i
 * den kørende eller pausede timer (#595).
 *
 * To ting gør modulet nødvendigt — og testbart uden chrome/tRPC:
 *
 * 1. **Payloaden må ikke sætte `isRunning`.** `extension.updateTimerState` er
 *    et partielt merge: udelades `isRunning`, rører skrivningen hverken
 *    run-state eller ejerskabet (`lastSyncedFrom`), og den rammer ingen af
 *    one-running-timer-guarderne. Det er dét, der gør at et klik virker både
 *    mens timeren kører og mens den er pauset — og at web-appens heartbeat
 *    ikke bliver blokeret bagefter.
 * 2. **Tre hurtige klik må ikke tabe et bump.** Kaldene serialiseres i en kø
 *    der akkumulerer ventende minutter, så klik nr. 2 og 3 lander i ÉN
 *    skrivning i stedet for at overskrive hinanden med hver sin baseSeconds.
 */

/** Knapperne i popup'en. en bruger (kunde A): 30/60/120 var "voldsomt". */
export const QUICK_ADD_MINUTES = [5, 10, 15, 30] as const;

/**
 * Må der quick-addes lige nu?
 *
 * `timer` er IKKE null efter et stop: `stopTimer`/`cancelTimer` efterlader et
 * NUL-objekt (isRunning false, baseSeconds 0) så popup'en kan vise
 * "gemt"-kvitteringen. En guard på `timer !== null` ville derfor lade knapperne
 * stå efter et stop — og et klik ville skrive `baseSeconds: 900` uden
 * `isRunning`, som hverken rammer guarden mod at genoplive en ryddet række
 * (den gælder kun pause-skrivninger med `isRunning: false`) eller sætter
 * projekt/kunde. Resultatet ville være en fantom-timer på 15 minutter.
 *
 * Der må kun lægges tid til en timer der FAKTISK findes: kørende, eller pauset
 * med tid på.
 */
export function canQuickAdd(state: {
  isRunning?: boolean | null;
  displayTime: number;
}): boolean {
  return Boolean(state.isRunning) || state.displayTime > 0;
}

export interface QuickAddPayload {
  baseSeconds: number;
  elapsedSeconds: number;
}

/**
 * Bygger den partielle skrivning for et quick-add. Bemærk at `isRunning` og
 * `startTime` bevidst IKKE er med — se punkt 1 ovenfor.
 */
export function buildQuickAddPayload(input: {
  /** Timerens nuværende baseSeconds (lokalt, inkl. tidligere bumps). */
  baseSeconds: number;
  /** Det brugeren ser lige nu (base + løbende session). */
  displayTime: number;
  minutes: number;
}): QuickAddPayload {
  const added = Math.max(0, Math.round(input.minutes)) * 60;
  return {
    baseSeconds: Math.max(0, input.baseSeconds) + added,
    elapsedSeconds: Math.max(0, input.displayTime) + added,
  };
}

/**
 * Timerens display-tid. Udtrukket fra `timerStore.calculateDisplayTime` så et
 * rent baseSeconds-bump kan verificeres direkte i test — både mens timeren
 * kører (base + løbende session) og mens den er pauset (base).
 *
 * `nowMs` injiceres for deterministiske tests.
 */
export function displayTimeFor(
  timer: {
    isRunning?: boolean;
    startTime?: string | null;
    baseSeconds?: number | null;
    elapsedSeconds?: number | null;
  } | null,
  nowMs: number,
): number {
  if (!timer) return 0;

  if (timer.isRunning && timer.startTime) {
    const startTime = new Date(timer.startTime).getTime();
    const elapsed = Math.floor((nowMs - startTime) / 1000);
    return (timer.baseSeconds ?? 0) + elapsed;
  }

  return timer.baseSeconds || timer.elapsedSeconds || 0;
}

export interface QuickAddQueue {
  /** Læg minutter i kø. Løftet indfries når de er skrevet til serveren. */
  add: (minutes: number) => Promise<void>;
  /** Minutter der endnu ikke er sendt. */
  pending: () => number;
  /** Er en skrivning i gang? */
  isFlushing: () => boolean;
}

/**
 * Serialiserer quick-add-skrivninger. `flush` kaldes aldrig samtidig med sig
 * selv; minutter der kommer ind undervejs samles og sendes i næste runde.
 */
export function createQuickAddQueue(
  flush: (minutes: number) => Promise<void>,
): QuickAddQueue {
  let pending = 0;
  let running: Promise<void> | null = null;

  async function drain(): Promise<void> {
    while (pending > 0) {
      const batch = pending;
      pending = 0;
      try {
        await flush(batch);
      } catch (error) {
        // Resten droppes — den kaldende store viser fejlen og henter
        // serverens sandhed igen. Ellers ville en død forbindelse hobe
        // minutter op og sende dem alle sammen senere.
        pending = 0;
        throw error;
      }
    }
  }

  return {
    add: (minutes: number) => {
      if (!Number.isFinite(minutes) || minutes <= 0) return Promise.resolve();
      pending += minutes;
      if (!running) {
        running = drain().finally(() => {
          running = null;
        });
      }
      return running;
    },
    pending: () => pending,
    isFlushing: () => running !== null,
  };
}
