// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Widgettens online stop mod en session, fanen afløser undervejs (#1333).
 * Testen styrer, hvornår serverkaldene svarer, og adopterer B i store'en
 * imens, som afstemningen i bjælken ville gøre.
 */
const h = vi.hoisted(() => ({
  calls: {} as Record<
    string,
    ReturnType<typeof vi.fn<(...args: unknown[]) => Promise<unknown>>>
  >,
  toast: {
    warning: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/providers/trpc-provider", () => {
  const call = (path: string) => {
    h.calls[path] ??= vi.fn(async () => undefined);
    return h.calls[path];
  };
  const utilsNode = (path: string[]): object =>
    new Proxy(() => {}, {
      get: (_t, prop: string) => {
        if (prop === "fetch") return call(`${path.join(".")}.fetch`);
        if (prop === "invalidate") return () => {};
        return utilsNode([...path, prop]);
      },
    });
  const node = (path: string[]): object =>
    new Proxy(() => {}, {
      get: (_t, prop: string) => {
        if (prop === "useUtils") return () => utilsNode([]);
        if (prop === "useQuery") {
          return () => ({ data: undefined, isLoading: false, isError: false });
        }
        if (prop === "useMutation") {
          return () => ({
            mutate: () => {},
            mutateAsync: (...args: unknown[]) => call(path.join("."))(...args),
            isPending: false,
          });
        }
        return node([...path, prop]);
      },
    });
  return { trpc: node([]) };
});
vi.mock("next-intl", () => ({
  useLocale: () => "da",
  useTranslations: () => (key: string) => key,
}));
vi.mock("@/components/ui/ClientSearchCombobox", () => ({
  ClientSearchCombobox: () => null,
}));
vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => true, isPlaceholder: false }),
}));
vi.mock("@/hooks/useClientProjectSelection", () => ({
  useClientProjectSelection: () => ({
    autoSelectedProjectId: null,
    projects: [],
    isLoading: false,
  }),
}));

const { TimerWidget } = await import("../TimerWidget");

const KUNDE = "00000000-0000-4000-8000-000000000001";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIN = 60_000;

