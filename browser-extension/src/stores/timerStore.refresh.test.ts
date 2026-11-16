import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, noConnectionMessage } from "../lib/api-error";

/**
 * Baggrunds-refresh (#7), fejl der ikke skjuler timeren (#8), beskrivelse der
 * ikke blokerer Start/Stop (#13) og timere over midnat (#6).
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
const CLIENT_A = "22222222-2222-4222-8222-222222222222";

const RUNNING = {
  isRunning: true,
  startTime: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: null,
  clientId: CLIENT_A,
  description: "Arbejde",
  lastSyncedAt: null,
  sessionId: SESSION,
};

const EMPTY = {
  isRunning: false,
  startTime: null,
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: null,
  clientId: null,
  description: "",
  lastSyncedAt: null,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  storage.clear();
  for (const fn of Object.values(api)) fn.mockReset();
  useOfflineStore.setState({ isOnline: true, queue: [] });
  useTimerStore.setState({
    timer: { ...RUNNING },
    displayTime: 31 * 60,
    serverVersion: 7,
    isLoading: false,
    isSyncing: false,
    error: null,
    remoteStopping: false,
    prepaidChoice: { mode: "none" },
    lastStopResult: null,
    stopPromptOpen: false,
  });
  api.getActivePackages.mockResolvedValue([]);
  api.setPrepaidChoice.mockResolvedValue({ success: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("fetchTimerState i baggrunden (#7)", () => {
  it("viser ingen spinner og rydder ikke en synlig fejl", async () => {
    useTimerStore.setState({ error: "Kunne ikke pause timer" });
    const pending = deferred<unknown>();
    api.getTimerStateWithVersion.mockReturnValue(pending.promise);

    const fetching = useTimerStore
      .getState()
      .fetchTimerState({ background: true });
    expect(useTimerStore.getState().isLoading).toBe(false);
    expect(useTimerStore.getState().error).toBe("Kunne ikke pause timer");

    pending.resolve({ ...RUNNING, version: 8 });
    await fetching;
    expect(useTimerStore.getState().isLoading).toBe(false);
    expect(useTimerStore.getState().error).toBe("Kunne ikke pause timer");
    expect(useTimerStore.getState().serverVersion).toBe(8);
  });

  it("en fejlet baggrunds-hentning beholder timeren og viser ingen fejl", async () => {
    api.getTimerStateWithVersion.mockRejectedValue(
      new ApiError(noConnectionMessage(), "network"),
    );
    await useTimerStore.getState().fetchTimerState({ background: true });
    const state = useTimerStore.getState();
    expect(state.timer?.sessionId).toBe(SESSION);
    expect(state.displayTime).toBe(31 * 60);
    expect(state.error).toBeNull();
  });

  it("broadcastens tilstand bruges direkte uden et ekstra kald", async () => {
    await useTimerStore.getState().fetchTimerState({
      background: true,
      state: { ...RUNNING, description: "Fra web", version: 9 },
    });
    expect(api.getTimerStateWithVersion).not.toHaveBeenCalled();
    expect(useTimerStore.getState().timer?.description).toBe("Fra web");
    expect(useTimerStore.getState().serverVersion).toBe(9);
  });

  it("en broadcast med ældre version end vores erstattes af en frisk hentning", async () => {
    // Pausen er landet (version 9); broadcasten blev hentet før (version 8)
    useTimerStore.setState({
      timer: {
        ...RUNNING,
        isRunning: false,
        startTime: null,
        baseSeconds: 1860,
      },
      serverVersion: 9,
    });
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      isRunning: false,
      startTime: null,
      baseSeconds: 1860,
      version: 9,
    });
    await useTimerStore.getState().fetchTimerState({
      background: true,
      state: { ...RUNNING, version: 8 },
    });
    expect(api.getTimerStateWithVersion).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().timer?.isRunning).toBe(false);
    expect(useTimerStore.getState().serverVersion).toBe(9);
  });

  it("et forældet svar overskriver ikke en netop startet timer", async () => {
    useTimerStore.setState({ timer: { ...EMPTY }, displayTime: 0 });
    const stale = deferred<unknown>();
    // 1. kald: baggrundens hentning (hænger). 2. kald: startens servertjek.
    api.getTimerStateWithVersion
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce({ ...EMPTY, version: 7 });
    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      startTime: new Date().toISOString(),
      version: 8,
    });

    const fetching = useTimerStore
      .getState()
      .fetchTimerState({ background: true });
    await useTimerStore.getState().startTimer(null, CLIENT_A, "Ny opgave");
    expect(useTimerStore.getState().timer?.isRunning).toBe(true);

    // Den gamle hentning lander nu med den tomme række
    stale.resolve({ ...EMPTY, version: 7 });
    await fetching;
    expect(useTimerStore.getState().timer?.isRunning).toBe(true);
    expect(useTimerStore.getState().serverVersion).toBe(8);
  });

  it("spinneren vises kun, før timeren er hentet første gang", async () => {
    const pending = deferred<unknown>();
    api.getTimerStateWithVersion.mockReturnValue(pending.promise);
    const fetching = useTimerStore.getState().fetchTimerState();
    expect(useTimerStore.getState().isLoading).toBe(false);
    pending.resolve({ ...RUNNING, version: 8 });
    await fetching;

    useTimerStore.setState({ timer: null, isLoading: false });
    const first = deferred<unknown>();
    api.getTimerStateWithVersion.mockReturnValue(first.promise);
    const firstFetch = useTimerStore.getState().fetchTimerState();
    expect(useTimerStore.getState().isLoading).toBe(true);
    first.resolve({ ...RUNNING, version: 8 });
    await firstFetch;
    expect(useTimerStore.getState().isLoading).toBe(false);
  });
});

describe("fejl skjuler ikke timeren (#8)", () => {
  it("en fejlet hentning beholder den sidst kendte timer og siger det på dansk", async () => {
    api.getTimerStateWithVersion.mockRejectedValue(
      new TypeError("Failed to fetch"),
    );
    await useTimerStore.getState().fetchTimerState();
    const state = useTimerStore.getState();
    expect(state.timer?.sessionId).toBe(SESSION);
    expect(state.displayTime).toBe(31 * 60);
    expect(state.error).toBe(noConnectionMessage());
    expect(state.isLoading).toBe(false);
  });

  it("en fejlet pause viser en dansk tekst i stedet for browserens", async () => {
    api.updateTimerState.mockRejectedValue(new TypeError("Failed to fetch"));
    await useTimerStore.getState().pauseTimer();
    expect(useTimerStore.getState().error).toBe(noConnectionMessage());
    expect(useTimerStore.getState().timer?.isRunning).toBe(true);
  });
});

describe("beskrivelsen blokerer ikke knapperne (#13)", () => {
  it("en inaktiv timer skriver ikke beskrivelsen for sig selv", async () => {
    useTimerStore.setState({ timer: { ...EMPTY }, displayTime: 0 });
    await useTimerStore.getState().updateDescription("Møde");
    expect(api.updateTimerState).not.toHaveBeenCalled();
    expect(useTimerStore.getState().isSyncing).toBe(false);
  });

  it("start med skrevet beskrivelse sender den med i starten", async () => {
    useTimerStore.setState({ timer: { ...EMPTY }, displayTime: 0 });
    api.getTimerStateWithVersion.mockResolvedValue({ ...EMPTY, version: 7 });
    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      description: "Møde",
      version: 8,
    });
    await useTimerStore.getState().startTimer(null, null, "Møde");
    expect(api.updateTimerState).toHaveBeenCalledTimes(1);
    expect(api.updateTimerState.mock.calls[0][0]).toMatchObject({
      isRunning: true,
      description: "Møde",
    });
  });

  it("gemning af beskrivelsen sætter ikke isSyncing", async () => {
    const pending = deferred<unknown>();
    api.updateTimerState.mockReturnValue(pending.promise);
    const writing = useTimerStore.getState().updateDescription("Ny tekst");
    expect(useTimerStore.getState().isSyncing).toBe(false);
    pending.resolve({ ...RUNNING, description: "Ny tekst", version: 8 });
    await writing;
    expect(useTimerStore.getState().timer?.description).toBe("Ny tekst");
  });

  it("pause lige efter en beskrivelse venter på den og bruger den nye version", async () => {
    const descriptionDone = deferred<unknown>();
    api.updateTimerState
      .mockReturnValueOnce(descriptionDone.promise)
      .mockResolvedValueOnce({
        ...RUNNING,
        isRunning: false,
        startTime: null,
        baseSeconds: 1860,
        version: 9,
      });

    const writing = useTimerStore.getState().updateDescription("Ny tekst");
    const pausing = useTimerStore.getState().pauseTimer();
    // Pausen er ikke afvist — den venter på beskrivelsen
    expect(api.updateTimerState).toHaveBeenCalledTimes(1);
    descriptionDone.resolve({
      ...RUNNING,
      description: "Ny tekst",
      version: 8,
    });
    await Promise.all([writing, pausing]);

    expect(api.updateTimerState).toHaveBeenCalledTimes(2);
    expect(api.updateTimerState.mock.calls[1][0]).toMatchObject({
      isRunning: false,
    });
    expect(useTimerStore.getState().timer?.isRunning).toBe(false);
    expect(useTimerStore.getState().serverVersion).toBe(9);
  });
});

describe("beskrivelses-gemninger i kæde", () => {
  /** Hver updateTimerState får sit eget løfte, som testen indfrier. */
  function manualWrites() {
    const writes: Array<ReturnType<typeof deferred<unknown>>> = [];
    api.updateTimerState.mockImplementation(() => {
      const d = deferred<unknown>();
      writes.push(d);
      return d.promise;
    });
    return writes;
  }
  const flush = () => new Promise((r) => setTimeout(r, 0));

  function mockStop() {
    api.claimForStop.mockResolvedValue({
      success: true,
      version: 11,
      sessionId: SESSION,
    });
    api.createTimeEntry.mockResolvedValue({ id: "e1", success: true });
    api.confirmStop.mockResolvedValue({ success: true, version: 12 });
  }

  it("anden gemning sendes først når den første er besvaret", async () => {
    const writes = manualWrites();
    const first = useTimerStore.getState().updateDescription("A");
    const second = useTimerStore.getState().updateDescription("AB");
    await flush();
    expect(writes).toHaveLength(1);

    writes[0].resolve({ ...RUNNING, description: "A", version: 8 });
    await flush();
    expect(writes).toHaveLength(2);
    expect(api.updateTimerState.mock.calls[1][0]).toMatchObject({
      description: "AB",
    });
    writes[1].resolve({ ...RUNNING, description: "AB", version: 9 });
    await Promise.all([first, second]);
    expect(useTimerStore.getState().timer?.description).toBe("AB");
    expect(useTimerStore.getState().serverVersion).toBe(9);
  });

  it("stop venter på hele kæden, og et sent svar genopliver ikke timeren", async () => {
    const writes = manualWrites();
    mockStop();
    const first = useTimerStore.getState().updateDescription("A");
    const second = useTimerStore.getState().updateDescription("AB");
    await flush();
    // Svarene kommer i omvendt rækkefølge, hvis begge er sendt
    writes.at(-1)?.resolve({ ...RUNNING, description: "AB", version: 9 });
    await flush();
    const stopping = useTimerStore.getState().stopTimer(null, "Kunde A");
    await flush();
    for (const w of writes) {
      w.resolve({ ...RUNNING, description: "A", version: 8 });
    }
    await flush();
    writes.at(-1)?.resolve({ ...RUNNING, description: "AB", version: 9 });
    await Promise.all([first, second, stopping]);
    await flush();

    expect(api.claimForStop).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().timer?.isRunning).not.toBe(true);
  });

  it("en beskrivelse skrevet mens stoppet venter, overskriver ikke stoppet", async () => {
    const writes = manualWrites();
    mockStop();
    const first = useTimerStore.getState().updateDescription("A");
    const stopping = useTimerStore.getState().stopTimer(null, "Kunde A");
    const second = useTimerStore.getState().updateDescription("AB");
    await flush();
    writes[0].resolve({ ...RUNNING, description: "A", version: 8 });
    await flush();
    writes[1]?.resolve({ ...RUNNING, description: "AB", version: 9 });
    await Promise.all([first, second, stopping]);
    await flush();

    expect(api.claimForStop).toHaveBeenCalledTimes(1);
    // Stoppet blev sendt efter den sidste beskrivelse, ikke før
    expect(api.updateTimerState).toHaveBeenCalledTimes(2);
    expect(useTimerStore.getState().timer?.isRunning).not.toBe(true);
  });
});

