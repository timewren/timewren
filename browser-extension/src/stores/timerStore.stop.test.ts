import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../lib/api-error";

// --- chrome.storage.local-stub (offline-køen og klippekort-valget bor dér)
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

type Queued = {
  type: string;
  payload: Record<string, unknown>;
  notBefore?: string | null;
};
const queue = () => (storage.get("offlineQueue") as Queued[] | undefined) ?? [];

const RUNNING = {
  isRunning: true,
  startTime: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
  elapsedSeconds: 0,
  baseSeconds: 0,
  projectId: "11111111-1111-4111-8111-111111111111",
  clientId: "22222222-2222-4222-8222-222222222222",
  description: "Arbejde",
  lastSyncedAt: null,
};

async function stopWithFakeTimers() {
  const done = useTimerStore.getState().stopTimer("Projekt", "Kunde");
  await vi.runAllTimersAsync();
  await done;
}

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
    prepaidChoice: { mode: "none" },
    lastStopResult: null,
  });
  api.claimForStop.mockResolvedValue({ success: true, version: 8 });
  api.confirmStop.mockResolvedValue({ success: true, version: 9 });
  api.cancelStop.mockResolvedValue({ success: true, version: 10 });
  api.setPrepaidChoice.mockResolvedValue({ success: true });
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("stopTimer — timeout må aldrig give dobbelte poster", () => {
  it("timeout og derefter succes: samme clientEntryId, ingen cancelStop, timeren stoppes", async () => {
    api.createTimeEntry
      .mockRejectedValueOnce(
        new ApiError("Forbindelsen tog for lang tid", "timeout"),
      )
      .mockResolvedValueOnce({
        id: "e1",
        success: true,
        prepaidDeduction: null,
      });

    await stopWithFakeTimers();

    expect(api.createTimeEntry).toHaveBeenCalledTimes(2);
    const [first] = api.createTimeEntry.mock.calls[0];
    const [second] = api.createTimeEntry.mock.calls[1];
    expect(second.clientEntryId).toBe(first.clientEntryId);
    expect(api.cancelStop).not.toHaveBeenCalled();
    expect(api.confirmStop).toHaveBeenCalled();

    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(false);
    expect(state.displayTime).toBe(0);
    expect(state.error).toBeNull();
    expect(state.lastStopResult?.pendingSave).toBe(false);
    // Write-ahead-posterne er ryddet op efter kvitteret gem
    expect(queue()).toHaveLength(0);
  });

  it("vedvarende timeout: timeren genoptages IKKE, gemmet ligger i køen med samme nøgle", async () => {
    api.createTimeEntry.mockRejectedValue(
      new ApiError("Forbindelsen tog for lang tid", "timeout"),
    );

    await stopWithFakeTimers();

    expect(api.cancelStop).not.toHaveBeenCalled();
    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(false);
    expect(state.displayTime).toBe(0);
    expect(state.lastStopResult?.pendingSave).toBe(true);

    const usedKey = api.createTimeEntry.mock.calls[0][0].clientEntryId;
    for (const [entry] of api.createTimeEntry.mock.calls) {
      expect(entry.clientEntryId).toBe(usedKey);
    }
    const queued = queue().filter((a) => a.type === "createTimeEntry");
    expect(queued).toHaveLength(1);
    expect(queued[0].payload.clientEntryId).toBe(usedKey);
    // Frigivet til baggrunden med det samme
    expect(queued[0].notBefore ?? null).toBeNull();
    // Review P1: stoppet bekræftes IKKE straks — bekræftelsen ligger i køen
    // bag gemmet (samme group) og afspilles først, når gemmet er landet
    expect(api.confirmStop).not.toHaveBeenCalled();
    const all = queue();
    const confirmIdx = all.findIndex((a) => a.type === "confirmStop");
    const entryIdx = all.findIndex((a) => a.type === "createTimeEntry");
    expect(confirmIdx).toBeGreaterThan(entryIdx);
    expect(all[confirmIdx].notBefore ?? null).toBeNull();
    expect((all[confirmIdx] as { group?: string }).group).toBe(usedKey);
  });

  it("sikker afvisning (4xx): stoppet annulleres og timeren kører videre", async () => {
    api.createTimeEntry.mockRejectedValue(
      new ApiError("Projekt ikke fundet", "http", 404),
    );

    await stopWithFakeTimers();

    expect(api.createTimeEntry).toHaveBeenCalledTimes(1);
    expect(api.cancelStop).toHaveBeenCalled();
    // cancelStop bumper versionen — næste claim skal bruge den nye
    expect(useTimerStore.getState().serverVersion).toBe(10);
    expect(api.confirmStop).not.toHaveBeenCalled();
    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(true);
    expect(state.error).toContain("Projekt ikke fundet");
    expect(queue()).toHaveLength(0);
  });
});

