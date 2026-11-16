/**
 * Ét stop ad gangen — delt af `stopTimerNow` og `recoverPendingStop`.
 *
 * Begge kører den SAMME kæde mod den SAMME server-session
 * (`getStateWithVersion → claimForStop → time.create → confirmStop`): det
 * første, fordi brugeren trykker stop, det andet fordi appen genstarter eller
 * kommer i forgrunden med et afbrudt stop i journalen. De kan altså mødes —
 * dobbelttryk i appen, stop-knappen i notifikationen imens appen afstemmer,
 * eller en kold start der kun genoplives af knappen.
 *
 * Uden låsen skrev hvert kald sit eget `stoppedAt`, så
 * `findSavedEntry(entries, state, now)` aldrig ramte den post, et tidligere
 * kald havde gemt. Resultatet var to tidsposter for det samme tidsrum.
 *
 * Kæderne serialiseres derfor. Bemærk at låsen IKKE sluger et genkald: den
 * lægges i kø og får sit eget svar, fordi det kan se en ny tilstand end det
 * forrige kald (fx at serverens session nu er ryddet). Det er derfor
 * `resolveStopMoment` genbruger journalens tidspunkt — så selv et kø-lagt
 * genkald lander på den samme post.
 *
 * `void reconcile()` i `stopTimerNow` kalder tilbage ind i `recoverPendingStop`,
 * men ikke `await`et — låsen kan derfor ikke deadloade. Det er sikkert kun så
 * længe kaldet ikke awaits; se kommentaren der.
 */

let tail: Promise<void> = Promise.resolve();

export function withStopLock<T>(run: () => Promise<T>): Promise<T> {
  const result = tail.then(() => run());
  // Kæden må aldrig aflevere et afvist promise videre som låsens kø — ellers
  // ville alle efterfølgende stop være låst fast efter ét netværksfejl.
  tail = result.then(() => {}, () => {});
  return result;
}
