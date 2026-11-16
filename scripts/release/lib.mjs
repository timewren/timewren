// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Shared helpers for the release scripts (next-version.mjs, check.mjs).
// Pure functions only, so the tests can feed them fixtures. See docs/oss/versioning.md.

const SEMVER =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?$/;

export function parseVersion(text) {
  const m = SEMVER.exec(String(text).trim().replace(/^v/, ""));
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3]),
    prerelease: m[4] ?? null,
  };
}

export function formatVersion(v) {
  const core = `${v.major}.${v.minor}.${v.patch}`;
  return v.prerelease ? `${core}-${v.prerelease}` : core;
}

export function compareVersions(a, b) {
  for (const k of ["major", "minor", "patch"]) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  if (a.prerelease === b.prerelease) return 0;
  if (a.prerelease === null) return 1;
  if (b.prerelease === null) return -1;
  return a.prerelease < b.prerelease ? -1 : 1;
}

const BUMP_ORDER = ["none", "patch", "minor", "major"];

export function maxBump(...bumps) {
  return bumps.reduce(
    (best, b) => (BUMP_ORDER.indexOf(b) > BUMP_ORDER.indexOf(best) ? b : best),
    "none",
  );
}

/**
 * Parses a Keep a Changelog file into sections:
 * [{ title: "Unreleased" | "1.2.3", version, date, groups: { Added: [...] } }]
 * `version` is null for Unreleased; `date` is null when the heading has none.
 */
export function parseChangelog(text) {
  const sections = [];
  let section = null;
  let group = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const h2 = /^## \[([^\]]+)\](?:\s+-\s+(\S+))?/.exec(line);
    if (h2) {
      const title = h2[1].trim();
      const unreleased = title.toLowerCase() === "unreleased";
      section = {
        title,
        version: unreleased ? null : parseVersion(title),
        date: h2[2] ?? null,
        groups: {},
      };
      sections.push(section);
      group = null;
      continue;
    }
    if (!section) continue;
    const h3 = /^### (.+)$/.exec(line);
    if (h3) {
      group = h3[1].trim();
      section.groups[group] ??= [];
      continue;
    }
    if (group && /^\s*[-*] \S/.test(line)) {
      section.groups[group].push(line.replace(/^\s*[-*] /, ""));
    }
  }
  return sections;
}

export function isReleased(section) {
  return Boolean(
    section.version && section.date && /^\d{4}-\d{2}-\d{2}$/.test(section.date),
  );
}

/** Bump implied by changelog groups (Keep a Changelog names plus "Breaking"). */
export function bumpFromChangelogGroups(groups) {
  const has = (name) => (groups[name] ?? []).length > 0;
  if (has("Breaking")) return "major";
  if (has("Added") || has("Changed") || has("Deprecated") || has("Removed"))
    return "minor";
  if (has("Fixed") || has("Security")) return "patch";
  return "none";
}

/**
 * Bump implied by commit messages, read as Conventional Commits. Returns
 * { bump, conventional, total }: `conventional` counts the commits that
 * follow the convention, so the caller can say when the signal is weak.
 */
export function bumpFromCommits(messages) {
  let bump = "none";
  let conventional = 0;
  for (const message of messages) {
    const [subject = "", ...rest] = message.split("\n");
    const m = /^(\w+)(\([^)]*\))?(!)?:\s/.exec(subject);
    const breakingFooter = /^BREAKING[ -]CHANGE:/m.test(rest.join("\n"));
    if (!m) {
      if (breakingFooter) bump = maxBump(bump, "major");
      continue;
    }
    conventional++;
    const type = m[1].toLowerCase();
    if (m[3] || breakingFooter) bump = maxBump(bump, "major");
    else if (type === "feat") bump = maxBump(bump, "minor");
    else if (type === "fix" || type === "perf" || type === "security")
      bump = maxBump(bump, "patch");
  }
  return { bump, conventional, total: messages.length };
}

