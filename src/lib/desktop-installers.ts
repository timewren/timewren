import {
  type DesktopBrand,
  getDesktopDownloadUrl,
  getDesktopManifestUrl,
} from "./release-repos";

/** Direct links to a brand's current desktop installers. */
export interface DesktopInstallers {
  version?: string;
  windows?: string;
  macArm?: string;
  macIntel?: string;
  /** The release page, as a fallback when a direct link is missing. */
  releasePage?: string;
}

interface UpdaterManifest {
  version?: unknown;
  platforms?: Record<string, { url?: unknown } | undefined>;
}

const SAFE_VERSION = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
const SAFE_PRODUCT = /^[A-Za-z0-9-]+$/;

/**
 * Installer links from the updater manifest (latest.json). The manifest lists
 * the Windows installer and the macOS updater archives; the .dmg files sit in
 * the same release under Tauri's fixed names (`<Product>_<version>_aarch64.dmg`
 * and `_x64.dmg`), so their URLs are derived from the release folder.
 * Only github.com download URLs are accepted.
 */
export function installersFromManifest(
  manifest: UpdaterManifest | null | undefined,
): Omit<DesktopInstallers, "releasePage"> {
  const version =
    typeof manifest?.version === "string" && SAFE_VERSION.test(manifest.version)
      ? manifest.version
      : undefined;
  if (!version) return {};
  const urls = Object.values(manifest?.platforms ?? {})
    .map((p) => (typeof p?.url === "string" ? p.url : ""))
    .filter((u) =>
      /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/releases\/download\/[\w.-]+\/[^/]+$/.test(
        u,
      ),
    );
  const windows = urls.find((u) => u.endsWith("-setup.exe"));
  const sample = windows ?? urls[0];
  if (!sample) return { version };
  const folder = sample.slice(0, sample.lastIndexOf("/"));
  const file = sample.slice(sample.lastIndexOf("/") + 1);
  // "TimeWren_0.2.30_x64-setup.exe" or "darwin-aarch64-TimeWren.app.tar.gz".
  const product =
    file.match(/^(.+?)_\d/)?.[1] ??
    file.match(/^darwin-[^-]+-(.+)\.app\./)?.[1];
  if (!product || !SAFE_PRODUCT.test(product)) return { version, windows };
  return {
    version,
    windows,
    macArm: `${folder}/${product}_${version}_aarch64.dmg`,
    macIntel: `${folder}/${product}_${version}_x64.dmg`,
  };
}

/**
 * The brand's current installers. Cached for an hour on the server; any
 * failure gives just the release page (or nothing without a releases repo).
 */
export async function getDesktopInstallers(
  brand: DesktopBrand,
): Promise<DesktopInstallers> {
  const releasePage = getDesktopDownloadUrl(brand);
  const manifestUrl = getDesktopManifestUrl(brand);
  if (!manifestUrl) return { releasePage };
  try {
    // /download renders per request, so a hanging GitHub must not hang it.
    const res = await fetch(manifestUrl, {
      next: { revalidate: 3600 },
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { releasePage };
    return {
      ...installersFromManifest((await res.json()) as UpdaterManifest),
      releasePage,
    };
  } catch {
    return { releasePage };
  }
}
