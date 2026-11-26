/**
 * Har serveren bekræftet fanens kørende timer efter seneste genindlæsning
 * eller fokus? (#1324)
 *
 * timerStore er persisteret i localStorage og kan være fra i går. Indtil
 * afstemningen med serveren er landet, regnes elapsed fra en gammel start.
 * Advarsler, der bygger på varigheden (påmindelsen om en lang timer), må kun
 * bruge den varighed, serveren har bekræftet.
 */

/**
 * En bekræftelse er kun frisk så længe. Dækker opvågning efter dvale, hvor
 * hverken fokus eller visibilitychange når frem: pollingen bekræfter igen
 * inden for et minut, så en ægte lang timer mister intet.
 */
export const SERVER_CONFIRMATION_TTL_MS = 3 * 60_000;

interface LocalTimer {
  isRunning: boolean;
  sessionId: string | null;
}

export function createServerConfirmation() {
  let epoch = 0;
  let confirmed: {
    sessionId: string | null;
    /** Bekræftet starttid (fanens ur): læsetid minus serverens elapsed. */
    startedAt: number;
    at: number;
  } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };

  return {
    /** Fanen fik fokus eller blev synlig igen: glem bekræftelsen. */
    invalidate() {
      epoch += 1;
      confirmed = null;
      notify();
    },
    /**
     * Kaldes, hver gang bekræftelsen er glemt eller sat på ny, så en advarsel
     * følger med straks og ikke først ved fanens næste tick.
     */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** Kaldes, før en afstemning læser serveren. */
    beginRead(): number {
      return epoch;
    },
    /**
     * Afstemningen er anvendt på fanen. Bekræfter kun, når serveren kører
     * netop den session, fanen nu kører, og ingen fokus kom imellem.
     */
    complete(
      readEpoch: number,
      read: {
        server: {
          isRunning: boolean | null;
          intent: string | null;
          sessionId: string | null;
        };
        serverElapsedSeconds: number;
        local: LocalTimer;
        at: number;
      },
    ) {
      if (readEpoch !== epoch) return;
      const { server, local } = read;
      const same =
        !!server.isRunning &&
        server.intent !== "stopping" &&
        local.isRunning &&
        (server.sessionId ?? null) === (local.sessionId ?? null);
      confirmed = same
        ? {
            sessionId: server.sessionId ?? null,
            startedAt: read.at - read.serverElapsedSeconds * 1000,
            at: read.at,
          }
        : null;
      notify();
    },
    /** Bekræftet varighed i sekunder, eller null uden frisk bekræftelse. */
    elapsedSeconds(local: LocalTimer, now: number): number | null {
      if (!confirmed || !local.isRunning) return null;
      if ((local.sessionId ?? null) !== confirmed.sessionId) return null;
      const age = now - confirmed.at;
      if (age < 0 || age >= SERVER_CONFIRMATION_TTL_MS) return null;
      return Math.floor((now - confirmed.startedAt) / 1000);
    },
  };
}

export type ServerConfirmation = ReturnType<typeof createServerConfirmation>;
