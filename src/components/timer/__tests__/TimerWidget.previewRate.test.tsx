// @vitest-environment happy-dom
import { NextIntlClientProvider } from "next-intl";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadMessages } from "@/i18n/messages/load";
import { useTimerStore } from "@/stores/timerStore";

type PreviewCall = {
  input: { hours: number };
  opts?: { enabled?: boolean };
};
const previewCalls: PreviewCall[] = [];

// Alle tRPC-kald svarer tomt; time.previewRate registreres, så testen kan
// se hvad klienten ville sende til serveren.
vi.mock("@/providers/trpc-provider", () => {
  const empty = { data: undefined, isLoading: false, isError: false };
  const make = (path: string[]): object =>
    new Proxy(() => {}, {
      get: (_t, prop: string) => {
        if (prop === "useQuery") {
          return (input: PreviewCall["input"], opts: PreviewCall["opts"]) => {
            if (path.join(".") === "time.previewRate") {
              previewCalls.push({ input, opts });
              return {
                ...empty,
                data: {
                  hourlyRate: 600,
                  totalValue: 600 * input.hours,
                  rateSource: null,
                  rateSourceName: null,
                },
              };
            }
            return empty;
          };
        }
        if (prop === "useMutation") return () => ({ mutate: () => {} });
        return make([...path, prop]);
      },
      apply: () => make(path),
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

const { TimerWidget } = await import("../TimerWidget");
const messages = await loadMessages("da");

const KUNDE = "00000000-0000-4000-8000-000000000001";

/** Kald som faktisk ville ramme serveren. */
const sentPreviewInputs = () =>
  previewCalls.filter((c) => c.opts?.enabled !== false).map((c) => c.input);

describe("TimerWidget — time.previewRate (#938)", () => {
  let container: HTMLElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    previewCalls.length = 0;
    useTimerStore.getState().resetTimer();
    useTimerStore.setState({
      isRunning: true,
      clientId: KUNDE,
      projectId: "",
      elapsedTime: 0,
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  const render = () =>
    act(() =>
      root.render(
        <NextIntlClientProvider locale="da" messages={messages}>
          <TimerWidget projects={[]} clients={[]} onTimeEntrySaved={() => {}} />
        </NextIntlClientProvider>,
      ),
    );

  it("sender aldrig under serverens minimum, heller ikke i de første sekunder", () => {
    render();
    for (const seconds of [1, 10, 35]) {
      act(() => useTimerStore.setState({ elapsedTime: seconds }));
    }
    const sent = sentPreviewInputs();
    expect(sent.length).toBeGreaterThan(0);
    for (const input of sent) {
      expect(input.hours).toBeGreaterThanOrEqual(0.01);
    }
  });

  it("laver ikke en ny forespørgsel for hvert sekund timeren tikker", () => {
    render();
    for (const seconds of [60, 61, 62, 3600]) {
      act(() => useTimerStore.setState({ elapsedTime: seconds }));
    }
    const distinct = new Set(sentPreviewInputs().map((i) => JSON.stringify(i)));
    expect(distinct.size).toBe(1);
  });

  it("viser værdien for den løbende tid", () => {
    render();
    act(() => useTimerStore.setState({ elapsedTime: 1800 }));
    // 0,5 t × 600 kr/t
    expect(container.textContent).toContain("300 kr");
  });
});
