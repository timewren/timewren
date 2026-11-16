import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetStaleBuildForTests,
  hardNavigateIfStale,
  markStaleBuild,
  STALE_RELOAD_COOLDOWN_MS,
} from "../stale-build";
import { showUpdatePrompt } from "../update-prompt";

function fakeLocation() {
  return { assign: vi.fn() };
}

function fakeStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
  };
}

describe("hardNavigateIfStale (TIMETRACK-1S)", () => {
  beforeEach(() => __resetStaleBuildForTests());

  it("lader navigation være klient-side, så længe fanen kører den nyeste build", () => {
    const location = fakeLocation();
    expect(
      hardNavigateIfStale("/dashboard/time", "push", location, fakeStorage()),
    ).toBe(false);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("laver en fuld sideindlæsning, når fanen ved, at serveren kører en nyere build", () => {
    markStaleBuild();
    const location = fakeLocation();
    expect(
      hardNavigateIfStale("/dashboard/time", "push", location, fakeStorage()),
    ).toBe(true);
    expect(location.assign).toHaveBeenCalledWith("/dashboard/time");
  });

  it("rører ikke replace (kodens egne redirects/filtre) og tilbage/frem", () => {
    markStaleBuild();
    const location = fakeLocation();
    const storage = fakeStorage();
    expect(
      hardNavigateIfStale("/dashboard", "replace", location, storage),
    ).toBe(false);
    expect(
      hardNavigateIfStale("/dashboard", "traverse", location, storage),
    ).toBe(false);
    expect(location.assign).not.toHaveBeenCalled();
  });

  it("genindlæser højst én gang pr. fane i ventetiden, så der aldrig opstår en løkke", () => {
    markStaleBuild();
    const storage = fakeStorage();
    const location = fakeLocation();
    const t0 = 1_000_000;

    expect(hardNavigateIfStale("/a", "push", location, storage, t0)).toBe(true);
    // Ny sideindlæsning: modulet starter forfra, men fanens sessionStorage består.
    __resetStaleBuildForTests();
    markStaleBuild();
    expect(
      hardNavigateIfStale("/b", "push", location, storage, t0 + 1_000),
    ).toBe(false);
    expect(
      hardNavigateIfStale(
        "/c",
        "push",
        location,
        storage,
        t0 + STALE_RELOAD_COOLDOWN_MS,
      ),
    ).toBe(true);
    expect(location.assign).toHaveBeenCalledTimes(2);
  });
});

describe("Ny version-prompten", () => {
  beforeEach(() => __resetStaleBuildForTests());

  it("markerer fanen som forældet, så næste navigation henter den nye build", () => {
    showUpdatePrompt("new_version");
    const location = fakeLocation();
    expect(
      hardNavigateIfStale("/dashboard/time", "push", location, fakeStorage()),
    ).toBe(true);
  });
});