/**
 * Applies a bump with the 0.x rules from docs/oss/versioning.md: before 1.0.0
 * a breaking change raises MINOR, not MAJOR.
 */
export function applyBump(current, bump) {
  const v = { ...current, prerelease: null };
  const effective = bump === "major" && v.major === 0 ? "minor" : bump;
  if (effective === "major")
    return { major: v.major + 1, minor: 0, patch: 0, prerelease: null };
  if (effective === "minor")
    return { major: v.major, minor: v.minor + 1, patch: 0, prerelease: null };
  if (effective === "patch") {
    // A prerelease of X.Y.Z is followed by X.Y.Z itself.
    if (current.prerelease) return v;
    return { ...v, patch: v.patch + 1 };
  }
  return null;
}

/**
 * Release consistency rules (npm run release:check). Returns a list of
 * problems; empty means consistent.
 *   pkgVersion: version from package.json
 *   changelog:  CHANGELOG.md text
 *   tags:       release tags (v*) that point at the checked commit
 *   requireTag: true when running for a tag (CI on a tag push)
 *   firstVersion: version allowed before anything has been released
 *
 * @param {{ pkgVersion: string, changelog: string, tags?: string[], requireTag?: boolean, firstVersion?: string }} options
 * @returns {string[]}
 */
export function checkRelease({
  pkgVersion,
  changelog,
  tags = [],
  requireTag = false,
  firstVersion = "0.1.0",
}) {
  const problems = [];
  const version = parseVersion(pkgVersion);
  if (!version) {
    problems.push(`package.json version "${pkgVersion}" is not SemVer.`);
    return problems;
  }
  const sections = parseChangelog(changelog);
  if (
    sections.length === 0 ||
    sections[0].title.toLowerCase() !== "unreleased"
  ) {
    problems.push("CHANGELOG.md must start with an [Unreleased] section.");
  }

  const versioned = sections.filter(
    (s) => s.title.toLowerCase() !== "unreleased",
  );
  for (const s of versioned) {
    if (!s.version)
      problems.push(`CHANGELOG.md heading [${s.title}] is not a version.`);
    else if (!isReleased(s))
      problems.push(
        `CHANGELOG.md section [${s.title}] needs a date as YYYY-MM-DD.`,
      );
    if (
      (s.groups.Breaking ?? []).length > 0 &&
      (s.groups.Migration ?? []).length === 0
    )
      problems.push(
        `CHANGELOG.md section [${s.title}] lists breaking changes without a Migration group.`,
      );
  }
  const parsed = versioned.filter((s) => s.version);
  for (let i = 1; i < parsed.length; i++) {
    if (compareVersions(parsed[i - 1].version, parsed[i].version) <= 0) {
      problems.push(
        `CHANGELOG.md sections are not in descending order: [${parsed[i - 1].title}] before [${parsed[i].title}].`,
      );
    }
  }

  const released = parsed.filter(isReleased);
  const pkg = formatVersion(version);
  if (released.length === 0) {
    if (pkg !== firstVersion)
      problems.push(
        `Nothing is released yet, so package.json must be the first version ${firstVersion} (found ${pkg}).`,
      );
  } else if (formatVersion(released[0].version) !== pkg) {
    problems.push(
      `package.json is ${pkg} but the newest CHANGELOG.md release is ${released[0].title}.`,
    );
  }

  const releaseTags = tags.filter((t) => /^v\d/.test(t));
  for (const tag of releaseTags) {
    if (tag !== `v${pkg}`)
      problems.push(`Tag ${tag} does not match package.json version ${pkg}.`);
  }
  if (requireTag && releaseTags.length === 0) {
    problems.push(`No release tag v${pkg} points at this commit.`);
  }
  if (
    (requireTag || releaseTags.length > 0) &&
    !released.some((s) => formatVersion(s.version) === pkg)
  ) {
    problems.push(
      `Tagging v${pkg} needs a dated CHANGELOG.md section [${pkg}].`,
    );
  }
  return problems;
}