describe("dobbeltklik og skrivninger i kø", () => {
  it("to klik på Stop under en beskrivelse giver kun ét stop", async () => {
    const descriptionDone = deferred<unknown>();
    api.updateTimerState.mockReturnValueOnce(descriptionDone.promise);
    api.claimForStop.mockResolvedValue({
      success: true,
      version: 9,
      sessionId: SESSION,
    });
    api.createTimeEntry.mockResolvedValue({ id: "e1", success: true });
    api.confirmStop.mockResolvedValue({ success: true, version: 10 });

    const writing = useTimerStore.getState().updateDescription("Ny tekst");
    const first = useTimerStore.getState().stopTimer(null, "Kunde A");
    const second = useTimerStore.getState().stopTimer(null, "Kunde A");
    descriptionDone.resolve({
      ...RUNNING,
      description: "Ny tekst",
      version: 8,
    });
    await Promise.all([writing, first, second]);

    expect(api.claimForStop).toHaveBeenCalledTimes(1);
    expect(api.createTimeEntry).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().lastStopResult?.hours).toBeGreaterThan(0);
  });

  it("en beskrivelse skrevet under en igangværende skrivning går ikke tabt", async () => {
    useTimerStore.setState({ isSyncing: true });
    api.updateTimerState.mockResolvedValue({
      ...RUNNING,
      description: "Skrevet imens",
      version: 8,
    });
    const writing = useTimerStore.getState().updateDescription("Skrevet imens");
    expect(api.updateTimerState).not.toHaveBeenCalled();
    useTimerStore.setState({ isSyncing: false });
    await writing;
    expect(api.updateTimerState).toHaveBeenCalledTimes(1);
    expect(api.updateTimerState.mock.calls[0][0]).toMatchObject({
      description: "Skrevet imens",
    });
  });
});

