import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Hoisted holder so the vi.mock factory (hoisted above imports) can read a
// mutable fake client we reconfigure per test.
const h = vi.hoisted(() => ({
  client: null as null | {
    get: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
  },
}));

vi.mock("@/lib/valkey", () => {
  const m = {
    getValkey: () => h.client,
  };
  return { ...m, getReadyValkey: m.getValkey };
});

import { cached } from "@/lib/cache";

describe("cached", () => {
  let store: Map<string, string>;
  let get: ReturnType<typeof vi.fn>;
  let set: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    store = new Map();
    get = vi.fn(async (k: string) => store.get(k) ?? null);
    set = vi.fn(async (k: string, v: string) => {
      store.set(k, v);
      return "OK";
    });
    h.client = { get, set };
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("misses then hits: fn runs once, second call served from cache", async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      return { v: 1 };
    };
    const r1 = await cached("k", 60, fn);
    const r2 = await cached("k", 60, fn);
    expect(r1).toEqual({ v: 1 });
    expect(r2).toEqual({ v: 1 });
    expect(calls).toBe(1);
    expect(set).toHaveBeenCalledWith(
      "cache:k",
      JSON.stringify({ v: 1 }),
      "EX",
      60,
    );
  });

  it("passes through (runs fn every time) when Valkey is unavailable", async () => {
    h.client = null;
    let calls = 0;
    const fn = async () => {
      calls++;
      return 7;
    };
    await cached("k", 60, fn);
    await cached("k", 60, fn);
    expect(calls).toBe(2);
  });

  it("does not cache null results", async () => {
    const fn = async () => null;
    await cached("k", 60, fn);
    expect(set).not.toHaveBeenCalled();
  });

  it("falls through to fn on Valkey read error", async () => {
    get.mockRejectedValueOnce(new Error("boom"));
    const fn = async () => "ok";
    const r = await cached("k", 60, fn);
    expect(r).toBe("ok");
  });
});
