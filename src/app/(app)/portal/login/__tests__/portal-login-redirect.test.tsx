// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Portal-login sender kunden videre til `returnTo` efter login. Værdien
 * kommer fra URL'en, så kun interne stier må følges (åben redirect).
 */

const mocks = vi.hoisted(() => ({
  push: vi.fn(),
  search: new URLSearchParams(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mocks.push }),
  useSearchParams: () => mocks.search,
}));
vi.mock("next/image", () => ({ default: () => null }));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/components/LeveretAfTimeTrack", () => ({
  LeveretAfTimeTrack: () => null,
}));
vi.mock("@/hooks/useCustomDomain", () => ({
  useCustomDomain: () => ({
    isCustomDomain: false,
    branding: null,
    brandingLoading: false,
    freelancerUserId: null,
  }),
  getPortalPath: (path: string) => path,
}));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    publicPortal: {
      login: {
        useMutation: (opts: {
          onSuccess: (data: { sessionToken: string }) => void;
        }) => ({
          isPending: false,
          mutateAsync: async () => opts.onSuccess({ sessionToken: "token" }),
        }),
      },
    },
  },
}));

import PortalLoginPage from "../page";

afterEach(() => {
  document.body.innerHTML = "";
  mocks.push.mockReset();
});

function setInput(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

async function loginWith(returnTo: string) {
  mocks.search = new URLSearchParams({ returnTo });
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(<PortalLoginPage />));

  const [email, password] = Array.from(
    container.querySelectorAll<HTMLInputElement>("input"),
  );
  await act(async () => {
    setInput(email, "anna@example.com");
    setInput(password, "x".repeat(12));
  });
  await act(async () => {
    container
      .querySelector("form")
      ?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await act(async () => root.unmount());
  return mocks.push.mock.calls.at(-1)?.[0];
}

describe("portal-login returnTo", () => {
  it("følger en intern sti", async () => {
    expect(await loginWith("/portal/invoices")).toBe("/portal/invoices");
  });

  it.each(["https://evil.example", "//evil.example", "/\\evil.example"])(
    "følger ikke %j",
    async (returnTo) => {
      expect(await loginWith(returnTo)).toBe("/portal/dashboard");
    },
  );
});
