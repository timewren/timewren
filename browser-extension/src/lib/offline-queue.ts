/**
 * Fælles lås om den persistede offline-kø (`offlineQueue` i storage.local).
 *
 * Både popup'en (stop-flowets write-ahead, Hurtig registrering offline) og
 * baggrunden (afspilning) læser, ændrer og skriver køen. Uden lås kan to
 * samtidige læs-ændr-skriv overskrive hinanden, så en post forsvinder eller
 * kommer igen. `navigator.locks` deles af alle udvidelsens sider og service
 * workeren (samme origin); uden Web Locks serialiseres i denne kontekst.
 */

const QUEUE_KEY = "offlineQueue";
const LOCK_NAME = "timetrack-offline-queue";

let localChain: Promise<unknown> = Promise.resolve();

export function withQueueLock<T>(fn: () => Promise<T>): Promise<T> {
  const locks = typeof navigator !== "undefined" ? navigator.locks : undefined;
  if (locks?.request) {
    return locks.request(LOCK_NAME, fn) as Promise<T>;
  }
  const run = localChain.then(fn, fn);
  localChain = run.catch(() => {});
  return run;
}

export async function readStoredQueue<T>(): Promise<T[]> {
  const result = await chrome.storage.local.get([QUEUE_KEY]);
  const queue = result[QUEUE_KEY];
  return Array.isArray(queue) ? (queue as T[]) : [];
}

/** Læs-ændr-skriv under låsen; returnerer den skrevne kø. */
export function updateStoredQueue<T>(
  change: (queue: T[]) => T[],
): Promise<T[]> {
  return withQueueLock(async () => {
    const next = change(await readStoredQueue<T>());
    await chrome.storage.local.set({ [QUEUE_KEY]: next });
    return next;
  });
}

/**
 * Højst én kørsel ad gangen: kald mens en kørsel er i gang får samme
 * promise i stedet for en kørsel mere oven i.
 */
export function singleFlight<T>(fn: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  return () => {
    if (!running) {
      running = fn().finally(() => {
        running = null;
      });
    }
    return running;
  };
}
