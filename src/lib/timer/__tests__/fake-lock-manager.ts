import type { LocksLike } from "../tab-owner";

/**
 * Minimal, test-only model af Web Locks API'ens LockManager: eksklusive
 * anmodninger køer FIFO og holdes, til deres callback-promise afgøres. Som i
 * browseren fjerner `signal` kun en VENTENDE anmodning fra køen; en tildelt
 * lås frigives først, når callbackens promise afgøres — nok til at simulere
 * flere faner om samme browserlås.
 */
export class FakeLockManager implements LocksLike {
  private locked = false;
  private queue: Array<() => void> = [];

  request(
    name: string,
    options: { mode: "exclusive"; signal?: AbortSignal; ifAvailable?: boolean },
    callback: (lock: unknown) => Promise<void> | void,
  ): Promise<void> {
    // ifAvailable: optaget lås giver callback(null) i stedet for en plads i køen.
    if (options.ifAvailable && this.locked) {
      return Promise.resolve(callback(null)).then(() => undefined);
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let holding = false;
      let queuedEntry: (() => void) | null = null;

      const release = () => {
        if (!holding) return;
        holding = false;
        this.locked = false;
        const next = this.queue.shift();
        next?.();
      };

      const finish = (fn: () => void) => {
        if (settled) return;
        settled = true;
        fn();
      };

      options.signal?.addEventListener("abort", () => {
        if (settled || holding) return;
        if (queuedEntry) {
          const idx = this.queue.indexOf(queuedEntry);
          if (idx !== -1) this.queue.splice(idx, 1);
        }
        finish(() => reject(new DOMException("aborted", "AbortError")));
      });

      const grant = () => {
        this.locked = true;
        holding = true;
        queuedEntry = null;
        void Promise.resolve(callback({ name })).then(
          () => {
            release();
            finish(() => resolve());
          },
          (err) => {
            release();
            finish(() => reject(err));
          },
        );
      };

      if (this.locked) {
        queuedEntry = grant;
        this.queue.push(queuedEntry);
      } else {
        grant();
      }
    });
  }
}

/** Vent en tick, så ventende mikrotasks (lås-håndtryk) når at afgøres. */
export function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