function deferred() {
  let resolve: (v: unknown) => void = () => {};
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("TimerWidget: stop mod en session, der er afløst (#1333)", () => {
  let container: HTMLElement;
  let root: Root;
  let startA: number;

  const claimSuccessA = () => ({
    success: true,
    version: 2,
    sessionId: SESSION_A,
    session: {
      projectId: null,
      clientId: KUNDE,
      taskId: null,
      description: "",
      startedAt: new Date(startA).toISOString(),
    },
  });
  /** Afstemningen adopterer B fra en anden enhed. */
  const adoptB = () =>
    act(() => {
      const startB = Date.now() - 2 * MIN;
      useTimerStore.setState({
        isRunning: true,
        sessionId: SESSION_B,
        clientId: KUNDE,
        description: "B",
        startTime: startB,
        sessionStartTime: startB,
        elapsedTime: 120,
      });
    });
  const expectBUntouched = () =>
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
      description: "B",
      elapsedTime: 120,
    });
  const clickStop = async () => {
    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="widget.stopTimer"]',
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
    });
  };
  const settle = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    for (const fn of Object.values(h.toast)) fn.mockReset();
    for (const fn of Object.values(h.calls)) fn.mockReset();
    useOfflineQueueStore.setState({ items: [] });
    useTimerStore.getState().resetTimer();
    startA = Date.now() - 30 * MIN;
    useTimerStore.setState({
      isRunning: true,
      sessionId: SESSION_A,
      clientId: KUNDE,
      projectId: "",
      description: "A",
      startTime: startA,
      sessionStartTime: startA,
      baseTime: 0,
      elapsedTime: 30 * 60,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() =>
      root.render(
        createElement(TimerWidget, {
          projects: [],
          clients: [],
          onTimeEntrySaved: () => {},
        }),
      ),
    );
    h.calls["timerSync.getState.fetch"] = vi.fn(async () => ({
      isRunning: true,
      version: 1,
    }));
    h.calls["timerSync.claimForStop"] = vi.fn(async () => claimSuccessA());
    h.calls["time.create"] = vi.fn(async () => ({ complianceWarnings: [] }));
    h.calls["timerSync.confirmStop"] = vi.fn(async () => ({ success: true }));
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useTimerStore.getState().resetTimer();
  });

  it("claimer ikke B, når B adopteres, mens serverens tilstand hentes", async () => {
    const state = deferred();
    h.calls["timerSync.getState.fetch"].mockImplementation(() => state.promise);
    await clickStop();
    adoptB();
    state.resolve({ isRunning: true, version: 4 });
    await settle();

    expect(h.calls["timerSync.claimForStop"]).not.toHaveBeenCalled();
    expect(h.calls["time.create"]).not.toHaveBeenCalled();
    expectBUntouched();
  });

  it("gemmer ikke B's tid som A's, når claim-svaret for A lander efter B", async () => {
    const claim = deferred();
    h.calls["timerSync.claimForStop"].mockImplementation(() => claim.promise);
    await clickStop();
    adoptB();
    claim.resolve(claimSuccessA());
    await settle();

    expect(h.calls["time.create"]).not.toHaveBeenCalled();
    expectBUntouched();
    expect(h.toast.error).toHaveBeenCalledWith("widget.stoppedElsewhere");
  });

  it("frigiver et claim, der lykkes, men afvises bagefter, bundet til den claimede session (#1333)", async () => {
    // Hverken id eller startnøgle, og rækken kører uden session: ubundet claim.
    useTimerStore.setState({ sessionId: null, startOpId: null });
    const claim = deferred();
    h.calls["timerSync.claimForStop"].mockImplementation(() => claim.promise);
    h.calls["timerSync.cancelStop"] = vi.fn(async () => ({
      success: true,
      version: 6,
    }));
    await clickStop();
    adoptB();
    claim.resolve({ ...claimSuccessA(), sessionId: SESSION_B, version: 5 });
    await settle();

    expect(h.calls["time.create"]).not.toHaveBeenCalled();
    expect(h.calls["timerSync.cancelStop"]).toHaveBeenCalledTimes(1);
    expect(h.calls["timerSync.cancelStop"].mock.calls[0][0]).toMatchObject({
      sessionId: SESSION_B,
      version: 5,
      source: "web",
    });
    expectBUntouched();
  });

  it("claimer ikke B, når fanen aldrig fik A's id, og serveren allerede kører B", async () => {
    useTimerStore.setState({ sessionId: null });
    const startB = Date.now() - 2 * MIN;
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: true,
      version: 4,
      sessionId: SESSION_B,
      startTime: new Date(startB).toISOString(),
    });
    await clickStop();
    await settle();

    expect(h.calls["timerSync.claimForStop"]).not.toHaveBeenCalled();
    expect(h.calls["time.create"]).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("widget.stoppedElsewhere");
  });

  it("binder claimet til rækkens id, når fanen aldrig fik A's id, men starten er A's", async () => {
    useTimerStore.setState({ sessionId: null });
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: true,
      version: 1,
      sessionId: SESSION_A,
      startTime: new Date(startA).toISOString(),
    });
    await clickStop();
    await settle();

    expect(h.calls["timerSync.claimForStop"].mock.calls[0][0]).toMatchObject({
      sessionId: SESSION_A,
    });
    expect(h.calls["time.create"]).toHaveBeenCalledTimes(1);
  });

  it("bruger startnøglen, ikke B's id, når en pauset B på serveren ikke har nogen start", async () => {
    // A uden id (tabt startsvar); B er pauset på serveren med opsparet tid.
    const startOpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    useTimerStore.setState({ sessionId: null, startOpId });
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: false,
      startTime: null,
      elapsedSeconds: 300,
      baseSeconds: 300,
      version: 4,
      sessionId: SESSION_B,
    });
    h.calls["timerSync.claimForStop"].mockResolvedValue({
      success: false,
      reason: "session_mismatch",
      version: 4,
    });
    await clickStop();
    await settle();

    const input = h.calls["timerSync.claimForStop"].mock.calls[0][0];
    expect(input).toMatchObject({ sessionOpId: startOpId });
    expect(input).not.toHaveProperty("sessionId", SESSION_B);
    expect(h.calls["time.create"]).not.toHaveBeenCalled();
  });

  it("bruger startnøglen, ikke B's id, når B kører med en start inden for et sekund af A's", async () => {
    // A uden id (tabt startsvar) er kasseret; en anden klient startede B
    // 500 ms efter A. B's start ligner A's, men B er ikke A.
    const startOpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    useTimerStore.setState({ sessionId: null, startOpId });
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: true,
      version: 4,
      sessionId: SESSION_B,
      startTime: new Date(startA + 500).toISOString(),
    });
    h.calls["timerSync.claimForStop"].mockResolvedValue({
      success: false,
      reason: "session_mismatch",
      version: 4,
    });
    await clickStop();
    await settle();

    const input = h.calls["timerSync.claimForStop"].mock.calls[0][0];
    expect(input).toMatchObject({ sessionOpId: startOpId });
    expect(input).not.toHaveProperty("sessionId", SESSION_B);
    expect(h.calls["time.create"]).not.toHaveBeenCalled();
  });

  it("claimer ikke en pauset B, når A hverken har id eller startnøgle", async () => {
    useTimerStore.setState({ sessionId: null, startOpId: null });
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: false,
      startTime: null,
      elapsedSeconds: 300,
      baseSeconds: 300,
      version: 4,
      sessionId: SESSION_B,
    });
    await clickStop();
    await settle();

    expect(h.calls["timerSync.claimForStop"]).not.toHaveBeenCalled();
    expect(h.calls["time.create"]).not.toHaveBeenCalled();
    expect(h.toast.error).toHaveBeenCalledWith("widget.stoppedElsewhere");
  });

  it("beholder A's lokale tid, når startnøglen aldrig nåede serveren", async () => {
    const startOpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    useTimerStore.setState({ sessionId: null, startOpId });
    h.calls["timerSync.getState.fetch"].mockResolvedValue({
      isRunning: false,
      startTime: null,
      elapsedSeconds: 300,
      baseSeconds: 300,
      version: 4,
      sessionId: SESSION_B,
    });
    h.calls["timerSync.claimForStop"].mockResolvedValue({
      success: false,
      reason: "session_mismatch",
      version: 4,
      startNeverLanded: true,
    });
    await clickStop();
    await settle();

    expect(useTimerStore.getState()).toMatchObject({
      isRunning: true,
      description: "A",
      elapsedTime: 30 * 60,
    });
  });

  it("stopper ikke B, når B adopteres, mens A's post gemmes", async () => {
    const create = deferred();
    h.calls["time.create"].mockImplementation(() => create.promise);
    await clickStop();
    await settle();
    expect(h.calls["time.create"]).toHaveBeenCalledTimes(1);
    expect(h.calls["time.create"].mock.calls[0][0]).toMatchObject({
      timerSessionId: SESSION_A,
      description: "A",
      hours: 0.5,
    });

    adoptB();
    create.resolve({ complianceWarnings: [] });
    await settle();

    expectBUntouched();
    expect(h.calls["timerSync.confirmStop"].mock.calls[0][0]).toMatchObject({
      sessionId: SESSION_A,
    });
  });
});