describe("startTimer — overskriv aldrig en anden instans' timer", () => {
  beforeEach(() => {
    useTimerStore.setState({
      timer: {
        ...RUNNING,
        isRunning: false,
        startTime: null,
        projectId: null,
        clientId: null,
      },
      displayTime: 0,
    });
  });

  it("serveren har en kørende timer: den vises, og der skrives ikke", async () => {
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      version: 12,
      intent: null,
      intentFrom: null,
    });

    await useTimerStore.getState().startTimer(null, null, "");

    expect(api.updateTimerState).not.toHaveBeenCalled();
    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(true);
    expect(state.timer?.clientId).toBe(RUNNING.clientId);
    expect(state.serverVersion).toBe(12);
    expect(state.error).toMatch(/anden browser eller enhed/);
  });

  it("tom række på serveren: starter som normalt", async () => {
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      isRunning: false,
      startTime: null,
      version: 3,
      intent: null,
      intentFrom: null,
    });
    api.updateTimerState.mockResolvedValue({ ...RUNNING, version: 4 });

    await useTimerStore.getState().startTimer(null, null, "");

    expect(api.updateTimerState).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().error).toBeNull();
  });
});

describe("fetchTimerState", () => {
  it("overskriver ikke den lokale state midt i et eget stop", async () => {
    useTimerStore.setState({ isSyncing: true });
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      version: 8,
      intent: "stopping",
      intentFrom: "extension",
    });

    await useTimerStore.getState().fetchTimerState();

    expect(api.getTimerStateWithVersion).not.toHaveBeenCalled();
    expect(useTimerStore.getState().timer?.isRunning).toBe(true);
  });

  it("viser et stop fra en anden extension-instans som stoppende", async () => {
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      version: 8,
      intent: "stopping",
      intentFrom: "extension",
    });

    await useTimerStore.getState().fetchTimerState();

    const state = useTimerStore.getState();
    expect(state.timer?.isRunning).toBe(false);
    expect(state.displayTime).toBe(0);
    expect(state.remoteStopping).toBe(true);
  });
});

describe("stopTimer — intet netværkskald mellem claim og kø", () => {
  it("klippekort slås op FØR claimForStop", async () => {
    useTimerStore.setState({ prepaidChoice: { mode: "auto" } });
    const order: string[] = [];
    api.getActivePackages.mockImplementation(async () => {
      order.push("packages");
      return [];
    });
    api.claimForStop.mockImplementation(async () => {
      order.push("claim");
      return { success: true, version: 8 };
    });
    api.createTimeEntry.mockResolvedValue({
      id: "e1",
      success: true,
      prepaidDeduction: null,
    });

    await stopWithFakeTimers();

    expect(order).toEqual(["packages", "claim"]);
  });

  it("timeout efterfulgt af 4xx: timeren stoppes og gemmet bliver i køen", async () => {
    api.createTimeEntry
      .mockRejectedValueOnce(new ApiError("timeout", "timeout"))
      .mockRejectedValue(new ApiError("Ugyldig forespørgsel", "http", 400));

    await stopWithFakeTimers();

    expect(api.cancelStop).not.toHaveBeenCalled();
    expect(useTimerStore.getState().timer?.isRunning).toBe(false);
    expect(useTimerStore.getState().lastStopResult?.pendingSave).toBe(true);
    expect(queue().filter((a) => a.type === "createTimeEntry")).toHaveLength(1);
  });
});

