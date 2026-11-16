#!/usr/bin/env node
// SPDX-FileCopyrightText: 2025-present Mahope
// SPDX-License-Identifier: AGPL-3.0-only
// Checks that package.json, CHANGELOG.md and the release tag agree (npm run release:check).
//
//   node scripts/release/check.mjs              tags at HEAD must match, if any
//   node scripts/release/check.mjs --tag v0.2.0 the given tag must match (CI on a tag)
//
// On GitHub Actions a tag push (GITHUB_REF_TYPE=tag) counts as --tag $GITHUB_REF_NAME.
// Only tags pointing at HEAD are considered: older v* tags in a source
// repository are not public releases (see docs/oss/versioning.md).
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRelease } from "./lib.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));
const args = process.argv.slice(2);
const tagIdx = args.indexOf("--tag");
let tag = tagIdx >= 0 ? args[tagIdx + 1] : null;
if (tagIdx >= 0 && !tag) {
  console.error("--tag needs a value, e.g. --tag v0.2.0");
  process.exit(2);
}
if (!tag && process.env.GITHUB_REF_TYPE === "tag")
  tag = process.env.GITHUB_REF_NAME;

let tags;
if (tag) tags = [tag];
else {
  try {
    tags = execFileSync("git", ["tag", "--points-at", "HEAD", "--list", "v*"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    })
      .split("\n")
      .filter(Boolean);
  } catch {
    tags = [];
  }
}

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const problems = checkRelease({
  pkgVersion: pkg.version,
  changelog: readFileSync(join(root, "CHANGELOG.md"), "utf8"),
  tags,
  requireTag: Boolean(tag),
});

if (problems.length > 0) {
  for (const p of problems) console.error(`release:check: ${p}`);
  process.exit(1);
}
console.log(
  `release:check: ok (package.json ${pkg.version}${tags.length ? `, tag ${tags.join(", ")}` : ", no tag at HEAD"})`,
);
