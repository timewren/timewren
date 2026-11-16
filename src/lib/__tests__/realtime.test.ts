import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __dispatchForTests,
  __resetRealtimeForTests,
  addTimerListener,
  getRealtimeStatus,
  orgChannel,
  publishTimerEvent,
  subscribeWhenReady,
  userChannel,
} from "@/lib/realtime";

// No VALKEY_URL in the test env → getSubscriber()/getValkey() return null, so
// these tests exercise the in-memory fan-out registry, not a real connection.
describe("realtime fan-out", () => {
  beforeEach(() => {
    __resetRealtimeForTests();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it("delivers a message only to listeners on the matching channel", () => {
    const got: string[] = [];
    addTimerListener([userChannel("u1")], (_c, m) => got.push(m));
    __dispatchForTests(userChannel("u1"), "hello");
    __dispatchForTests(userChannel("u2"), "nope");
    expect(got).toEqual(["hello"]);
  });

  it("stops delivering after unsubscribe", () => {
    const got: string[] = [];
    const unsub = addTimerListener([userChannel("u1")], (_c, m) => got.push(m));
    __dispatchForTests(userChannel("u1"), "first");
    unsub();
    __dispatchForTests(userChannel("u1"), "second");
    expect(got).toEqual(["first"]);
  });

  it("a listener can subscribe to multiple channels", () => {
    const channels: string[] = [];
    addTimerListener([userChannel("u1"), orgChannel("o1")], (c) =>
      channels.push(c),
    );
    __dispatchForTests(orgChannel("o1"), "x");
    __dispatchForTests(userChannel("u1"), "y");
    expect(channels).toEqual([orgChannel("o1"), userChannel("u1")]);
  });

  it("publishTimerEvent is a no-op (no throw) when Valkey is unavailable", async () => {
    await expect(
      publishTimerEvent("u1", "o1", {
        userId: "u1",
        type: "sync",
        isRunning: true,
        projectId: null,
        clientId: null,
        taskId: null,
        description: "",
        version: 1,
      }),
    ).resolves.toBeUndefined();
  });
});

// Regression (2/10-2026): psubscribe blev sendt før forbindelsen var klar og
// afvist (enableOfflineQueue: false) — realtime var død efter hvert deploy.
describe("subscribeWhenReady", () => {
  function fakeConn(status: string) {
    const handlers: Record<string, (() => void)[]> = {};
    return {
      status,
      psubscribe: vi.fn().mockResolvedValue(1),
      on(event: string, fn: () => void) {
        handlers[event] ??= [];
        handlers[event].push(fn);
        return this;
      },
      emit(event: string) {
        for (const fn of handlers[event] ?? []) fn();
      },
    };
  }

  it("venter med at abonnere til forbindelsen er klar", () => {
    const conn = fakeConn("connecting");
    // biome-ignore lint/suspicious/noExplicitAny: test-dobbelt for ioredis
    subscribeWhenReady(conn as any);
    expect(conn.psubscribe).not.toHaveBeenCalled();
    conn.emit("ready");
    expect(conn.psubscribe).toHaveBeenCalledWith("timer:*");
  });

  it("abonnerer igen efter genforbindelse", () => {
    const conn = fakeConn("connecting");
    // biome-ignore lint/suspicious/noExplicitAny: test-dobbelt for ioredis
    subscribeWhenReady(conn as any);
    conn.emit("ready");
    conn.emit("ready");
    expect(conn.psubscribe).toHaveBeenCalledTimes(2);
  });

  it("abonnerer straks hvis forbindelsen allerede er klar", () => {
    const conn = fakeConn("ready");
    // biome-ignore lint/suspicious/noExplicitAny: test-dobbelt for ioredis
    subscribeWhenReady(conn as any);
    expect(conn.psubscribe).toHaveBeenCalledTimes(1);
  });
});

// Stabilitetsvagten (h): /api/health og cron'en skal kunne se om processen
// faktisk er abonneret — ellers opdager vi først et dødt realtime via kunder.
describe("realtime-status", () => {
  beforeEach(() => __resetRealtimeForTests());

  function fakeConn(status: string, psubscribe = vi.fn().mockResolvedValue(1)) {
    const handlers: Record<string, (() => void)[]> = {};
    return {
      status,
      psubscribe,
      on(event: string, fn: () => void) {
        handlers[event] ??= [];
        handlers[event].push(fn);
        return this;
      },
      emit(event: string) {
        for (const fn of handlers[event] ?? []) fn();
      },
    };
  }

  it("er ikke abonneret før psubscribe er lykkedes", () => {
    expect(getRealtimeStatus().subscribed).toBe(false);
  });

  it("markeres abonneret når psubscribe lykkes og ikke når forbindelsen lukker", async () => {
    const conn = fakeConn("ready");
    // biome-ignore lint/suspicious/noExplicitAny: test-dobbelt for ioredis
    subscribeWhenReady(conn as any);
    await Promise.resolve();
    await Promise.resolve();
    expect(getRealtimeStatus().subscribed).toBe(true);
    expect(getRealtimeStatus().lastSubscribedAt).toBeInstanceOf(Date);
    conn.emit("close");
    expect(getRealtimeStatus().subscribed).toBe(false);
  });

  it("husker fejlen når psubscribe afvises", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const conn = fakeConn(
      "ready",
      vi.fn().mockRejectedValue(new Error("Stream isn't writeable")),
    );
    // biome-ignore lint/suspicious/noExplicitAny: test-dobbelt for ioredis
    subscribeWhenReady(conn as any);
    await Promise.resolve();
    await Promise.resolve();
    const status = getRealtimeStatus();
    expect(status.subscribed).toBe(false);
    expect(status.lastError).toContain("writeable");
    vi.restoreAllMocks();
  });
});
