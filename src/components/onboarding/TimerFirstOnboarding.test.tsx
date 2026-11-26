// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  failedQuery: "",
  createSubscription: vi.fn(async () => undefined),
  complete: vi.fn(async () => undefined),
  refetch: vi.fn(async (name: string) => {
    if (mocks.failedQuery === name) mocks.failedQuery = "";
  }),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/components/onboarding/OnboardingModal", () => ({
  OnboardingModal: () => null,
}));
vi.mock("@/components/subscription/TimewrenBillingPanel", () => ({
  TimewrenBillingPanel: () => null,
}));
vi.mock("@/components/ui/Modal", () => ({ Modal: () => null }));
vi.mock("@/components/ui/use-ui-text", () => ({
  useUiScope: () => (key: string) => key,
}));
vi.mock("@/hooks/useBillingEnabled", () => ({
  useBillingEnabled: () => ({ enabled: true, provider: "alunta" }),
}));
vi.mock("@/providers/trpc-provider", () => {
  const query = (name: string, data: unknown) => ({
    useQuery: () => ({
      data: mocks.failedQuery === name ? undefined : data,
      isSuccess: mocks.failedQuery !== name,
      isError: mocks.failedQuery === name,
      refetch: () => mocks.refetch(name),
    }),
  });
  const cache = () => ({ invalidate: vi.fn() });
  return {
    trpc: {
      subscription: { getDetails: query("subscription", null) },
      organization: { getMyRole: query("role", { isSolo: true }) },
      onboarding: {
        planOptions: query("plans", { privatAvailable: true }),
        createSubscription: {
          useMutation: () => ({ mutateAsync: mocks.createSubscription }),
        },
        complete: { useMutation: () => ({ mutateAsync: mocks.complete }) },
      },
      user: {
        dismissBanner: {
          useMutation: () => ({ mutateAsync: async () => undefined }),
        },
      },
      useUtils: () => ({
        subscription: { getDetails: cache() },
        onboarding: { getSubscription: cache(), getProgress: cache() },
        user: { getProfile: cache() },
      }),
    },
  };
});

import { TimerFirstOnboarding } from "./TimerFirstOnboarding";

it.each(["role", "plans", "subscription"])(
  "retries a failed %s lookup before provisioning",
  async (query) => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    mocks.failedQuery = query;
    vi.clearAllMocks();
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      const render = () =>
        act(async () => {
          root.render(
            <TimerFirstOnboarding loadingFallback={<p>loading</p>} />,
          );
        });

      await render();
      const retry = host.querySelector("button");
      expect(retry?.textContent).toBe("retry");
      expect(host.textContent).not.toContain("loading");
      expect(mocks.createSubscription).not.toHaveBeenCalled();

      await act(async () => {
        retry?.click();
      });
      expect(mocks.refetch).toHaveBeenCalledExactlyOnceWith(query);

      await render();
      expect(host.querySelector("button")).toBeNull();
      expect(mocks.createSubscription).toHaveBeenCalledOnce();
      expect(mocks.complete).toHaveBeenCalledOnce();
    } finally {
      await act(async () => root.unmount());
      vi.unstubAllGlobals();
    }
  },
);
