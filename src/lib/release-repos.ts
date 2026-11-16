import { getBrandId } from "./brand-id";

function repository(value: string | undefined, cloudDefault: string) {
  const repo =
    value?.trim() || (getBrandId() === "timetrack" ? cloudDefault : "");
  if (repo.split("/").some((part) => part === "." || part === ".."))
    return undefined;
  return /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) ? repo : undefined;
}

export function getDesktopReleasesRepo() {
  return repository(
    process.env.NEXT_PUBLIC_DESKTOP_RELEASES_REPO,
    "mahope/timetrack-releases",
  );
}

export function getDesktopUpdaterRepo() {
  return repository(
    process.env.DESKTOP_UPDATER_REPO,
    "mahope/timetrack-desktop",
  );
}

export function getChangelogRepo() {
  return repository(process.env.CHANGELOG_REPO, "mahope/timetrack");
}
