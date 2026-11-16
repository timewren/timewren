import { NextResponse } from "next/server";
import { getDesktopUpdaterRepo } from "@/lib/release-repos";

/**
 * Desktop Auto-Updater Endpoint
 *
 * Serves Tauri auto-updater JSON by proxying GitHub Releases.
 * GET /api/desktop/update/{target}/{arch}/{current_version}
 *
 * Returns 204 No Content if already on the latest version.
 * Returns 200 with Tauri updater JSON if an update is available.
 *
 * @see https://v2.tauri.app/plugin/updater/
 */

const GITHUB_REPO = getDesktopUpdaterRepo();
const GITHUB_API = `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`;

// Cache the GitHub response for 5 minutes to avoid rate limiting
let cachedRelease: { data: GitHubRelease; fetchedAt: number } | null = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

interface GitHubAsset {
  name: string;
  browser_download_url: string;
}

interface GitHubRelease {
  tag_name: string;
  body: string | null;
  published_at: string;
  assets: GitHubAsset[];
}

/**
 * Map Tauri target+arch to the expected asset filename patterns.
 * Tauri v2 updater sends target as platform identifier.
 */
function getAssetPatterns(
  target: string,
  arch: string,
): { installer: RegExp; signature: RegExp } | null {
  // Normalize combined target formats like "windows-x86_64"
  const combined = `${target}-${arch}`.toLowerCase();

  // Windows NSIS installer
  if (
    combined.includes("windows") ||
    target === "windows-x86_64" ||
    target === "windows-aarch64"
  ) {
    if (arch === "x86_64" || combined.includes("x86_64")) {
      return {
        installer: /\.nsis\.zip$/i,
        signature: /\.nsis\.zip\.sig$/i,
      };
    }
    if (arch === "aarch64" || combined.includes("aarch64")) {
      return {
        installer: /aarch64.*\.nsis\.zip$/i,
        signature: /aarch64.*\.nsis\.zip\.sig$/i,
      };
    }
  }

  // macOS
  if (
    combined.includes("darwin") ||
    combined.includes("macos") ||
    target === "darwin-aarch64" ||
    target === "darwin-x86_64"
  ) {
    if (arch === "aarch64" || combined.includes("aarch64")) {
      return {
        installer: /aarch64\.app\.tar\.gz$/i,
        signature: /aarch64\.app\.tar\.gz\.sig$/i,
      };
    }
    if (arch === "x86_64" || combined.includes("x86_64")) {
      return {
        installer: /x64\.app\.tar\.gz$/i,
        signature: /x64\.app\.tar\.gz\.sig$/i,
      };
    }
    // Universal binary fallback
    return {
      installer: /\.app\.tar\.gz$/i,
      signature: /\.app\.tar\.gz\.sig$/i,
    };
  }

  // Linux AppImage
  if (combined.includes("linux")) {
    return {
      installer: /\.AppImage\.tar\.gz$/i,
      signature: /\.AppImage\.tar\.gz\.sig$/i,
    };
  }

  return null;
}

/**
 * Compare semver strings. Returns true if latest > current.
 */
function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) =>
    v
      .replace(/^v/, "")
      .split(".")
      .map((n) => Number.parseInt(n, 10) || 0);
  const [lMajor, lMinor, lPatch] = parse(latest);
  const [cMajor, cMinor, cPatch] = parse(current);

  if (lMajor !== cMajor) return lMajor > cMajor;
  if (lMinor !== cMinor) return lMinor > cMinor;
  return lPatch > cPatch;
}

async function fetchLatestRelease(): Promise<GitHubRelease | null> {
  if (!GITHUB_REPO) return null;
  // Return cached if still valid
  if (cachedRelease && Date.now() - cachedRelease.fetchedAt < CACHE_TTL_MS) {
    return cachedRelease.data;
  }

  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "TimeTrack-Desktop-Updater",
  };

  // Use GitHub token if available (higher rate limit)
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }

  const response = await fetch(GITHUB_API, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    console.error(
      `[Desktop Update] GitHub API error: ${response.status} ${response.statusText}`,
    );
    return null;
  }

  const data = (await response.json()) as GitHubRelease;
  cachedRelease = { data, fetchedAt: Date.now() };
  return data;
}

async function fetchSignature(url: string): Promise<string | null> {
  try {
    const headers: Record<string, string> = {
      "User-Agent": "TimeTrack-Desktop-Updater",
    };
    if (process.env.GITHUB_TOKEN) {
      headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
    }

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return (await response.text()).trim();
  } catch {
    return null;
  }
}

export async function GET(
  _request: Request,
  {
    params,
  }: {
    params: Promise<{ target: string; arch: string; currentVersion: string }>;
  },
) {
  const { target, arch, currentVersion } = await params;

  try {
    const release = await fetchLatestRelease();

    if (!release) {
      // If we can't reach GitHub, tell the client there's no update
      // rather than erroring — the app should continue working
      return new NextResponse(null, { status: 204 });
    }

    const latestVersion = release.tag_name.replace(/^v/, "");

    // No update needed
    if (!isNewerVersion(latestVersion, currentVersion)) {
      return new NextResponse(null, { status: 204 });
    }

    // Find the matching asset for this target/arch
    const patterns = getAssetPatterns(target, arch);
    if (!patterns) {
      console.warn(`[Desktop Update] Unknown target/arch: ${target}/${arch}`);
      return new NextResponse(null, { status: 204 });
    }

    const installerAsset = release.assets.find((a) =>
      patterns.installer.test(a.name),
    );
    if (!installerAsset) {
      console.warn(
        `[Desktop Update] No installer asset found for ${target}/${arch} in ${release.tag_name}`,
      );
      return new NextResponse(null, { status: 204 });
    }

    // Find the signature file
    const sigAsset = release.assets.find((a) =>
      patterns.signature.test(a.name),
    );
    let signature = "";
    if (sigAsset) {
      signature = (await fetchSignature(sigAsset.browser_download_url)) || "";
    }

    // Return Tauri updater JSON format
    return NextResponse.json({
      version: `v${latestVersion}`,
      notes: release.body || `TimeTrack Desktop v${latestVersion}`,
      pub_date: release.published_at,
      url: installerAsset.browser_download_url,
      signature,
    });
  } catch (error) {
    console.error("[Desktop Update] Error:", error);
    // Don't break the app if update check fails
    return new NextResponse(null, { status: 204 });
  }
}
