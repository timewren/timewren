// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Onboardingens plantrin afsluttes via afterCheckoutCreated: kun når Stripe
 * har oprettet et checkout, så en fejlet oprettelse ikke markerer
 * onboardingen som gennemført.
 */

const mocks = vi.hoisted(() => ({
  checkout: vi.fn(async (_input: unknown) => ({
    url: "https://checkout.stripe.com/c/1",
  })),
}));

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    timewrenBilling: {
      overview: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          isFetching: false,
          refetch: vi.fn(),
          data: {
            enabled: true,
            trialDays: 14,
            trialEligible: true,
            seatsInUse: 1,
            plans: [
              {
                tier: "solo",
                priceEur: 11,
                perUser: false,
                minUsers: 1,
                maxUsers: 1,
                maxActiveClients: null,
              },
            ],
            current: {
              tier: "free",
              status: "free",
              isFree: true,
              seatCount: 1,
              cancelAtPeriodEnd: false,
              currentPeriodEnd: null,
              trialEndsAt: null,
              hasLiveSubscription: false,
              canOpenPortal: false,
            },
          },
        }),
      },
      checkout: { useMutation: () => ({ mutateAsync: mocks.checkout }) },
      portal: { useMutation: () => ({ mutateAsync: vi.fn() }) },
    },
  },
}));

import { TimewrenBillingPanel } from "../TimewrenBillingPanel";

afterEach(() => {
  document.body.innerHTML = "";
  mocks.checkout.mockClear();
});

async function clickCheckout(after: () => Promise<unknown>) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      <TimewrenBillingPanel
        afterCheckoutCreated={after}
        onContinueFree={() => {}}
      />,
    );
  });
  const button = [...host.querySelectorAll("button")].find((b) =>
    b.querySelector("svg"),
  );
  expect(button).toBeDefined();
  await act(async () => {
    button?.click();
  });
  return root;
}

describe("TimewrenBillingPanel: checkout fra onboardingen", () => {
  it("afterCheckoutCreated kaldes efter et oprettet checkout", async () => {
    const after = vi.fn(async () => undefined);
    const root = await clickCheckout(after);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    expect(after).toHaveBeenCalledTimes(1);
    expect(mocks.checkout.mock.invocationCallOrder[0]).toBeLessThan(
      after.mock.invocationCallOrder[0],
    );
    act(() => root.unmount());
  });

  it("fejler checkout, kaldes afterCheckoutCreated ikke", async () => {
    mocks.checkout.mockRejectedValueOnce(new Error("Stripe nede"));
    const after = vi.fn(async () => undefined);
    const root = await clickCheckout(after);
    expect(mocks.checkout).toHaveBeenCalledTimes(1);
    expect(after).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
