/**
 * Idempotensnøgle (clientEntryId) for gem af et timer-stop.
 *
 * Mister "Gem" sit svar, og brugeren trykker igen, må posten ikke gemmes to
 * gange (og klippekortet trækkes to gange). Samme session → samme nøgle på
 * tværs af gentagne forsøg, så serverens unikke indeks på clientEntryId
 * afviser dubletten. Ny session (anden starttid) eller et gennemført gem →
 * ny nøgle.
 */
export function createSaveKeyCache() {
  let session: number | null = null;
  let key: string | undefined;
  return {
    keyFor(sessionStartTime: number | null): string | undefined {
      if (sessionStartTime === null) return undefined;
      if (session !== sessionStartTime || !key) {
        session = sessionStartTime;
        key = crypto.randomUUID();
      }
      return key;
    },
    reset() {
      session = null;
      key = undefined;
    },
  };
}

/** Delt af TimeTrackingBar og TimerWidget — de gemmer den samme session. */
export const timerSaveKeys = createSaveKeyCache();
