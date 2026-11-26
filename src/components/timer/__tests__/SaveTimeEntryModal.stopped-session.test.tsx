// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";

/**
 * Gem-dialogen for en stoppet session A, mens serverens række er afløst af
 * B (#1333). B's eksplicitte klippekortvalg må ikke forvælges for A, selv
 * når de har samme kunde.
 */
const KUNDE = "00000000-0000-4000-8000-000000000001";
const KORT_B = "00000000-0000-4000-8000-0000000000b0";
const SESSION_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const SESSION_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const server = vi.hoisted(() => ({
  timerState: null as Record<string, unknown> | null,
}));

vi.mock("@/providers/trpc-provider", () => {
  const data: Record<string, () => unknown> = {
    "prepaid.getActiveForClient": () => [
      {
        id: "00000000-0000-4000-8000-0000000000b0",
        name: "Kort",
        remainingHours: 10,
        totalHours: 10,
        autoDeduct: false,
        isActive: true,
        overdraftPolicy: "block",
      },
    ],
    "timerSync.getState": () => server.timerState,
  };
  const node = (path: string[]): object =>
    new Proxy(() => {}, {
      get: (_t, prop: string) => {
        if (prop === "useQuery") {
          return () => ({
            data: data[path.join(".")]?.() ?? undefined,
            isLoading: false,
            isError: false,
          });
        }
        return node([...path, prop]);
      },
    });
  return { trpc: node([]) };
});

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
vi.mock("@/components/ui/ClientSearchCombobox", () => ({
  ClientSearchCombobox: () => null,
}));

const { SaveTimeEntryModal } = await import("../SaveTimeEntryModal");
const messages = await loadMessages("da");

describe("SaveTimeEntryModal: klippekortvalg for den stoppede session (#1333)", () => {
  let container: HTMLElement;
  let root: Root;
  const onSave = vi.fn(async (_options: unknown) => {});

  const renderAndSave = (timerSessionId: string | null) => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="da" messages={messages}>
          {createElement(SaveTimeEntryModal, {
            isOpen: true,
            onClose: () => {},
            onSave,
            hours: 0.5,
            description: "A",
            projectId: null,
            clientId: KUNDE,
            isSaving: false,
            timerSessionId,
          })}
        </NextIntlClientProvider>,
      ),
    );
    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="save-entry-done"]',
    );
    expect(button).not.toBeNull();
    act(() => button?.click());
  };

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    onSave.mockClear();
    server.timerState = {
      isRunning: true,
      version: 7,
      sessionId: SESSION_B,
      prepaidChoice: { mode: "package", packageId: KORT_B, clientId: KUNDE },
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("forvælger ikke B's kort, når rækken bærer en anden session end A", () => {
    renderAndSave(SESSION_A);
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({ usePrepaid: false });
  });

  it("forvælger rækkens kort, når rækken stadig er den stoppede session", () => {
    server.timerState = { ...server.timerState, sessionId: SESSION_A };
    renderAndSave(SESSION_A);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      usePrepaid: true,
      prepaidPackageId: KORT_B,
    });
  });
});
