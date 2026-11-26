// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerConfirmation } from "@/lib/timer/server-confirmation";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Den rigtige useTimerSync: afstemningen sætter serverbekræftelsen, og fokus
 * glemmer den straks, også mens serverens svar stadig er undervejs (#1324).
 * Kun tRPC, react-query og realtime-kanalerne er erstattet.
 */
const h = vi.hoisted(() => ({
  refetch: null as null | ReturnType<typeof vi.fn>,
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    setQueryData: () => {},
    getQueryData: () => undefined,
    cancelQueries: async () => {},
  }),
}));
vi.mock("@/providers/trpc-provider", () => {
  const hooks: Record<string, unknown> = {
    useQuery: () => ({ data: undefined, refetch: h.refetch }),
    useMutation: () => ({
      mutate: () => {},
      mutateAsync: async () => undefined,
      isPending: false,
    }),
  };
  const node: object = new Proxy(() => node, {
    get: (_t, prop) => hooks[prop as string] ?? node,
  });
  return { trpc: node };
});
vi.mock("../useTimerRealtime", () => ({
  useTimerRealtime: () => ({ connected: false }),
}));
vi.mock("../useTimerElectricSync", () => ({
  useTimerElectricSync: () => {},
}));
vi.mock("../useTimerTabOwner", () => ({
  useTimerTabOwner: () => ({ isOwner: false, handover: false }),
}));

const { useTimerSync } = await import("../useTimerSync");

const HOUR = 3600;

let confirmation: ServerConfirmation;
function Probe() {
  confirmation = useTimerSync().serverConfirmation;
  return null;
}

describe("useTimerSync: serverbekræftelse (#1324)", () => {
  let container: HTMLElement;
  let root: Root;
  let startedAt: number;

  const serverRead = () => ({
    isSuccess: true,
    data: {
      isRunning: true,
      intent: null,
      sessionId: "s1",
      startTime: new Date(startedAt).toISOString(),
      baseSeconds: 0,
      elapsedSeconds: 0,
      sessionStartTime: new Date(startedAt).toISOString(),
      projectId: null,
      clientId: null,
      taskId: null,
      description: "",
      version: 1,
    },
  });
  const confirmed = () =>
    confirmation.elapsedSeconds(useTimerStore.getState(), Date.now());

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    startedAt = Date.now() - 11 * HOUR * 1000;
    useTimerStore.getState().resetTimer();
    useTimerStore.setState({
      isRunning: true,
      sessionId: "s1",
      startTime: startedAt,
      sessionStartTime: startedAt,
      baseTime: 0,
      elapsedTime: 11 * HOUR,
    });
    h.refetch = vi.fn(async () => serverRead());
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    useTimerStore.getState().resetTimer();
  });

  it("bekræfter efter afstemning og glemmer det straks ved fokus", async () => {
    act(() => root.render(createElement(Probe)));
    expect(confirmed()).toBeNull();

    // Afstemningen ved indlæsning bekræfter serverens starttid.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(h.refetch).toHaveBeenCalled();
    expect(confirmed()).toBeGreaterThanOrEqual(11 * HOUR);

    // Fokus: serverens svar hænger, men bekræftelsen er væk med det samme.
    let answer: (v: ReturnType<typeof serverRead>) => void = () => {};
    h.refetch?.mockImplementation(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        }),
    );
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(confirmed()).toBeNull();

    // Svaret lander: bekræftet igen.
    await act(async () => {
      answer(serverRead());
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(confirmed()).toBeGreaterThanOrEqual(11 * HOUR);
  });
});
