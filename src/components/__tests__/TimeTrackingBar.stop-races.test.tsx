// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drainQueue } from "@/lib/offline/replay";
import { useOfflineQueueStore } from "@/stores/offlineQueueStore";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Stopvejen gennem den rigtige TimeTrackingBar og den rigtige useTimerSync
 * (#1333). Kun tRPC, react-query og realtime-kanalerne er erstattet; testen
 * styrer serverens svar og hvornår claimet svarer.
 */
const h = vi.hoisted(() => ({
  server: null as null | Record<string, unknown>,
  refetch: null as null | ReturnType<typeof vi.fn>,
  claim: null as null | ReturnType<typeof vi.fn>,
  cancel: null as null | ReturnType<typeof vi.fn>,
  saveModal: null as null | {
    isOpen: boolean;
    onClose: () => unknown;
    projectId: string | null;
    clientId: string | null;
    onProjectChange: (projectId: string, clientId: string) => void;
    onSave: (o: {
      usePrepaid: boolean;
      isBillable: boolean;
      prepaidPackageId?: string;
    }) => unknown;
  },
  toast: {
    warning: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: async () => {},
    setQueryData: () => {},
    getQueryData: () => undefined,
    cancelQueries: async () => {},
  }),
}));
vi.mock("@/providers/trpc-provider", () => {
  const mutation = (path: string) => ({
    mutate: () => {},
    mutateAsync:
      path === "timerSync.claimForStop"
        ? h.claim
        : path === "timerSync.cancelStop"
          ? h.cancel
          : async () => undefined,
    isPending: false,
  });
  const query = (path: string) =>
    path === "timerSync.getState"
      ? { data: undefined, refetch: h.refetch }
      : { data: undefined, isLoading: false };
  const node = (path: string[]): object =>
    new Proxy(() => node(path), {
      get: (_t, prop) => {
        const key = path.join(".");
        if (prop === "useQuery") return () => query(key);
        if (prop === "useMutation") return () => mutation(key);
        return node([...path, String(prop)]);
      },
    });
  return { trpc: node([]) };
});
vi.mock("@/hooks/useTimerRealtime", () => ({
  useTimerRealtime: () => ({ connected: false }),
}));
vi.mock("@/hooks/useTimerElectricSync", () => ({
  useTimerElectricSync: () => {},
}));
vi.mock("@/hooks/useTimerTabOwner", () => ({
  useTimerTabOwner: () => ({ isOwner: false, handover: false }),
}));
vi.mock("@/hooks/useTimerShortcuts", () => ({ useTimerShortcuts: () => {} }));
vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => true, isPlaceholder: false }),
}));
vi.mock("@/components/BrandContext", () => ({
  useBrand: () => ({ id: "timetrack", name: "TimeTrack" }),
}));
vi.mock("next-intl", () => ({
  useLocale: () => "da",
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key,
}));
vi.mock("@/components/ui", () => ({ ConfirmDialog: () => null }));
vi.mock("@/components/timer", () => {
  const none = () => null;
  return {
    AddTimeModal: none,
    ClientProjectSelectModal: none,
    CreateTemplateModal: none,
    DescriptionAutocomplete: none,
    MobileActionsSheet: none,
    QuickActionsDropdown: none,
    RecentTasksModal: none,
    SaveTimeEntryModal: (props: NonNullable<typeof h.saveModal>) => {
      h.saveModal = props;
      return null;
    },
  };
});

const { TimeTrackingBar } = await import("../TimeTrackingBar");

const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const MIN = 60_000;

