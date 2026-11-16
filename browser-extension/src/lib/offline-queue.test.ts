import { beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
const tick = () => new Promise((r) => setTimeout(r, Math.random() * 3));
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string[]) => {
        await tick();
        return Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        );
      },
      set: async (items: Record<string, unknown>) => {
        await tick();
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
    },
  },
});

const { readStoredQueue, singleFlight, updateStoredQueue } = await import(
  "./offline-queue"
);

beforeEach(() => storage.clear());

describe("offline-køens lås", () => {
  it("samtidige skrivninger mister ingen poster", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        updateStoredQueue<number>((q) => [...q, i]),
      ),
    );
    const queue = await readStoredQueue<number>();
    expect(queue).toHaveLength(20);
    expect([...queue].sort((a, b) => a - b)).toEqual(
      Array.from({ length: 20 }, (_, i) => i),
    );
  });

  it("en fejl i én ændring slipper låsen for de næste", async () => {
    await expect(
      updateStoredQueue<number>(() => {
        throw new Error("fejl");
      }),
    ).rejects.toThrow("fejl");
    await updateStoredQueue<number>((q) => [...q, 1]);
    expect(await readStoredQueue<number>()).toEqual([1]);
  });
});

describe("singleFlight", () => {
  it("kører kun én ad gangen og igen bagefter", async () => {
    let runs = 0;
    let release!: () => void;
    const run = singleFlight(async () => {
      runs++;
      await new Promise<void>((r) => {
        release = r;
      });
    });
    const a = run();
    const b = run();
    expect(a).toBe(b);
    release();
    await a;
    const c = run();
    expect(runs).toBe(2);
    release();
    await c;
  });
});
