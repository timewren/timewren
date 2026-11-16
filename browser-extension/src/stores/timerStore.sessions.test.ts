import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api-error";

/**
 * Server-udstedte timer-sessioner i extensionen (2.6.0): alle skrivninger
 * bærer sessionen, og en skrivning der ikke landede, adopterer serverens
 * tilstand. Se docs/architecture/timer-sessions.md.
 */

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

vi.mock("../lib/sentry", () => ({
  Sentry: { captureException: vi.fn(), captureMessage: vi.fn() },
}));

const api = vi.hoisted(() => ({
  claimForStop: vi.fn(),
  createTimeEntry: vi.fn(),
  confirmStop: vi.fn(),
  cancelStop: vi.fn(),
  getActivePackages: vi.fn(),
  getTimerStateWithVersion: vi.fn(),
  updateTimerState: vi.fn(),
  setPrepaidChoice: vi.fn(),
}));
vi.mock("../api/client", () => ({ apiClient: api }));

const { useTimerStore } = await import("./timerStore");
const { useOfflineStore } = await import("./offlineStore");

const SESSION = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_SESSION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const PROJECT_A = "11111111-1111-4111-8111-111111111111";
const CLIENT_A = "22222222-2222-4222-8222-222222222222";
const PROJECT_B = "33333333-3333-4333-8333-333333333333";
const CLIENT_B = "44444444-4444-4444-8444-444444444444";

const RUNNING = {
  isRunning: true,
  startTime: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: PROJECT_A,
  clientId: CLIENT_A,
  description: "Arbejde",
  lastSyncedAt: null,
  sessionId: SESSION,
};

type Queued = { type: string; payload: Record<string, unknown> };
const queue = () => (storage.get("offlineQueue") as Queued[] | undefined) ?? [];

beforeEach(() => {
  storage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  useOfflineStore.setState({ isOnline: true, queue: [] });
  useTimerStore.setState({
    timer: { ...RUNNING },
    displayTime: 31 * 60,
    serverVersion: 7,
    isSyncing: false,
    error: null,
    remoteStopping: false,
    prepaidChoice: { mode: "none" },
    lastStopResult: null,
  });
  api.claimForStop.mockResolvedValue({
    success: true,
    version: 8,
    sessionId: SESSION,
    session: {
      id: SESSION,
      projectId: PROJECT_A,
      clientId: CLIENT_A,
      description: "Arbejde",
      startedAt: RUNNING.startTime,
    },
  });
  api.confirmStop.mockResolvedValue({ success: true, version: 9 });
  api.cancelStop.mockResolvedValue({ success: true, version: 10 });
  api.setPrepaidChoice.mockResolvedValue({ success: true });
  api.getActivePackages.mockResolvedValue([]);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("skrivninger bærer sessionen", () => {
  it("pause, genoptag og kundeskift sender sessionId", async () => {
    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      isRunning: false,
      startTime: null,
      baseSeconds: 1860,
      version: 8,
      sessionMismatch: false,
    });
    await useTimerStore.getState().pauseTimer();
    expect(api.updateTimerState.mock.calls[0][0].sessionId).toBe(SESSION);

    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      version: 9,
      sessionMismatch: false,
    });
    await useTimerStore.getState().resumeTimer();
    expect(api.updateTimerState.mock.calls[1][0].sessionId).toBe(SESSION);

    await useTimerStore.getState().updateClient(CLIENT_B);
    expect(api.updateTimerState.mock.calls[2][0]).toMatchObject({
      clientId: CLIENT_B,
      sessionId: SESSION,
    });
  });

  it("uden kendt session sendes intet sessionId (ældre række)", async () => {
    useTimerStore.setState({ timer: { ...RUNNING, sessionId: null } });
    api.updateTimerState.mockResolvedValue({ ...RUNNING, version: 8 });
    await useTimerStore.getState().updateClient(CLIENT_B);
    expect(api.updateTimerState.mock.calls[0][0]).not.toHaveProperty(
      "sessionId",
    );
  });
});

describe("session_mismatch: serverens tilstand adopteres (#787 K5)", () => {
  it("et kundeskift fra en forældet popup ændrer ikke en anden session", async () => {
    // Web har stoppet vores session og startet en ny på kunde A
    const serverState = {
      ...RUNNING,
      startTime: new Date().toISOString(),
      sessionId: OTHER_SESSION,
      version: 20,
      sessionMismatch: true,
    };
    api.updateTimerState.mockResolvedValue(serverState);

    await useTimerStore.getState().updateProject(PROJECT_B, CLIENT_B);

    const state = useTimerStore.getState();
    expect(state.timer?.sessionId).toBe(OTHER_SESSION);
    expect(state.timer?.clientId).toBe(CLIENT_A);
    expect(state.serverVersion).toBe(20);
    expect(state.isSyncing).toBe(false);
    expect(state.error).toMatch(/ændret fra en anden/);
  });

  it("en pause midt i et stop viser rækken som stoppende", async () => {
    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      intent: "stopping",
      version: 12,
      stoppingInProgress: true,
    });
    await useTimerStore.getState().pauseTimer();
    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(false);
    expect(state.displayTime).toBe(0);
    expect(state.remoteStopping).toBe(true);
  });
});

