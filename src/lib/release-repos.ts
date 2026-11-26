import { getBrandId } from "./brand-id";

function repository(value: string | undefined, fallback = "") {
  const repo = value?.trim() || fallback;
  if (repo.split("/").some((part) => part === "." || part === ".."))
    return undefined;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : undefined;
}

export function getDesktopReleasesRepo() {
  return repository(
    process.env.NEXT_PUBLIC_DESKTOP_RELEASES_REPO,
    // Keep the same default in the prerendered page, runtime page and client.
    process.env.NEXT_PUBLIC_BRAND === "timetrack"
      ? "mahope/timetrack-releases"
      : "",
  );
}

export type DesktopBrand = "timetrack" | "timewren";

/**
 * Page with a brand's desktop release, or undefined when no repo is set. Both
 * brands publish to the same repo: TimeTrack is the repo's "latest" release,
 * TimeWren has the fixed tag `timewren-stable` and is never "latest".
 */
export function getDesktopDownloadUrl(brand: DesktopBrand) {
  const repo = getDesktopReleasesRepo();
  if (!repo) return undefined;
  return brand === "timewren"
    ? `https://github.com/${repo}/releases/tag/timewren-stable`
    : `https://github.com/${repo}/releases/latest`;
}

/**
 * The updater manifest (latest.json) of a brand's current desktop release. It
 * is a release download, not the GitHub API, so it has no API rate limit.
 */
export function getDesktopManifestUrl(brand: DesktopBrand) {
  const repo = getDesktopReleasesRepo();
  if (!repo) return undefined;
  return brand === "timewren"
    ? `https://github.com/${repo}/releases/download/timewren-stable/latest.json`
    : `https://github.com/${repo}/releases/latest/download/latest.json`;
}

export function getDesktopUpdaterRepo() {
  return repository(
    process.env.DESKTOP_UPDATER_REPO,
    getBrandId() === "timetrack" ? "mahope/timetrack-desktop" : "",
  );
}

export function getChangelogRepo() {
  return repository(
    process.env.CHANGELOG_REPO,
    getBrandId() === "timetrack" ? "mahope/timetrack" : "",
  );
}
