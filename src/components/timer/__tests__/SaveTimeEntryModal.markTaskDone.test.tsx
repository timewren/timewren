// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";

// Den tilknyttede opgave findes og er ikke færdig. Alle andre forespørgsler
// svarer tomt.
const linkedTask = { id: "opgave-1", title: "Testopgave", status: "todo" };
vi.mock("@/providers/trpc-provider", () => {
  const empty = () => ({ data: undefined, isLoading: false, isError: false });
  const make = (path: string[]): object =>
    new Proxy(() => {}, {
      get: (_t, prop: string) => {
        if (prop === "useQuery") {
          return path.join(".") === "tasks.getForTime"
            ? () => ({ data: linkedTask, isLoading: false, isError: false })
            : empty;
        }
        return make([...path, prop]);
      },
    });
  return { trpc: make([]) };
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

// Rollens adgang til opgavemodulet styres pr. test.
const perm = { canWrite: true };
vi.mock("@/hooks/usePermission", () => ({
  usePermission: (moduleKey: string) =>
    moduleKey === "tasks"
      ? {
          canRead: perm.canWrite,
          canWrite: perm.canWrite,
          accessLevel: perm.canWrite ? "write" : "none",
          isLoading: false,
        }
      : {
          canRead: true,
          canWrite: true,
          accessLevel: "write",
          isLoading: false,
        },
}));

const { SaveTimeEntryModal } = await import("../SaveTimeEntryModal");
const messages = await loadMessages("da");

describe("SaveTimeEntryModal — markér opgaven som færdig (#1116)", () => {
  let container: HTMLElement;
  let root: Root;
  let saved: Array<{ markTaskDone?: boolean }>;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    saved = [];
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  async function renderAndSave() {
    act(() =>
      root.render(
        <NextIntlClientProvider locale="da" messages={messages}>
          {createElement(SaveTimeEntryModal, {
            isOpen: true,
            onClose: () => {},
            onSave: async (o) => {
              saved.push(o);
            },
            hours: 0.5,
            description: "",
            projectId: "projekt-1",
            clientId: "kunde-1",
            taskId: "opgave-1",
            isSaving: false,
          })}
        </NextIntlClientProvider>,
      ),
    );
    const checkbox = container.querySelector('input[type="checkbox"]');
    const done = container.querySelector<HTMLButtonElement>(
      '[data-testid="save-entry-done"]',
    );
    await act(async () => done?.click());
    return {
      hasCheckbox: !!checkbox && container.textContent?.includes("Testopgave"),
    };
  }

  it("tilbyder og sender markTaskDone, når rollen må skrive opgaver", async () => {
    perm.canWrite = true;
    const { hasCheckbox } = await renderAndSave();
    expect(hasCheckbox).toBe(true);
    expect(saved).toHaveLength(1);
    expect(saved[0].markTaskDone).toBe(true);
  });

  it("skjuler afkrydsningen og sender ikke markTaskDone uden skriveadgang til opgaver", async () => {
    perm.canWrite = false;
    const { hasCheckbox } = await renderAndSave();
    expect(hasCheckbox).toBe(false);
    expect(saved).toHaveLength(1);
    expect(saved[0].markTaskDone).toBeUndefined();
  });
});