describe("TimeTrackingBar: stop mod en session, der er afløst (#1333)", () => {
  let container: HTMLElement;
  let root: Root;
  let online: boolean;
  let startA: number;

  const serverRunning = (
    sessionId: string,
    startedAt: number,
    version: number,
    projectId: string,
  ) => ({
    isSuccess: true,
    data: {
      isRunning: true,
      intent: null as string | null,
      intentFrom: null as string | null,
      sessionId,
      startTime: new Date(startedAt).toISOString(),
      sessionStartTime: new Date(startedAt).toISOString(),
      baseSeconds: 0,
      elapsedSeconds: 0,
      projectId,
      clientId: null,
      taskId: null,
      description: "",
      version,
      lastSyncedAt: new Date().toISOString(),
    },
  });
  const serverSays = (answer: ReturnType<typeof serverRunning>) => {
    h.refetch?.mockImplementation(async () => answer);
  };
  /** Som afstemningen ved fokus (efter 2 s-grænsen). */
  const reconcile = async () => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_500);
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(50);
    });
  };
  const clickStop = async () => {
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="timer-save"]',
    );
    expect(button).not.toBeNull();
    await act(async () => {
      button?.click();
      await vi.advanceTimersByTimeAsync(0);
    });
  };

  beforeEach(async () => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    vi.useFakeTimers({ toFake: ["setTimeout", "setInterval"] });
    online = true;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      get: () => online,
    });
    sessionStorage.clear();
    for (const fn of Object.values(h.toast)) fn.mockReset();
    h.saveModal = null;
    useOfflineQueueStore.setState({ items: [] });
    useTimerStore.getState().resetTimer();
    startA = Date.now() - 30 * MIN;
    useTimerStore.setState({
      isRunning: true,
      sessionId: SESSION_A,
      projectId: "project-a",
      startTime: startA,
      sessionStartTime: startA,
      baseTime: 0,
      elapsedTime: 30 * 60,
    });
    h.refetch = vi.fn();
    serverSays(serverRunning(SESSION_A, startA, 1, "project-a"));
    h.claim = vi.fn();
    h.cancel = vi.fn(async () => ({ success: true, version: 9 }));
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(createElement(TimeTrackingBar)));
    // Afstemningen ved indlæsning: serveren bekræfter A.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.useRealTimers();
    useTimerStore.getState().resetTimer();
    useOfflineQueueStore.setState({ items: [] });
  });

  it("et forsinket claim-svar for A rammer ikke B, som afstemningen har adopteret", async () => {
    let answerClaim: (v: unknown) => void = () => {};
    h.claim?.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerClaim = resolve;
        }),
    );
    await clickStop();
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.claim?.mock.calls[0][0]).toMatchObject({ sessionId: SESSION_A });

    // Imens: A kasseres, og B startes på en anden enhed; fanen adopterer B.
    const startB = Date.now() - 2 * MIN;
    serverSays(serverRunning(SESSION_B, startB, 4, "project-b"));
    await reconcile();
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
      projectId: "project-b",
    });

    // Nu lander det forsinkede svar på claimet af A.
    await act(async () => {
      answerClaim({
        success: true,
        version: 2,
        sessionId: SESSION_A,
        session: {
          projectId: "project-a",
          clientId: null,
          taskId: null,
          description: "",
          startedAt: new Date(startA).toISOString(),
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    // B er urørt: samme id og projekt, kører stadig, ingen gem-dialog.
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
      projectId: "project-b",
    });
    expect(h.saveModal?.isOpen).toBe(false);
    expect(h.toast.error).toHaveBeenCalledWith("bar.stoppedElsewhere");
  });

  it("et stop af A claimer ikke B, som afstemningen adopterer, mens refetch'et før claimet venter", async () => {
    let answerRefetch: (v: unknown) => void = () => {};
    h.refetch?.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answerRefetch = resolve;
        }),
    );
    h.claim?.mockResolvedValue({ success: false, reason: "session_mismatch" });
    await clickStop();

    // Imens: A kasseres, og B startes på en anden enhed; fanen adopterer B.
    const startB = Date.now() - 2 * MIN;
    const b = serverRunning(SESSION_B, startB, 4, "project-b");
    serverSays(b);
    await reconcile();
    expect(useTimerStore.getState().sessionId).toBe(SESSION_B);

    // Refetch'et før claimet svarer nu med B's version.
    await act(async () => {
      answerRefetch(b);
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.claim).not.toHaveBeenCalled();
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
      projectId: "project-b",
    });
    expect(h.saveModal?.isOpen).toBe(false);
  });

  it("et stop af A uden id claimer med startnøglen, ikke B's id, når B startede inden for et sekund af A (#1333)", async () => {
    // Svaret på A's start gik tabt: fanen har startnøglen, men intet id.
    const startOpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    useTimerStore.setState({ sessionId: null, startOpId });
    // A er kasseret; en anden klient startede B 500 ms efter A.
    serverSays(serverRunning(SESSION_B, startA + 500, 4, "project-a"));
    h.claim?.mockResolvedValue({ success: false, reason: "session_mismatch" });
    await clickStop();

    expect(h.claim).toHaveBeenCalledTimes(1);
    const input = h.claim?.mock.calls[0][0];
    expect(input).toMatchObject({ sessionOpId: startOpId });
    expect(input).not.toHaveProperty("sessionId", SESSION_B);
  });

  it("et sent afvist claim for A nulstiller ikke B", async () => {
    let answerClaim: (v: unknown) => void = () => {};
    h.claim?.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerClaim = resolve;
        }),
    );
    await clickStop();
    const startB = Date.now() - 2 * MIN;
    serverSays(serverRunning(SESSION_B, startB, 4, "project-b"));
    await reconcile();

    await act(async () => {
      answerClaim({ success: false, reason: "session_mismatch", version: 4 });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
    });
  });

  it("et claim, der lykkes, men afvises bagefter, frigives bundet til den claimede session (#1333)", async () => {
    // Hverken id eller startnøgle: claimet er ubundet og rammer rækkens B.
    useTimerStore.setState({ sessionId: null, startOpId: null });
    const startB = Date.now() - 2 * MIN;
    serverSays(serverRunning(SESSION_B, startB, 4, "project-b"));
    let answerClaim: (v: unknown) => void = () => {};
    h.claim?.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerClaim = resolve;
        }),
    );
    await clickStop();
    expect(h.claim?.mock.calls[0][0]).not.toHaveProperty(
      "sessionId",
      SESSION_A,
    );
    // Imens skifter fanen til B, som afstemningen ville gøre.
    act(() =>
      useTimerStore.setState({
        isRunning: true,
        sessionId: SESSION_B,
        projectId: "project-b",
        startTime: startB,
        sessionStartTime: startB,
        elapsedTime: 120,
      }),
    );

    await act(async () => {
      answerClaim({
        success: true,
        version: 5,
        sessionId: SESSION_B,
        session: {
          projectId: "project-b",
          clientId: null,
          taskId: null,
          description: "",
          startedAt: new Date(startB).toISOString(),
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.saveModal?.isOpen).toBe(false);
    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.cancel?.mock.calls[0][0]).toMatchObject({
      sessionId: SESSION_B,
      version: 5,
      source: "web",
    });
  });

  it("et stop uden id gennemføres, når afstemningen ser fanens eget claim som 'stopping' før svaret (#1333)", async () => {
    const startOpId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    useTimerStore.setState({ sessionId: null, startOpId });
    let answerClaim: (v: unknown) => void = () => {};
    h.claim?.mockImplementation(
      () =>
        new Promise((resolve) => {
          answerClaim = resolve;
        }),
    );
    await clickStop();
    expect(h.claim?.mock.calls[0][0]).toMatchObject({ sessionOpId: startOpId });

    // Realtime: rækken står nu i vores eget "stopping", før svaret er her.
    const own = serverRunning(SESSION_A, startA, 2, "project-a");
    serverSays({
      ...own,
      data: { ...own.data, intent: "stopping", intentFrom: "web" },
    });
    await reconcile();

    await act(async () => {
      answerClaim({
        success: true,
        version: 2,
        sessionId: SESSION_A,
        session: {
          projectId: "project-a",
          clientId: null,
          taskId: null,
          description: "",
          startedAt: new Date(startA).toISOString(),
        },
      });
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.toast.error).not.toHaveBeenCalled();
    expect(h.cancel).not.toHaveBeenCalled();
    expect(h.saveModal?.isOpen).toBe(true);
    expect(useTimerStore.getState().sessionId).toBe(SESSION_A);
  });

  /** Stop A, så gem-dialogen står åben, og lad fanen skifte til en pauset B. */
  const stopAThenAdoptPausedB = async () => {
    h.claim?.mockResolvedValue({
      success: true,
      version: 2,
      sessionId: SESSION_A,
      session: {
        projectId: "project-a",
        clientId: null,
        taskId: null,
        description: "",
        startedAt: new Date(startA).toISOString(),
      },
    });
    await clickStop();
    expect(h.saveModal?.isOpen).toBe(true);
    const startB = Date.now() - 2 * MIN;
    act(() =>
      useTimerStore.setState({
        isRunning: false,
        sessionId: SESSION_B,
        projectId: "project-b",
        startTime: null,
        sessionStartTime: startB,
        baseTime: 120,
        elapsedTime: 120,
      }),
    );
  };

  it("annullér i A's gem-dialog frigiver A's claim og genoptager ikke en pauset B (#1333)", async () => {
    await stopAThenAdoptPausedB();
    h.cancel?.mockResolvedValue({ success: true, version: 3 });
    await act(async () => {
      await h.saveModal?.onClose();
      await vi.advanceTimersByTimeAsync(0);
    });

    expect(h.cancel).toHaveBeenCalledTimes(1);
    expect(h.cancel?.mock.calls[0][0]).toMatchObject({ sessionId: SESSION_A });
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: false,
      elapsedTime: 120,
    });
  });

  it("lukkes siden med A's gem-dialog åben, frigives A's claim, ikke B's (#1333)", async () => {
    await stopAThenAdoptPausedB();
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("{}"));
    try {
      act(() => {
        window.dispatchEvent(new Event("pagehide"));
      });
      const cancelCall = fetchSpy.mock.calls.find(([url]) =>
        String(url).includes("timerSync.cancelStop"),
      );
      expect(cancelCall).toBeDefined();
      const body = JSON.parse(String(cancelCall?.[1]?.body));
      expect(body.json.sessionId).toBe(SESSION_A);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("et offline-stop af A gemmes med A's session, også når B er adopteret før gem", async () => {
    online = false;
    await clickStop();
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.saveModal?.isOpen).toBe(true);

    // Nettet kommer igen. A er gemt et andet sted, B kører; fanen adopterer B.
    online = true;
    const startB = Date.now() - 2 * MIN;
    serverSays(serverRunning(SESSION_B, startB, 4, "project-b"));
    await reconcile();
    expect(useTimerStore.getState().sessionId).toBe(SESSION_B);

    await act(async () => {
      await h.saveModal?.onSave({ usePrepaid: false, isBillable: true });
    });

    const [stop] = useOfflineQueueStore.getState().items;
    expect(stop).toMatchObject({
      kind: "timer.stop",
      sessionId: SESSION_A,
      sessionStartTime: startA,
      entry: { timerSessionId: SESSION_A },
    });
    // B kører videre lokalt.
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      isRunning: true,
    });
  });

  it("gem-dialogens valg efter at B er adopteret går til A's post, ikke til B (#1333)", async () => {
    online = false;
    await clickStop();
    expect(h.saveModal?.isOpen).toBe(true);

    online = true;
    const startB = Date.now() - 2 * MIN;
    serverSays(serverRunning(SESSION_B, startB, 4, "project-b"));
    await reconcile();
    expect(useTimerStore.getState().projectId).toBe("project-b");
    // Dialogen viser stadig A.
    expect(h.saveModal?.projectId).toBe("project-a");

    // Brugeren vælger projekt og klippekort i A's dialog.
    act(() => h.saveModal?.onProjectChange("project-c", "client-c"));
    expect(h.saveModal).toMatchObject({
      projectId: "project-c",
      clientId: "client-c",
    });
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      projectId: "project-b",
    });

    await act(async () => {
      await h.saveModal?.onSave({
        usePrepaid: true,
        isBillable: true,
        prepaidPackageId: "package-c",
      });
    });
    const [stop] = useOfflineQueueStore.getState().items;
    expect(stop).toMatchObject({
      kind: "timer.stop",
      sessionId: SESSION_A,
      entry: {
        projectId: "project-c",
        prepaidPackageId: "package-c",
        timerSessionId: SESSION_A,
      },
    });
    expect(useTimerStore.getState()).toMatchObject({
      sessionId: SESSION_B,
      projectId: "project-b",
      isRunning: true,
    });
  });

  it("et offline-stop af en adopteret A afspilles mod serveren og lægger aldrig A's tid på B (#1333)", async () => {
    // Fanen adopterede A fra en anden enhed; offline-store'en har aldrig
    // selv etableret den.
    useOfflineQueueStore.setState({ establishedSessionStart: null });
    online = false;
    await clickStop();
    expect(h.saveModal?.isOpen).toBe(true);

    online = true;
    const startB = Date.now() - 2 * MIN;
    const b = serverRunning(SESSION_B, startB, 4, "project-b");
    serverSays(b);
    await reconcile();
    expect(useTimerStore.getState().projectId).toBe("project-b");

    await act(async () => {
      await h.saveModal?.onSave({ usePrepaid: false, isBillable: true });
    });
    const [stop] = useOfflineQueueStore.getState().items;
    expect(stop).toMatchObject({
      kind: "timer.stop",
      sessionId: SESSION_A,
      serverKnown: true,
      entry: { projectId: "project-a", timerSessionId: SESSION_A },
    });

    // Det rigtige køelement afspilles mod en server, der kører B.
    const api = {
      syncStart: vi.fn(),
      getTimerState: vi.fn(async () => ({
        ...b.data,
        intent: null,
        intentFrom: null,
      })),
      claimForStop: vi.fn(),
      confirmStop: vi.fn(),
      createEntry: vi.fn(),
    };
    const result = await drainQueue(
      {
        getItems: () => useOfflineQueueStore.getState().items,
        setItems: (items) => useOfflineQueueStore.setState({ items }),
        setInFlight: () => {},
      },
      api,
    );
    expect(result.events).toMatchObject([{ type: "stopped_elsewhere" }]);
    expect(api.createEntry).not.toHaveBeenCalled();
    expect(api.claimForStop).not.toHaveBeenCalled();
    expect(api.confirmStop).not.toHaveBeenCalled();
  });
});
