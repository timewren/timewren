import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const storage = new Map<string, unknown>();
vi.stubGlobal("chrome", {
  storage: {
    local: {
      get: async (keys: string[]) =>
        Object.fromEntries(
          keys.filter((k) => storage.has(k)).map((k) => [k, storage.get(k)]),
        ),
      set: async (items: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(items)) storage.set(k, v);
      },
      remove: async (keys: string[]) => {
        for (const k of keys) storage.delete(k);
      },
    },
  },
});

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal("fetch", fetchMock);

const { DISABLED_UNTIL_KEY, startElectricTimer, stopElectricTimer } =
  await import("./electricTimer");

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  storage.clear();
  storage.set("extensionToken", "tok");
  storage.set("extensionTokenServer", "https://timetrack.dk");
  fetchMock.mockReset();
});

afterEach(() => stopElectricTimer());

describe("Electric-strømmen (#C6)", () => {
  it("503 på første forsøg stopper strømmen uden nye forsøg", async () => {
    fetchMock.mockImplementation(
      async () => new Response("Electric er slået fra", { status: 503 }),
    );
    await startElectricTimer("tok", () => {});
    await wait(600);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(storage.get(DISABLED_UNTIL_KEY)).toBeGreaterThan(Date.now());

    // Næste sync-alarm starter den ikke igen, før tiden er gået
    await startElectricTimer("tok", () => {});
    await wait(50);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("stop afbryder det igangværende long-poll", async () => {
    let signal: AbortSignal | undefined;
    fetchMock.mockImplementation(
      (_input, init) =>
        new Promise<Response>((_resolve, reject) => {
          signal = init?.signal ?? undefined;
          signal?.addEventListener("abort", () =>
            reject(new DOMException("Aborted", "AbortError")),
          );
        }),
    );
    await startElectricTimer("tok", () => {});
    await wait(20);
    expect(signal?.aborted).toBe(false);
    stopElectricTimer();
    expect(signal?.aborted).toBe(true);
  });

  it("andre fejl giver højst få forsøg", async () => {
    fetchMock.mockImplementation(async (_input, init) => {
      // Første svar er ok-ish men ikke 503, derefter netværksfejl
      if (init?.signal?.aborted)
        throw new DOMException("Aborted", "AbortError");
      throw new TypeError("Failed to fetch");
    });
    await startElectricTimer("tok", () => {});
    await wait(3000);
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4);
    expect(storage.has(DISABLED_UNTIL_KEY)).toBe(false);
  });
});
