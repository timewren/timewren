import { beforeEach, describe, expect, it, vi } from "vitest";

const sendMessage = vi.fn(async (_message: unknown) => {});
vi.stubGlobal("chrome", {
  runtime: { sendMessage },
  storage: {
    local: {
      get: async () => ({}),
      set: async () => {},
      remove: async () => {},
    },
  },
});

vi.mock("../lib/sentry", () => ({
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}));
vi.mock("../api/client", () => ({ apiClient: {} }));

const { useTimerStore } = await import("./timerStore");

const changed = () =>
  sendMessage.mock.calls.filter(
    ([m]) => (m as { type: string }).type === "TIMER_CHANGED",
  ).length;

beforeEach(() => {
  sendMessage.mockClear();
  useTimerStore.setState({ timer: null, displayTime: 0, error: null });
});

describe("baggrunden synker efter en timerhandling (#C3)", () => {
  it("én besked pr. handling", async () => {
    await useTimerStore.getState().pauseTimer();
    expect(changed()).toBe(1);
  });

  it("stopAndStart giver kun én besked", async () => {
    // Uden timer stopper stopTimer straks; startTimer springes over, fordi
    // der ikke er noget at starte efter (error/timer-tjek)
    useTimerStore.setState({ error: "x" });
    await useTimerStore.getState().stopAndStart(
      { projectId: null, clientId: null },
      {
        projectName: null,
        clientName: null,
      },
    );
    expect(changed()).toBe(1);
  });
});
