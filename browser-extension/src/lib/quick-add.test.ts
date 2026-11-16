import { describe, expect, it } from "vitest";
import {
  buildQuickAddPayload,
  canQuickAdd,
  createQuickAddQueue,
  displayTimeFor,
  QUICK_ADD_MINUTES,
} from "./quick-add";

/** Manuelt styret løfte, så testene kan holde en skrivning "i luften". */
function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("QUICK_ADD_MINUTES", () => {
  it("er 5/10/15/30 — ikke de gamle 30/60/120", () => {
    expect([...QUICK_ADD_MINUTES]).toEqual([5, 10, 15, 30]);
  });
});

describe("canQuickAdd", () => {
  it("tillader tilføjelse på en kørende timer", () => {
    expect(canQuickAdd({ isRunning: true, displayTime: 0 })).toBe(true);
  });

  it("tillader tilføjelse på en pauset timer med tid på", () => {
    expect(canQuickAdd({ isRunning: false, displayTime: 600 })).toBe(true);
  });

  it("NÆGTER efter et stop, hvor timer-objektet er et nul-objekt", () => {
    // stopTimer()/cancelTimer() sætter timer til {isRunning:false, …0} og
    // displayTime til 0 — ikke null. Uden den her guard ville et klik skrive
    // baseSeconds:900 uden isRunning og genoplive rækken som en fantom-timer
    // på 15 minutter uden projekt eller kunde.
    expect(canQuickAdd({ isRunning: false, displayTime: 0 })).toBe(false);
  });

  it("NÆGTER når run-state er ukendt og der ingen tid er", () => {
    expect(canQuickAdd({ isRunning: null, displayTime: 0 })).toBe(false);
    expect(canQuickAdd({ displayTime: 0 })).toBe(false);
  });
});

describe("buildQuickAddPayload", () => {
  it("sætter hverken isRunning eller startTime", () => {
    const payload = buildQuickAddPayload({
      baseSeconds: 600,
      displayTime: 900,
      minutes: 15,
    });
    expect(Object.keys(payload).sort()).toEqual([
      "baseSeconds",
      "elapsedSeconds",
    ]);
    expect(payload).not.toHaveProperty("isRunning");
    expect(payload).not.toHaveProperty("startTime");
  });

  it("lægger minutterne oven i både base og display (kørende timer)", () => {
    expect(
      buildQuickAddPayload({ baseSeconds: 600, displayTime: 900, minutes: 15 }),
    ).toEqual({ baseSeconds: 600 + 900, elapsedSeconds: 900 + 900 });
  });

  it("virker også på en pauset timer, hvor display = base", () => {
    expect(
      buildQuickAddPayload({ baseSeconds: 300, displayTime: 300, minutes: 5 }),
    ).toEqual({ baseSeconds: 600, elapsedSeconds: 600 });
  });

  it("stabler: to bumps oven i hinanden giver summen", () => {
    const first = buildQuickAddPayload({
      baseSeconds: 0,
      displayTime: 0,
      minutes: 10,
    });
    const second = buildQuickAddPayload({
      baseSeconds: first.baseSeconds,
      displayTime: first.elapsedSeconds,
      minutes: 5,
    });
    expect(second.baseSeconds).toBe(15 * 60);
  });
});

describe("displayTimeFor — et rent baseSeconds-bump", () => {
  const START = new Date("2026-09-16T10:00:00Z").getTime();
  const NOW = START + 120_000; // timeren har kørt 2 minutter

  it("giver rigtigt display på en KØRENDE timer", () => {
    const running = {
      isRunning: true,
      startTime: new Date(START).toISOString(),
      baseSeconds: 600,
      elapsedSeconds: 720,
    };
    expect(displayTimeFor(running, NOW)).toBe(600 + 120);

    // +15 min lagt på base — startTime og isRunning urørt.
    const bumped = { ...running, baseSeconds: 600 + 15 * 60 };
    expect(displayTimeFor(bumped, NOW)).toBe(600 + 15 * 60 + 120);
    expect(displayTimeFor(bumped, NOW) - displayTimeFor(running, NOW)).toBe(
      15 * 60,
    );
  });

  it("giver rigtigt display på en PAUSET timer", () => {
    const paused = {
      isRunning: false,
      startTime: null,
      baseSeconds: 600,
      elapsedSeconds: 600,
    };
    expect(displayTimeFor(paused, NOW)).toBe(600);

    const bumped = { ...paused, baseSeconds: 600 + 30 * 60 };
    expect(displayTimeFor(bumped, NOW)).toBe(600 + 30 * 60);
  });

  it("tæller videre efter bumpet uden at springe", () => {
    const bumped = {
      isRunning: true,
      startTime: new Date(START).toISOString(),
      baseSeconds: 5 * 60,
      elapsedSeconds: 5 * 60,
    };
    expect(displayTimeFor(bumped, START + 1000)).toBe(5 * 60 + 1);
    expect(displayTimeFor(bumped, START + 2000)).toBe(5 * 60 + 2);
  });
});

describe("createQuickAddQueue", () => {
  it("sender ét klik som ét kald", async () => {
    const calls: number[] = [];
    const queue = createQuickAddQueue(async (m) => {
      calls.push(m);
    });
    await queue.add(15);
    expect(calls).toEqual([15]);
    expect(queue.pending()).toBe(0);
  });

  it("taber ikke et bump når tre klik rammer under én skrivning", async () => {
    const calls: number[] = [];
    const inFlight = deferred();
    let first = true;
    const queue = createQuickAddQueue(async (m) => {
      calls.push(m);
      if (first) {
        first = false;
        await inFlight.promise;
      }
    });

    const a = queue.add(5);
    // Klik 2 og 3 lander mens den første skrivning stadig er i luften.
    const b = queue.add(10);
    const c = queue.add(15);
    expect(calls).toEqual([5]);
    expect(queue.pending()).toBe(25);

    inFlight.resolve();
    await Promise.all([a, b, c]);

    // 5 sendt først, derefter 10+15 samlet i én skrivning — intet tabt.
    expect(calls).toEqual([5, 25]);
    expect(calls.reduce((sum, n) => sum + n, 0)).toBe(30);
    expect(queue.pending()).toBe(0);
  });

  it("kører aldrig to skrivninger samtidig", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const queue = createQuickAddQueue(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await Promise.resolve();
      concurrent--;
    });
    await Promise.all([queue.add(5), queue.add(10), queue.add(30)]);
    expect(maxConcurrent).toBe(1);
  });

  it("ignorerer 0 og negative minutter", async () => {
    const calls: number[] = [];
    const queue = createQuickAddQueue(async (m) => {
      calls.push(m);
    });
    await queue.add(0);
    await queue.add(-5);
    expect(calls).toEqual([]);
  });

  it("propagerer fejl og hober ikke ventende minutter op", async () => {
    const queue = createQuickAddQueue(async () => {
      throw new Error("offline");
    });
    await expect(queue.add(5)).rejects.toThrow("offline");
    expect(queue.pending()).toBe(0);
    expect(queue.isFlushing()).toBe(false);
  });
});
