// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"handleDisabledFileLoadingAsSuccess":true}}
/**
 * Flader uden for (app)-layoutets BrandProvider følger også hostens brand
 * (TimeWren på timewren.com med et TimeTrack-build): opdateringstoasten og
 * den globale fejlside, også når rod-layoutet aldrig nåede at indlæse
 * /runtime-config.js. Testmiljøets build-brand er timetrack.
 */
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const toasts = vi.hoisted(() => [] as { description?: string }[]);
vi.mock("sonner", () => ({
  toast: {
    dismiss: vi.fn(),
    warning: vi.fn((_t: string, o: { description?: string }) => toasts.push(o)),
    error: vi.fn((_t: string, o: { description?: string }) => toasts.push(o)),
  },
}));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));

beforeAll(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => {
  delete window.__TT_CONFIG__;
  for (const s of document.head.querySelectorAll("script")) s.remove();
  toasts.length = 0;
  vi.resetModules();
});

describe("showUpdatePrompt", () => {
  async function descriptions() {
    const { showUpdatePrompt } = await import("@/lib/pwa/update-prompt");
    showUpdatePrompt("new_version");
    showUpdatePrompt("too_old");
    return toasts.map((t) => t.description ?? "");
  }

  it("nævner TimeWren på en TimeWren-host i begge varianter", async () => {
    window.__TT_CONFIG__ = { hostBrand: "timewren" };
    const texts = await descriptions();
    expect(texts).toHaveLength(2);
    for (const t of texts) {
      expect(t).toContain("TimeWren");
      expect(t).not.toContain("TimeTrack");
    }
  });

  it("nævner TimeTrack på timetrack-hosts som før", async () => {
    window.__TT_CONFIG__ = {};
    const texts = await descriptions();
    expect(texts).toHaveLength(2);
    for (const t of texts) expect(t).toContain("TimeTrack");
  });
});

describe("GlobalError", () => {
  async function render() {
    const { default: GlobalError } = await import("@/app/global-error");
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => root.render(<GlobalError error={new Error("x")} />));
    return {
      heading: () => container.querySelector("h1")?.textContent ?? "",
      done: () => {
        act(() => root.unmount());
        container.remove();
      },
    };
  }

  it("indlæser selv /runtime-config.js, når layoutet aldrig kørte det", async () => {
    const page = await render();
    const script = document.head.querySelector<HTMLScriptElement>(
      'script[src="/runtime-config.js"]',
    );
    expect(script).not.toBeNull();
    // Scriptet svarer som på timewren.com.
    window.__TT_CONFIG__ = { hostBrand: "timewren" };
    await act(async () => script?.onload?.(new Event("load")));
    expect(page.heading()).toContain("TimeWren");
    expect(page.heading()).not.toContain("TimeTrack");
    page.done();
  });

  it("bruger en allerede indlæst konfiguration uden at hente igen", async () => {
    window.__TT_CONFIG__ = { hostBrand: "timewren" };
    const page = await render();
    expect(document.head.querySelector("script")).toBeNull();
    expect(page.heading()).toContain("TimeWren");
    page.done();
  });

  it("viser TimeTrack på timetrack-hosts som før", async () => {
    window.__TT_CONFIG__ = {};
    const page = await render();
    expect(page.heading()).toContain("TimeTrack");
    page.done();
  });
});
