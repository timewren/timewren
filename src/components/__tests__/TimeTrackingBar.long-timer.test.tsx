// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createServerConfirmation,
  type ServerConfirmation,
} from "@/lib/timer/server-confirmation";
import { useTimerStore } from "@/stores/timerStore";

/**
 * Den rigtige TimeTrackingBar koblet til en rigtig serverbekræftelse
 * (#1324). useTimerSync er erstattet af en stub, der kun leverer
 * bekræftelsen og stopvejens kald; testen driver bekræftelsen, som
 * afstemningen gør det.
 */
const h = vi.hoisted(() => ({
  sync: null as null | Record<string, unknown>,
  toast: {
    warning: vi.fn(),
    dismiss: vi.fn(),
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

vi.mock("sonner", () => ({ toast: h.toast }));
vi.mock("@/hooks/useTimerSync", () => ({ useTimerSync: () => h.sync }));
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
    SaveTimeEntryModal: none,
  };
});
vi.mock("@/providers/trpc-provider", () => {
  const hooks: Record<string, unknown> = {
    useQuery: () => ({ data: undefined, isLoading: false }),
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

const { TimeTrackingBar } = await import("../TimeTrackingBar");

const HOUR = 3600;

describe("TimeTrackingBar: påmindelse om lang timer (#1324)", () => {
  let container: HTMLElement;
  let root: Root;
  let confirmation: ServerConfirmation;
  let claimTimerForStop: ReturnType<typeof vi.fn>;

  /** Som afstemningen i useTimerSync: serverens svar er anvendt på fanen. */
  const serverAnswers = (sessionId: string, serverElapsedSeconds: number) => {
    act(() => {
      const read = confirmation.beginRead();
      confirmation.complete(read, {
        server: { isRunning: true, intent: null, sessionId },
        serverElapsedSeconds,
        local: useTimerStore.getState(),
        at: Date.now(),
      });
    });
  };
  const runLocal = (sessionId: string, elapsedSeconds: number) => {
    const start = Date.now() - elapsedSeconds * 1000;
    act(() =>
      useTimerStore.setState({
        isRunning: true,
        sessionId,
        startTime: start,
        sessionStartTime: start,
        baseTime: 0,
        elapsedTime: elapsedSeconds,
      }),
    );
  };
  const reminderTitles = () =>
    h.toast.warning.mock.calls.map((c) => String(c[0]));

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear();
    for (const fn of Object.values(h.toast)) fn.mockReset();
    useTimerStore.getState().resetTimer();
    confirmation = createServerConfirmation();
    claimTimerForStop = vi.fn(async () => true);
    h.sync = {
      serverConfirmation: confirmation,
      claimTimerForStop,
      checkAndRecoverFromServer: vi.fn(),
      syncToServer: vi.fn(),
      cancelStopOnUnload: vi.fn(),
      clearServerState: vi.fn(async () => {}),
      confirmStop: vi.fn(async () => {}),
      cancelStop: vi.fn(async () => "cancelled"),
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    useTimerStore.getState().resetTimer();
  });

  it("minder ikke om en forældet lokal timer, når serveren kører en frisk", () => {
    // Fanen fra i går: localStorage siger, at "old" har kørt i 22 timer.
    runLocal("old", 22 * HOUR);
    act(() => root.render(createElement(TimeTrackingBar)));
    expect(h.toast.warning).not.toHaveBeenCalled();

    // Afstemningen adopterer timeren fra udvidelsen (3 min.) og bekræfter den.
    runLocal("new", 180);
    serverAnswers("new", 180);
    expect(h.toast.warning).not.toHaveBeenCalled();
  });

  it("regner påmindelsen fra serverens starttid, ikke fanens", () => {
    runLocal("s1", 22 * HOUR);
    act(() => root.render(createElement(TimeTrackingBar)));
    serverAnswers("s1", 11 * HOUR);
    expect(reminderTitles()).toEqual(['bar.longTimer.title:{"hours":11}']);
  });

  it("stop-knappen går den almindelige stopvej, kun mens bekræftelsen gælder", async () => {
    runLocal("s1", 11 * HOUR);
    act(() => root.render(createElement(TimeTrackingBar)));
    serverAnswers("s1", 11 * HOUR);
    const [, options] = h.toast.warning.mock.calls[0];
    const key = options.id;

    // Fokus: bekræftelsen er glemt, påmindelsen skjules, og stop gør intet.
    act(() => confirmation.invalidate());
    expect(h.toast.dismiss).toHaveBeenCalledWith(key);
    await act(async () => options.action.onClick());
    expect(claimTimerForStop).not.toHaveBeenCalled();

    // Sonner melder den programmatiske skjulning som lukket; den tæller ikke.
    act(() => options.onDismiss());
    serverAnswers("s1", 11 * HOUR);
    expect(h.toast.warning).toHaveBeenCalledTimes(2);
    const [, again] = h.toast.warning.mock.calls[1];
    // Nyt toast-id: Sonner fjerner ellers også den nye visning, mens den
    // gamle stadig er under lukning.
    expect(again.id).not.toBe(key);
    await act(async () => again.action.onClick());
    expect(claimTimerForStop).toHaveBeenCalledTimes(1);
    expect(useTimerStore.getState().isRunning).toBe(false);
  });
});
