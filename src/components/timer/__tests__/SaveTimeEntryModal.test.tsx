// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";
import { useTimerStore } from "@/stores/timerStore";

// Alle tRPC-forespørgsler svarer tomt: dialogen skal kunne leve uden
// serverdata (som i #937, hvor Electric-shapes gav 503).
vi.mock("@/providers/trpc-provider", () => {
  const query = () => ({
    data: undefined,
    isLoading: false,
    isError: false,
  });
  const node: object = new Proxy(() => {}, {
    get: (_t, prop) => (prop === "useQuery" ? query : node),
  });
  return { trpc: node };
});

vi.mock("@/hooks/useModules", () => ({
  useModules: () => ({ isEnabled: () => true, isPlaceholder: false }),
}));

// Kunden har ét aktivt projekt, så dialogen auto-vælger det.
const selection = {
  autoSelectedProjectId: "projekt-1",
  projects: [
    { id: "projekt-1", name: "P", clientId: "kunde-1", description: null },
  ],
  isLoading: false,
};
vi.mock("@/hooks/useClientProjectSelection", () => ({
  useClientProjectSelection: (clientId: string | null) =>
    clientId
      ? selection
      : { autoSelectedProjectId: null, projects: [], isLoading: false },
}));

vi.mock("@/components/ui/ClientSearchCombobox", () => ({
  ClientSearchCombobox: ({ onChange }: { onChange: (id: string) => void }) =>
    createElement(
      "button",
      {
        type: "button",
        "data-testid": "vaelg-kunde",
        onClick: () => onChange("kunde-1"),
      },
      "Vælg kunde",
    ),
}));

const { SaveTimeEntryModal } = await import("../SaveTimeEntryModal");
const messages = await loadMessages("da");

let projectChangeCalls = 0;

// Samme kobling som TimeTrackingBar: hele storen læses uden selector, og
// onProjectChange er en ny inline-funktion ved hver render.
function Harness() {
  const { projectId, clientId, updateProject } = useTimerStore();
  return createElement(SaveTimeEntryModal, {
    isOpen: true,
    onClose: () => {},
    onSave: async () => {},
    hours: 0.5,
    description: "",
    projectId,
    clientId,
    isSaving: false,
    onProjectChange: (p: string, c: string) => {
      projectChangeCalls++;
      updateProject(p, c);
    },
  });
}

describe("SaveTimeEntryModal — kundevalg i dialogen (#937)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    useTimerStore.getState().resetTimer();
    projectChangeCalls = 0;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it("vælger kunde uden uendelig render-løkke og sætter kunde + projekt én gang", () => {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="da" messages={messages}>
          <Harness />
        </NextIntlClientProvider>,
      ),
    );

    const button = container.querySelector<HTMLButtonElement>(
      '[data-testid="vaelg-kunde"]',
    );
    expect(button).not.toBeNull();

    expect(() => act(() => button?.click())).not.toThrow();

    const state = useTimerStore.getState();
    expect(state.clientId).toBe("kunde-1");
    expect(state.projectId).toBe("projekt-1");
    expect(projectChangeCalls).toBe(1);
  });
});