describe("startTimer — række midt i et stop", () => {
  beforeEach(() => {
    useTimerStore.setState({
      timer: { ...RUNNING, isRunning: false, startTime: null },
      displayTime: 0,
    });
  });

  it("en anden instans' hængende stop overskrives ikke", async () => {
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      version: 8,
      intent: "stopping",
      intentFrom: "extension",
    });

    await useTimerStore.getState().startTimer(null, null, "");

    expect(api.updateTimerState).not.toHaveBeenCalled();
    expect(useTimerStore.getState().error).toMatch(/stop er i gang/i);
  });

  it("eget efterladt stop (bekræftelse i køen) må afløses af en ny start", async () => {
    storage.set("offlineQueue", [
      {
        id: "q1",
        type: "confirmStop",
        payload: { version: 8 },
        createdAt: new Date().toISOString(),
        retryCount: 0,
      },
    ]);
    api.getTimerStateWithVersion.mockResolvedValue({
      ...RUNNING,
      version: 8,
      intent: "stopping",
      intentFrom: "extension",
    });
    api.updateTimerState.mockResolvedValue({ ...RUNNING, version: 9 });

    await useTimerStore.getState().startTimer(null, null, "");

    expect(api.updateTimerState).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().error).toBeNull();
  });
});

describe("stopTimer — serverens claimede klippekort-valg (#422) mod kort hentet før claim", () => {
  const PKG = {
    id: "33333333-3333-4333-8333-333333333333",
    clientId: RUNNING.clientId,
    clientName: "Kunde",
    name: "Kort A",
    totalHours: 10,
    usedHours: 0,
    remainingHours: 10,
    expiresAt: null,
  };

  it("claimet valg vinder over lokalt 'none' og opløses uden netværk efter claim", async () => {
    useTimerStore.setState({ prepaidChoice: { mode: "none" } });
    const order: string[] = [];
    api.getActivePackages.mockImplementation(async () => {
      order.push("packages");
      return [PKG];
    });
    api.claimForStop.mockImplementation(async () => {
      order.push("claim");
      return {
        success: true,
        version: 8,
        prepaidChoice: {
          mode: "package",
          packageId: PKG.id,
          clientId: RUNNING.clientId,
        },
      };
    });
    api.createTimeEntry.mockImplementation(async () => {
      order.push("create");
      return { id: "e1", success: true, prepaidDeduction: null };
    });

    await stopWithFakeTimers();

    expect(order).toEqual(["packages", "claim", "create"]);
    expect(api.createTimeEntry.mock.calls[0][0].prepaidPackageId).toBe(PKG.id);
  });

  it("claimet pinnet kort der ikke findes erstattes ikke tavst af auto-kortet", async () => {
    useTimerStore.setState({ prepaidChoice: { mode: "auto" } });
    api.getActivePackages.mockResolvedValue([{ ...PKG, autoDeduct: true }]);
    api.claimForStop.mockResolvedValue({
      success: true,
      version: 8,
      prepaidChoice: {
        mode: "package",
        packageId: "44444444-4444-4444-8444-444444444444",
        clientId: RUNNING.clientId,
      },
    });
    api.createTimeEntry.mockResolvedValue({
      id: "e1",
      success: true,
      prepaidDeduction: null,
    });

    await stopWithFakeTimers();

    expect(api.createTimeEntry.mock.calls[0][0].prepaidPackageId).toBeNull();
    expect(useTimerStore.getState().lastStopResult?.prepaidWarning).toMatch(
      /kunne ikke bruges/,
    );
  });
});
