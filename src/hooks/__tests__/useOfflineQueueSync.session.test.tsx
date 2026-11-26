// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  enqueueOfflineStop,
  useOfflineQueueStore,
} from "@/stores/offlineQueueStore";

/**
 * Offline-stoppet er bundet til sin session hele vejen til tRPC (#1333):
 * elementet i køen bærer id'et, og den rigtige useOfflineQueueSync sender
 * det med claim og confirm. Kun tRPC-klienten og sessionen er erstattet.
 */
const h = vi.hoisted(() => ({
  claim: vi.fn(),
  confirm: vi.fn(),
  create: vi.fn(),
  state: vi.fn(),
}));

vi.mock("sonner", () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries: async () => {} }),
}));
vi.mock("@/lib/query/cross-tab", () => ({ broadcastDataChange: () => {} }));
vi.mock("@/lib/auth-client", () => ({
  useSession: () => ({ data: { user: { id: "user-1" }, session: {} } }),
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    useUtils: () => ({
      client: {
        timerSync: {
          getStateWithVersion: { query: h.state },
          claimForStop: { mutate: h.claim },
          confirmStop: { mutate: h.confirm },
          sync: { mutate: vi.fn() },
        },
        time: { create: { mutate: h.create } },
      },
    }),
  },
}));

const { useOfflineQueueSync } = await import("../useOfflineQueueSync");

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function Probe() {
  useOfflineQueueSync();
  return null;
}

describe("useOfflineQueueSync: offline-stop bundet til sin session (#1333)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => true,
    });
    for (const fn of Object.values(h)) fn.mockReset();
    const start = Date.now() - 30 * 60_000;
    h.state.mockResolvedValue({
      isRunning: true,
      startTime: new Date(start).toISOString(),
      elapsedSeconds: 0,
      baseSeconds: 0,
      version: 5,
      intent: null,
      intentFrom: null,
      sessionId: SESSION_A,
    });
    h.claim.mockResolvedValue({ success: true, version: 6 });
    h.confirm.mockResolvedValue({ success: true, version: 7 });
    h.create.mockResolvedValue({});
    useOfflineQueueStore.setState({
      items: [],
      ownerUserId: "user-1",
      knownServerVersion: 5,
      establishedSessionStart: start,
    });
    enqueueOfflineStop({
      sessionStartTime: start,
      startTime: start,
      sessionId: SESSION_A,
      entry: {
        description: "Support",
        date: "2026-11-24",
        hours: 0.5,
        fromTimer: true,
        timerSessionId: SESSION_A,
      },
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useOfflineQueueStore.setState({ items: [], ownerUserId: null });
  });

  it("claim og confirm sendes med den stoppede sessions id", async () => {
    expect(useOfflineQueueStore.getState().items[0]).toMatchObject({
      kind: "timer.stop",
      sessionId: SESSION_A,
      serverKnown: true,
    });

    await act(async () => {
      root.render(createElement(Probe));
    });
    await vi.waitFor(() => expect(h.confirm).toHaveBeenCalled());

    expect(h.claim.mock.calls[0][0]).toEqual({
      expectedVersion: 5,
      source: "web",
      sessionId: SESSION_A,
    });
    expect(h.confirm.mock.calls[0][0]).toEqual({
      version: 6,
      source: "web",
      sessionId: SESSION_A,
    });
    expect(h.create.mock.calls[0][0]).toMatchObject({
      timerSessionId: SESSION_A,
    });
  });
});
