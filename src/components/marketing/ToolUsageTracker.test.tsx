// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolUsageTracker } from "./ToolUsageTracker";
import { UmamiToolAnalytics } from "./UmamiToolAnalytics";

const { plausible, consent, ready } = vi.hoisted(() => ({
  plausible: vi.fn(),
  ready: { current: undefined as (() => void) | undefined },
  consent: vi.fn(() => ({ analytics: true })),
}));

vi.mock("next/script", () => ({
  default: ({ onReady }: { onReady: () => void }) => {
    ready.current = onReady;
    return null;
  },
}));
vi.mock("next-plausible", () => ({ usePlausible: () => plausible }));
vi.mock("@/lib/consent", () => ({ readConsent: consent }));
const container = document.createElement("div");
const root = createRoot(container);
const send = vi.fn((_url: URL, _request: RequestInit) =>
  Promise.resolve({ ok: true }),
);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("fetch", send);
  window.history.replaceState(null, "", "/test-calculator");
});

afterEach(async () => {
  await act(async () => root.render(null));
  ready.current = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  consent.mockReturnValue({ analytics: true });
});

async function renderTools(children?: ReactNode, useScript = false) {
  await act(async () =>
    root.render(
      <UmamiToolAnalytics
        collectUrl={
          useScript ? undefined : "https://collector.example/api/stats"
        }
        scriptUrl={useScript ? "/stats.js" : undefined}
        websiteId="test"
      >
        {children ?? (
          <ToolUsageTracker tool="test-tool">
            <select aria-label="Hours">
              <option value="37">37</option>
              <option value="30">30</option>
            </select>
            <a href="#more">More</a>
            <button type="button">Start</button>
          </ToolUsageTracker>
        )}
      </UmamiToolAnalytics>,
    ),
  );
}

it("sends the first tool change with its original path before navigation", async () => {
  await renderTools();
  const select = container.querySelector("select");
  const link = container.querySelector("a");
  if (!select || !link) throw new Error("Missing tool controls");

  await act(async () => {
    select.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Tab", bubbles: true }),
    );
    link.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    link.click();
  });
  expect(plausible).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();

  await act(async () => {
    select.value = "30";
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => container.querySelector("button")?.click());
  expect(plausible).toHaveBeenCalledExactlyOnceWith("tool_used", {
    props: { tool: "test-tool" },
  });
  await renderTools(<p>Next page</p>);
  window.history.replaceState(null, "", "/next-page");
  expect(send).toHaveBeenCalledExactlyOnceWith(
    new URL("https://collector.example/api/stats"),
    expect.objectContaining({ method: "POST", keepalive: true }),
  );
  const body = send.mock.lastCall?.[1].body;
  if (typeof body !== "string") throw new Error("Missing Umami payload");
  expect(JSON.parse(body)).toMatchObject({
    type: "event",
    payload: {
      website: "test",
      url: "/test-calculator",
      name: "tool_used",
      data: { tool: "test-tool" },
    },
  });
});

it("tracks a fresh action after consent is withdrawn and granted again", async () => {
  await renderTools();
  await act(async () => container.querySelector("button")?.click());
  expect(send).toHaveBeenCalledOnce();

  await act(async () => {
    consent.mockReturnValue({ analytics: false });
    window.dispatchEvent(new Event("cookie-consent-updated"));
    container.querySelector("button")?.click();
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => {
    consent.mockReturnValue({ analytics: true });
    window.dispatchEvent(new Event("cookie-consent-updated"));
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => container.querySelector("button")?.click());
  expect(send).toHaveBeenCalledTimes(2);
  expect(plausible).toHaveBeenCalledOnce();
});

it("honors Do Not Track even with analytics consent", async () => {
  vi.stubGlobal("navigator", { doNotTrack: "1" });
  await renderTools();
  await act(async () => container.querySelector("button")?.click());
  expect(send).not.toHaveBeenCalled();
});

it("preserves the Umami opt-out", async () => {
  localStorage.setItem("umami.disabled", "1");
  try {
    await renderTools();
    await act(async () => container.querySelector("button")?.click());
    expect(send).not.toHaveBeenCalled();
  } finally {
    localStorage.removeItem("umami.disabled");
  }
});

it.each(["HTTP failure", "network failure"])(
  "retries a tool action after %s",
  async (failure) => {
    if (failure === "HTTP failure") send.mockResolvedValueOnce({ ok: false });
    else send.mockRejectedValueOnce(new TypeError("offline"));

    await renderTools();
    await act(async () => {
      container.querySelector("button")?.click();
      container.querySelector("button")?.click();
    });
    expect(send).toHaveBeenCalledOnce();
    await act(async () => container.querySelector("button")?.click());
    expect(send).toHaveBeenCalledTimes(2);
    await act(async () => container.querySelector("button")?.click());
    expect(send).toHaveBeenCalledTimes(2);
  },
);

it("lets the configured tracker deliver a queued event with its original path", async () => {
  await renderTools(undefined, true);
  await act(async () => container.querySelector("button")?.click());
  window.history.replaceState(null, "", "/next-page");
  const track = vi.fn((update: (defaults: object) => object) =>
    update({ url: "/next-page", website: "from-tracker" }),
  );
  vi.stubGlobal("umami", { track });
  await act(async () => ready.current?.());
  expect(track).toHaveBeenCalledOnce();
  expect(track.mock.results[0]?.value).toMatchObject({
    website: "from-tracker",
    url: "/test-calculator",
    name: "tool_used",
    data: { tool: "test-tool" },
  });
  expect(send).not.toHaveBeenCalled();
});