describe("start (#784 K2)", () => {
  beforeEach(() => {
    useTimerStore.setState({
      timer: null,
      displayTime: 0,
      prepaidChoice: { mode: "auto" },
    });
    // Popup'en har ikke set den anden instans' timer
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      isRunning: false,
      startTime: null,
      projectId: null,
      clientId: null,
      sessionId: null,
      version: 3,
      intent: null,
      intentFrom: null,
    });
  });

  it("starten bærer en idempotensnøgle", async () => {
    api.updateTimerState.mockResolvedValue({ ...RUNNING, version: 4 });
    await useTimerStore.getState().startTimer(PROJECT_A, CLIENT_A);
    const payload = api.updateTimerState.mock.calls[0][0];
    expect(payload.isFreshStart).toBe(true);
    expect(payload.clientOpId).toMatch(/^[0-9a-f-]{36}$/);
    expect(useTimerStore.getState().timer?.sessionId).toBe(SESSION);
  });

  it("en afvist start adopterer den kørende timer i stedet for at overskrive den", async () => {
    const running = {
      ...RUNNING,
      projectId: PROJECT_B,
      clientId: CLIENT_B,
      sessionId: OTHER_SESSION,
      version: 5,
      startRejected: "already_running" as const,
    };
    api.updateTimerState.mockResolvedValue(running);
    await useTimerStore.getState().startTimer(PROJECT_A, CLIENT_A);
    const state = useTimerStore.getState();
    expect(state.timer?.sessionId).toBe(OTHER_SESSION);
    expect(state.timer?.clientId).toBe(CLIENT_B);
    expect(state.timer?.isRunning).toBe(true);
    expect(state.error).toMatch(/kører allerede/);
  });
});

describe("stop", () => {
  async function stop() {
    const done = useTimerStore.getState().stopTimer("Projekt", "Kunde");
    await vi.runAllTimersAsync();
    await done;
  }

  it("claim, post og confirm bærer sessionen; posten gemmes på claimets øjebliksbillede (#785)", async () => {
    // Den lokale kopi siger B, men sessionen står på A
    useTimerStore.setState({
      timer: { ...RUNNING, projectId: PROJECT_B, clientId: CLIENT_B },
    });
    api.createTimeEntry.mockResolvedValue({ id: "e1", success: true });

    await stop();

    expect(api.claimForStop).toHaveBeenCalledWith(7, SESSION);
    const entry = api.createTimeEntry.mock.calls[0][0];
    expect(entry.timerSessionId).toBe(SESSION);
    expect(entry.projectId).toBe(PROJECT_A);
    expect(entry.clientId).toBe(CLIENT_A);
    expect(api.confirmStop).toHaveBeenCalledWith(8, SESSION);
  });

  it("write-ahead-køen bærer sessionen, så en afspilning er idempotent", async () => {
    api.createTimeEntry.mockRejectedValue(
      new ApiError("Forbindelsen tog for lang tid", "timeout"),
    );
    await stop();
    const queued = queue().find((a) => a.type === "createTimeEntry");
    expect(queued?.payload.timerSessionId).toBe(SESSION);
  });

  it("claim med session_mismatch: intet gemmes, serverens timer vises", async () => {
    api.claimForStop.mockResolvedValue({
      success: false,
      reason: "session_mismatch",
      version: 30,
      sessionId: OTHER_SESSION,
    });
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      sessionId: OTHER_SESSION,
      version: 30,
      intent: null,
      intentFrom: null,
    });
    await stop();
    expect(api.createTimeEntry).not.toHaveBeenCalled();
    const state = useTimerStore.getState();
    expect(state.timer?.sessionId).toBe(OTHER_SESSION);
    expect(state.error).toMatch(/ændret fra en anden/);
  });

  it("cancelStop svarer already_saved: sessionen er gemt — timeren kører ikke videre", async () => {
    api.createTimeEntry.mockRejectedValue(new ApiError("Ugyldig", "http", 400));
    api.cancelStop.mockResolvedValue({
      success: false,
      reason: "already_saved",
      version: 11,
    });
    await stop();
    expect(api.cancelStop).toHaveBeenCalledWith(8, SESSION);
    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(false);
    expect(state.displayTime).toBe(0);
    expect(state.error).toBeNull();
  });
});
