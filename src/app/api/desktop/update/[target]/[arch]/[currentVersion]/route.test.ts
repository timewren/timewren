import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("returns no update without querying a maintainer repo on TimeWren", async () => {
  vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
  vi.stubEnv("DESKTOP_UPDATER_REPO", "");
  const fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  const { GET } = await import("./route");
  const response = await GET(new Request("http://localhost:3000"), {
    params: Promise.resolve({
      target: "windows",
      arch: "x86_64",
      currentVersion: "0.0.1",
    }),
  });
  expect(response.status).toBe(204);
  expect(fetchSpy).not.toHaveBeenCalled();
});
