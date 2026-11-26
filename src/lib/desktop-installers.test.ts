import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDesktopInstallers,
  installersFromManifest,
} from "./desktop-installers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const BASE = "https://github.com/mahope/timetrack-releases/releases/download";

// Shape of the real latest.json files (0.2.30, 21/11-2026).
function manifest(tag: string, product: string, version = "0.2.30") {
  return {
    version,
    platforms: {
      "windows-x86_64": {
        url: `${BASE}/${tag}/${product}_${version}_x64-setup.exe`,
      },
      "darwin-aarch64": {
        url: `${BASE}/${tag}/darwin-aarch64-${product}.app.tar.gz`,
      },
      "darwin-x86_64": {
        url: `${BASE}/${tag}/darwin-x86_64-${product}.app.tar.gz`,
      },
    },
  };
}

describe("installersFromManifest", () => {
  it.each([
    ["v0.2.30", "TimeTrack"],
    ["timewren-v0.2.30", "TimeWren"],
  ])("%s: setup.exe and both .dmg files", (tag, product) => {
    expect(installersFromManifest(manifest(tag, product))).toEqual({
      version: "0.2.30",
      windows: `${BASE}/${tag}/${product}_0.2.30_x64-setup.exe`,
      macArm: `${BASE}/${tag}/${product}_0.2.30_aarch64.dmg`,
      macIntel: `${BASE}/${tag}/${product}_0.2.30_x64.dmg`,
    });
  });

  it("derives the .dmg files from the macOS archive when Windows is missing", () => {
    const m = manifest("timewren-v0.2.30", "TimeWren");
    delete (m.platforms as Record<string, unknown>)["windows-x86_64"];
    expect(installersFromManifest(m)).toEqual({
      version: "0.2.30",
      windows: undefined,
      macArm: `${BASE}/timewren-v0.2.30/TimeWren_0.2.30_aarch64.dmg`,
      macIntel: `${BASE}/timewren-v0.2.30/TimeWren_0.2.30_x64.dmg`,
    });
  });

  it("accepts only github.com release downloads and sane versions", () => {
    expect(installersFromManifest(null)).toEqual({});
    expect(installersFromManifest({ version: "../../x" })).toEqual({});
    expect(
      installersFromManifest({
        version: "0.2.30",
        platforms: {
          "windows-x86_64": {
            url: "https://evil.example/x_0.2.30_x64-setup.exe",
          },
        },
      }),
    ).toEqual({ version: "0.2.30" });
  });
});

describe("getDesktopInstallers", () => {
  it("reads TimeWren's own manifest, never the repo's latest (TimeTrack)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    const fetchMock = vi.fn(async () =>
      Response.json(manifest("timewren-v0.2.30", "TimeWren")),
    );
    vi.stubGlobal("fetch", fetchMock);
    const tw = await getDesktopInstallers("timewren");
    expect(fetchMock).toHaveBeenCalledWith(
      `${BASE}/timewren-stable/latest.json`,
      expect.anything(),
    );
    expect(tw.windows).toContain("/timewren-v0.2.30/TimeWren_");
    expect(tw.releasePage).toBe(
      "https://github.com/mahope/timetrack-releases/releases/tag/timewren-stable",
    );

    fetchMock.mockImplementation(async () =>
      Response.json(manifest("v0.2.30", "TimeTrack")),
    );
    const tt = await getDesktopInstallers("timetrack");
    expect(fetchMock).toHaveBeenLastCalledWith(
      "https://github.com/mahope/timetrack-releases/releases/latest/download/latest.json",
      expect.anything(),
    );
    expect(tt.macArm).toContain("/v0.2.30/TimeTrack_0.2.30_aarch64.dmg");
  });

  it("falls back to the release page when GitHub fails", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("", { status: 503 })),
    );
    expect(await getDesktopInstallers("timetrack")).toEqual({
      releasePage:
        "https://github.com/mahope/timetrack-releases/releases/latest",
    });
  });

  it("gives up on a hanging GitHub and falls back to the release page", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    // The timeout fires at once, so the test needn't wait three seconds.
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockImplementation(() => AbortSignal.abort());
    // A fetch that never answers on its own, only on abort.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(signal.reason);
            signal?.addEventListener("abort", () => reject(signal.reason));
          }),
      ),
    );
    expect(await getDesktopInstallers("timetrack")).toEqual({
      releasePage:
        "https://github.com/mahope/timetrack-releases/releases/latest",
    });
    expect(timeout).toHaveBeenCalledWith(3000);
    timeout.mockRestore();
  });

  it("fetches nothing without a releases repo (self-hosting)", async () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await getDesktopInstallers("timewren")).toEqual({
      releasePage: undefined,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
