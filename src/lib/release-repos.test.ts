import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getChangelogRepo,
  getDesktopDownloadUrl,
  getDesktopReleasesRepo,
  getDesktopUpdaterRepo,
} from "./release-repos";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("release repositories", () => {
  it("makes no maintainer repository the default for self-hosting", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    vi.stubEnv("DESKTOP_UPDATER_REPO", "");
    vi.stubEnv("CHANGELOG_REPO", "");
    expect(getDesktopReleasesRepo()).toBeUndefined();
    vi.stubEnv("CHANGELOG_REPO", "owner/..");
    expect(getChangelogRepo()).toBeUndefined();
    expect(getDesktopUpdaterRepo()).toBeUndefined();
    expect(getChangelogRepo()).toBeUndefined();
  });

  it("retains existing Cloud repositories", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    vi.stubEnv("DESKTOP_UPDATER_REPO", "");
    vi.stubEnv("CHANGELOG_REPO", "");
    expect(getDesktopReleasesRepo()).toBe("mahope/timetrack-releases");
    expect(getDesktopUpdaterRepo()).toBe("mahope/timetrack-desktop");
    expect(getChangelogRepo()).toBe("mahope/timetrack");
  });

  it.each([
    ["timetrack", "timewren", "mahope/timetrack-releases"],
    ["timewren", "timetrack", undefined],
  ])("keeps %s build downloads when running as %s", (build, runtime, repo) => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", build);
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    vi.stubGlobal("window", { __TT_CONFIG__: { brand: runtime } });
    expect(getDesktopReleasesRepo()).toBe(repo);
  });

  it("uses explicit repositories and rejects URL/path injection", () => {
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timewren");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "example/desktop");
    vi.stubEnv("DESKTOP_UPDATER_REPO", "example/updates");
    vi.stubEnv("CHANGELOG_REPO", "example/source");
    expect(getDesktopReleasesRepo()).toBe("example/desktop");
    expect(getDesktopUpdaterRepo()).toBe("example/updates");
    expect(getChangelogRepo()).toBe("example/source");
    vi.stubEnv("CHANGELOG_REPO", "https://example.org/repo");
    expect(getChangelogRepo()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "owner/repo/../../private");
    expect(getDesktopReleasesRepo()).toBeUndefined();
  });

  it("sends each brand to its own installers, never the other brand's", () => {
    // Prod is one TimeTrack build serving both brands from the same repo,
    // and TimeWren is never the repo's "latest" release.
    vi.stubEnv("NEXT_PUBLIC_BRAND", "timetrack");
    vi.stubEnv("NEXT_PUBLIC_DESKTOP_RELEASES_REPO", "");
    expect(getDesktopDownloadUrl("timetrack")).toBe(
      "https://github.com/mahope/timetrack-releases/releases/latest",
    );
    expect(getDesktopDownloadUrl("timewren")).toBe(
      "https://github.com/mahope/timetrack-releases/releases/tag/timewren-stable",
    );
  });
});
