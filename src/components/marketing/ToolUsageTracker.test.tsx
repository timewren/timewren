// @vitest-environment happy-dom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ToolUsageTracker } from "./ToolUsageTracker";
import { UmamiToolAnalytics } from "./UmamiToolAnalytics";

type ScriptProps = Record<string, unknown> & { onReady: () => void };

const { plausible, consent, ready, script } = vi.hoisted(() => ({
  plausible: vi.fn(),
  ready: { current: undefined as (() => void) | undefined },
  script: { current: undefined as ScriptProps | undefined },
  consent: vi.fn(() => ({ analytics: true })),
}));

vi.mock("next/script", () => ({
  default: (props: ScriptProps) => {
    ready.current = props.onReady;
    script.current = props;
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
  script.current = undefined;
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  consent.mockReturnValue({ analytics: true });
});

async function renderTools(
  children?: ReactNode,
  useScript: boolean | string = false,
) {
  const scriptUrl = useScript === true ? "/stats.js" : useScript || undefined;
  await act(async () =>
    root.render(
      <UmamiToolAnalytics
        collectUrl={
          scriptUrl ? undefined : "https://collector.example/api/stats"
        }
        scriptUrl={scriptUrl}
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

/**
 * Behaves like the Umami tracker: it sends to `data-host-url`, else the host
 * built into the tracker (gateway.umami.is for Umami Cloud), else the script's
 * own directory, plus its built-in endpoint. It swallows every failure, so
 * `track()` resolves the same way whether the event arrived or not.
 */
function loadTracker(
  built: { host?: string; endpoint?: string; url?: string } = {},
) {
  const src = String(script.current?.src);
  const hostUrl = script.current?.["data-host-url"];
  const scriptDir = new URL(".", new URL(src, window.location.href)).href;
  const host =
    typeof hostUrl === "string" ? hostUrl : (built.host ?? scriptDir);
  const endpoint = `${host.replace(/\/$/, "")}${built.endpoint ?? "/api/send"}`;
  vi.stubGlobal("umami", {
    track: async (update: (defaults: object) => object) => {
      const payload = update({ website: "test" });
      if (built.url) Object.assign(payload, { url: built.url });
      try {
        const response = await fetch(endpoint, {
          method: "POST",
          body: JSON.stringify({ type: "event", payload }),
        });
        await (response as Response).json();
      } catch {}
    },
  });
}

const cloud = { host: "https://gateway.umami.is" };

async function trackOnce(scriptUrl: string, built: object) {
  await renderTools(undefined, scriptUrl);
  loadTracker(built);
  await act(async () => ready.current?.());
  await act(async () => container.querySelector("button")?.click());
}

it("sends through a same-origin Cloud script proxy to its own /api/send", async () => {
  await trackOnce("/stats.js", cloud);
  expect(script.current?.["data-host-url"]).toBeUndefined();
  expect(send).toHaveBeenCalledExactlyOnceWith(
    `${window.location.origin}/api/send`,
    expect.anything(),
  );
});

// ORIGIN stands for the page's own origin, which is only known inside a test.
it.each([
  ["Umami Cloud", "https://cloud.umami.is/script.js", cloud],
  ["a self-hosted tracker", "https://umami.example/script.js", {}],
  [
    "a self-hosted tracker with COLLECT_API_ENDPOINT",
    "https://umami.example/script.js",
    { endpoint: "/api/custom" },
  ],
  [
    "a proxied self-hosted tracker with a built-in collector",
    "/stats.js",
    { host: "ORIGIN/metrics", endpoint: "/api/custom" },
  ],
])("leaves the collector of %s alone", async (_, url, built) => {
  const tracker: { host?: string; endpoint?: string } = { ...built };
  tracker.host = tracker.host?.replace("ORIGIN", window.location.origin);
  await trackOnce(url, tracker);
  expect(script.current?.src).toBe(url);
  expect(script.current?.["data-host-url"]).toBeUndefined();
  const host = tracker.host ?? new URL(url, window.location.href).origin;
  expect(send).toHaveBeenCalledExactlyOnceWith(
    `${host}${tracker.endpoint ?? "/api/send"}`,
    expect.anything(),
  );
});

it.each([
  ["HTTP 503", {}],
  ["network failure", {}],
  ["HTTP 503 with a rewritten page URL", { url: "/calculator" }],
])("retries a tool action after a tracker %s", async (failure, built) => {
  if (failure.startsWith("HTTP 503")) {
    send.mockResolvedValueOnce({ ok: false, status: 503 } as never);
  } else send.mockRejectedValueOnce(new TypeError("offline"));

  await renderTools(undefined, true);
  loadTracker({ ...cloud, ...built });
  await act(async () => ready.current?.());
  await act(async () => {
    container.querySelector("button")?.click();
    container.querySelector("button")?.click();
  });
  expect(send).toHaveBeenCalledOnce();
  await act(async () => container.querySelector("button")?.click());
  expect(send).toHaveBeenCalledTimes(2);
  await act(async () => container.querySelector("button")?.click());
  expect(send).toHaveBeenCalledTimes(2);
});

it("loads no tracker without statistics consent", async () => {
  consent.mockReturnValue({ analytics: false });
  await renderTools(undefined, true);
  await act(async () => container.querySelector("button")?.click());
  expect(script.current).toBeUndefined();
  expect(send).not.toHaveBeenCalled();
});
