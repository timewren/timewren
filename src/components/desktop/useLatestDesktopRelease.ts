"use client";

import { useEffect, useState } from "react";
import { getDesktopReleasesRepo } from "@/lib/release-repos";

// Public releases repo — anonymous GitHub API works because it is public.
const RELEASES_REPO = getDesktopReleasesRepo();
const LATEST_API = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;

// Cache the latest release in localStorage to avoid hammering the
// unauthenticated GitHub API (60 req/hour per IP — shared behind NAT).
const CACHE_KEY = `desktop-latest-release:${RELEASES_REPO ?? "disabled"}`;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

interface GithubAsset {
  name: string;
  browser_download_url: string;
}
interface GithubRelease {
  tag_name: string;
  assets: GithubAsset[];
}

function readCache(): GithubRelease | null {
  if (typeof localStorage === "undefined") return null;
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at: number; data: GithubRelease };
    if (Date.now() - parsed.at > CACHE_TTL) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function writeCache(data: GithubRelease) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data }));
  } catch {
    // ignore quota / private-mode errors
  }
}

function detectOS(): "windows" | "macos" | "other" {
  if (typeof navigator === "undefined") return "other";
  const nav = navigator as Navigator & {
    userAgentData?: { platform?: string };
  };
  const platform = nav.userAgentData?.platform ?? navigator.platform ?? "";
  const ua = navigator.userAgent;
  if (/win/i.test(platform) || /Windows/i.test(ua)) return "windows";
  if (/mac/i.test(platform) || /Mac OS X|Macintosh/i.test(ua)) return "macos";
  return "other";
}

export interface LatestDesktopRelease {
  /** True once the release state is known (cache hit or fetch resolved). */
  loaded: boolean;
  os: "windows" | "macos" | "other";
  version: string | undefined;
  winUrl: string | null;
  macUrl: string | null;
  hasDownloads: boolean;
}

/**
 * Fetches the latest desktop release from the public releases repo (cached in
 * localStorage). Shared by the dashboard download card + settings page.
 */
export function useLatestDesktopRelease(): LatestDesktopRelease {
  const [release, setRelease] = useState<GithubRelease | null>(null);
  const [loaded, setLoaded] = useState(!RELEASES_REPO);
  const [os, setOs] = useState<"windows" | "macos" | "other">("other");

  useEffect(() => {
    setOs(detectOS());
    if (!RELEASES_REPO) {
      return;
    }
    let active = true;

    const cached = readCache();
    if (cached) {
      setRelease(cached);
      setLoaded(true);
    }

    fetch(LATEST_API)
      .then((r) => (r.ok ? (r.json() as Promise<GithubRelease>) : null))
      .then((data) => {
        if (!active) return;
        if (data) {
          setRelease(data);
          writeCache(data);
        }
        setLoaded(true);
      })
      .catch(() => {
        if (active) setLoaded(true);
      });
    return () => {
      active = false;
    };
  }, []);

  const winUrl =
    release?.assets.find((a) => a.name.endsWith("-setup.exe"))
      ?.browser_download_url ?? null;
  const macUrl =
    release?.assets.find((a) => a.name.endsWith(".dmg"))
      ?.browser_download_url ?? null;

  return {
    loaded,
    os,
    version: release?.tag_name?.replace(/^v/, ""),
    winUrl,
    macUrl,
    hasDownloads: Boolean(winUrl || macUrl),
  };
}