describe("timer over midnat (#6)", () => {
  it("posten dateres efter starttidspunktet", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    // 01:00 lokal tid; timeren har kørt i 2 timer (startet 23:00 dagen før)
    vi.setSystemTime(new Date(2026, 9, 27, 1, 0, 0));
    useTimerStore.setState({ displayTime: 2 * 3600 });
    api.claimForStop.mockResolvedValue({
      success: true,
      version: 8,
      sessionId: SESSION,
    });
    api.createTimeEntry.mockResolvedValue({ id: "e1", success: true });
    api.confirmStop.mockResolvedValue({ success: true, version: 9 });

    await useTimerStore.getState().stopTimer(null, "Kunde A");

    const entry = api.createTimeEntry.mock.calls[0][0];
    expect(entry.date).toBe("2026-10-26");
    expect(new Date(entry.startTime).getHours()).toBe(23);
  });
});

describe("stop uden kunde spørger først (#11)", () => {
  it("requestStop åbner spørgsmålet i stedet for at gemme som intern tid", () => {
    useTimerStore.setState({
      timer: { ...RUNNING, clientId: null, projectId: null },
    });
    expect(useTimerStore.getState().requestStop(null, null)).toBe(true);
    expect(useTimerStore.getState().stopPromptOpen).toBe(true);
    expect(api.claimForStop).not.toHaveBeenCalled();
  });
});
