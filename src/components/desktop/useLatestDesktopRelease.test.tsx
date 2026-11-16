// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

function Probe({
  useRelease,
}: {
  useRelease: typeof import("./useLatestDesktopRelease").useLatestDesktopRelease;
}) {
  const state = useRelease();
  return <span>{state.loaded ? "loaded" : "loading"}</span>;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  localStorage.clear();
});

it.each(["", "example/releases"])(
  "only queries a configured TimeWren repository (%s)",
  async (repo) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", repo);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const fetchSpy = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ tag_name: "v1.0.0", assets: [] }),
    });
    vi.stubGlobal("fetch", fetchSpy);
    const { useLatestDesktopRelease } = await import(
      "./useLatestDesktopRelease"
    );
    const element = document.createElement("div");
    const root = createRoot(element);
    try {
      await act(async () =>
        root.render(<Probe useRelease={useLatestDesktopRelease} />),
      );
      expect(element.textContent).toBe("loaded");
      if (repo) {
        expect(fetchSpy).toHaveBeenCalledWith(
          `https://api.github.com/repos/${repo}/releases/latest`,
        );
      } else {
        expect(fetchSpy).not.toHaveBeenCalled();
      }
    } finally {
      await act(async () => root.unmount());
    }
  },
);
