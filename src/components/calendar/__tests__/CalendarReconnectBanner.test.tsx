// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * Afviser Google fornyelsen (`invalid_grant`, fx når en gentilkobling lige
 * efter en frakobling rammes af Googles forsinkede tilbagekald), slår
 * getAuthenticatedClient sync fra med en "reconnect"-fejl. Banneret skal så
 * bede om at forbinde igen, ikke tilbyde "prøv igen".
 */

const mocks = vi.hoisted(() => ({
  status: null as null | { connected: boolean; error: string | null },
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: unknown; href: string }) => (
    <a href={href}>{children as never}</a>
  ),
}));
vi.mock("next-intl", () => ({ useTranslations: () => (key: string) => key }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/providers/trpc-provider", () => ({
  trpc: {
    calendar: {
      getConnectionStatus: { useQuery: () => ({ data: mocks.status }) },
      icloudStatus: { useQuery: () => ({ data: null }) },
      sync: {
        useMutation: () => ({ isPending: false, mutate: vi.fn() }),
      },
    },
  },
}));

import { CalendarReconnectBanner } from "../CalendarReconnectBanner";

afterEach(() => {
  document.body.innerHTML = "";
});

async function render() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  await act(async () =>
    createRoot(container).render(<CalendarReconnectBanner />),
  );
  return container;
}

describe("CalendarReconnectBanner", () => {
  it("beder om at forbinde igen, når fornyelsen er afvist", async () => {
    mocks.status = {
      connected: true,
      error: "Failed to refresh token. Please reconnect your calendar.",
    };
    const container = await render();
    expect(container.textContent).toContain("reconnect.disconnected");
    const link = container.querySelector(
      'a[href="/dashboard/settings/integrations"]',
    );
    expect(link?.textContent).toBe("reconnect.reconnect");
    expect(container.textContent).not.toContain("reconnect.retry");
  });

  it("tilbyder 'prøv igen' ved en midlertidig synkfejl", async () => {
    mocks.status = { connected: true, error: "Rate limit exceeded" };
    const container = await render();
    expect(container.textContent).toContain("reconnect.retry");
  });
});
