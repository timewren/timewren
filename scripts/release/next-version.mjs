#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Suggests the next release version. Read-only: changes no file, creates no tag.
//
//   node scripts/release/next-version.mjs [--since <git-ref>] [--json]
//
// Signals (the larger bump wins, see docs/oss/versioning.md):
//  1. The [Unreleased] section of CHANGELOG.md (Breaking, Added, Changed, ...).
//  2. Commit messages since the last release, read as Conventional Commits.
//     The range starts at --since, else at tag v<last release> when it exists,
//     else the commits are skipped.
// Before 1.0.0 a breaking change raises MINOR.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  applyBump,
  bumpFromChangelogGroups,
  bumpFromCommits,
  formatVersion,
  isReleased,
  maxBump,
  parseChangelog,
  parseVersion,
} from "./lib.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const json = args.includes("--json");
const sinceIdx = args.indexOf("--since");
const since = sinceIdx >= 0 ? args[sinceIdx + 1] : null;
if (sinceIdx >= 0 && !since) {
  console.error("--since needs a git ref");
  process.exit(2);
}

function git(...a) {
  return execFileSync("git", a, { cwd: root, encoding: "utf8" });
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const sections = parseChangelog(
  readFileSync(join(root, "CHANGELOG.md"), "utf8"),
);
const unreleased = sections.find((s) => s.title.toLowerCase() === "unreleased");
const lastReleased = sections.find(isReleased);

// Nothing released yet: the first version is the package.json version.
const current = lastReleased ? lastReleased.version : null;
const changelogBump = unreleased
  ? bumpFromChangelogGroups(unreleased.groups)
  : "none";

let range = null;
if (since) range = `${since}..HEAD`;
else if (current) {
  const tag = `v${formatVersion(current)}`;
  try {
    git("rev-parse", "--verify", "--quiet", `${tag}^{commit}`);
    range = `${tag}..HEAD`;
  } catch {
    range = null;
  }
}
let commits = { bump: "none", conventional: 0, total: 0 };
if (range) {
  const out = git("log", "--no-merges", "--format=%B%x00", range);
  const messages = out
    .split("\0")
    .map((m) => m.trim())
    .filter(Boolean);
  commits = bumpFromCommits(messages);
}

const bump = maxBump(changelogBump, commits.bump);
let next;
if (!current) next = parseVersion(pkg.version);
else next = applyBump(current, bump);

const result = {
  current: current ? formatVersion(current) : null,
  next: next ? formatVersion(next) : null,
  bump: current ? bump : "first",
  changelog: changelogBump,
  commits: { range, ...commits },
};

if (json) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`Last release:   ${result.current ?? "none"}`);
  console.log(`[Unreleased]:   ${changelogBump}`);
  if (range) {
    console.log(
      `Commits:        ${commits.bump} (${commits.conventional} of ${commits.total} conventional, ${range})`,
    );
  } else {
    console.log(
      "Commits:        skipped (no tag for the last release; use --since <ref>)",
    );
  }
  if (!current) console.log(`Suggested:      ${result.next} (first release)`);
  else if (!next)
    console.log(
      "Suggested:      no release needed (nothing user-facing changed)",
    );
  else console.log(`Suggested:      ${result.next} (${bump})`);
}
