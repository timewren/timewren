/**
 * Ét kald ad gangen pr. nøgle — et gensidigt in-flight-lås.
 *
 * Alt der kan trykkes to gange (to tryk under en ark-animation, et net der
 * genindlæser, en notifikation der leverer samme svar to gange) skal være
 * idempotent. Nogle handlinger kan det ikke: `time.duplicate` danner en ny post
 * for hvert kald, `time.copyWeek` kopierer hele ugen, og to `start`-kald med
 * samme kilde kan forskyde starttidspunktet. Der deler de ét kald i stedet for
 * to: det anden kald får **samme promise** og dermed samme svar.
 *
 * Nøglen er med, fordi to forskellige poster gerne må duplikeres samtidig —
 * kun det samme `id` skal låses. Brug en konstant nøgle (fx `'start'`) til
 * handlingen der kun kan finde sted én ad gangen.
 *
 * Låsen frigives, når kaldet er færdigt — også når det **fejler**. Ellers ville
 * ét netværksfejl låse handlingen fast for resten af appens levetid.
 */
export type InFlight<T> = (key: string, run: () => Promise<T>) => Promise<T>;

export function createInFlight<T>(): InFlight<T> {
  const flights = new Map<string, Promise<T>>();
  return (key, run) => {
    const running = flights.get(key);
    if (running)
      return running;
    let result: Promise<T>;
    try {
      result = run();
    }
    catch (error) {
      // Kaste kastet synkront tæller ikke som et igangværende kald — der er
      // intet at vente på, så låsen skal ikke have nået at blive sat.
      return Promise.reject(error);
    }
    flights.set(key, result);
    const clear = () => {
      if (flights.get(key) === result)
        flights.delete(key);
    };
    void result.then(clear, clear);
    return result;
  };
}
