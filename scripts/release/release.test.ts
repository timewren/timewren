import { describe, expect, it } from "vitest";
import {
  applyBump,
  bumpFromChangelogGroups,
  bumpFromCommits,
  checkRelease,
  formatVersion,
  parseChangelog,
  parseVersion,
} from "./lib.mjs";

const v = (s: string) => {
  const parsed = parseVersion(s);
  if (!parsed) throw new Error(`bad version ${s}`);
  return parsed;
};
const next = (cur: string, bump: string) => {
  const r = applyBump(v(cur), bump);
  return r ? formatVersion(r) : null;
};

const RELEASED = `# Changelog

## [Unreleased]

### Fixed

- Something small.

## [0.2.0] - 2026-12-01

### Added

- A feature.

## [0.1.0] - 2026-11-20

### Added

- First public release.
`;

describe("applyBump", () => {
  it("raises MINOR for breaking changes before 1.0.0", () => {
    expect(next("0.4.2", "major")).toBe("0.5.0");
    expect(next("1.4.2", "major")).toBe("2.0.0");
  });
  it("raises MINOR for features and PATCH for fixes", () => {
    expect(next("0.4.2", "minor")).toBe("0.5.0");
    expect(next("0.4.2", "patch")).toBe("0.4.3");
  });
  it("suggests no release when nothing user-facing changed", () => {
    expect(next("0.4.2", "none")).toBeNull();
  });
});

describe("bump signals", () => {
  it("reads Conventional Commits, including ! and BREAKING CHANGE", () => {
    expect(bumpFromCommits(["fix: a", "docs: b"]).bump).toBe("patch");
    expect(bumpFromCommits(["fix: a", "feat(timer): b"]).bump).toBe("minor");
    expect(bumpFromCommits(["feat!: drop x"]).bump).toBe("major");
    expect(bumpFromCommits(["refactor: x\n\nBREAKING CHANGE: y"]).bump).toBe(
      "major",
    );
    expect(bumpFromCommits(["Ret noget", "chore: x"])).toMatchObject({
      bump: "none",
      conventional: 1,
      total: 2,
    });
  });
  it("reads changelog groups", () => {
    const [unreleased] = parseChangelog(RELEASED);
    expect(bumpFromChangelogGroups(unreleased.groups)).toBe("patch");
    expect(bumpFromChangelogGroups({ Added: ["x"] })).toBe("minor");
    expect(bumpFromChangelogGroups({ Breaking: ["x"], Fixed: ["y"] })).toBe(
      "major",
    );
    expect(bumpFromChangelogGroups({ Added: [] })).toBe("none");
  });
});

describe("checkRelease", () => {
  it("accepts package.json matching the newest release", () => {
    expect(checkRelease({ pkgVersion: "0.2.0", changelog: RELEASED })).toEqual(
      [],
    );
    expect(
      checkRelease({
        pkgVersion: "0.2.0",
        changelog: RELEASED,
        tags: ["v0.2.0"],
        requireTag: true,
      }),
    ).toEqual([]);
  });
  it("rejects a package.json version that differs from the changelog", () => {
    expect(
      checkRelease({ pkgVersion: "0.3.0", changelog: RELEASED }),
    ).toHaveLength(1);
  });
  it("rejects a tag that differs from package.json", () => {
    const problems = checkRelease({
      pkgVersion: "0.2.0",
      changelog: RELEASED,
      tags: ["v0.2.1"],
      requireTag: true,
    });
    expect(problems.join("\n")).toContain("does not match");
  });
  it("requires a tag when running for a tag", () => {
    expect(
      checkRelease({
        pkgVersion: "0.2.0",
        changelog: RELEASED,
        requireTag: true,
      }),
    ).toHaveLength(1);
  });
  it("ignores extension tags at the same commit", () => {
    expect(
      checkRelease({
        pkgVersion: "0.2.0",
        changelog: RELEASED,
        tags: ["extension-v2.9.0"],
      }),
    ).toEqual([]);
  });
  it("allows only the first version before anything is released", () => {
    const fresh =
      "# Changelog\n\n## [Unreleased]\n\n### Added\n\n- All of it.\n";
    expect(checkRelease({ pkgVersion: "0.1.0", changelog: fresh })).toEqual([]);
    expect(
      checkRelease({ pkgVersion: "1.0.0", changelog: fresh }),
    ).toHaveLength(1);
    // Tagging needs a dated section, so v0.1.0 cannot be tagged from this file.
    expect(
      checkRelease({
        pkgVersion: "0.1.0",
        changelog: fresh,
        tags: ["v0.1.0"],
        requireTag: true,
      }),
    ).toHaveLength(1);
  });
  it("requires an [Unreleased] section, dates and descending order", () => {
    const noUnreleased = RELEASED.replace("## [Unreleased]\n", "");
    expect(
      checkRelease({ pkgVersion: "0.2.0", changelog: noUnreleased }).join(),
    ).toContain("[Unreleased]");
    const undated = RELEASED.replace("## [0.1.0] - 2026-11-20", "## [0.1.0]");
    expect(
      checkRelease({ pkgVersion: "0.2.0", changelog: undated }).join(),
    ).toContain("needs a date");
    const swapped = RELEASED.replace(
      "[0.2.0] - 2026-12-01",
      "[0.0.9] - 2026-12-01",
    );
    expect(
      checkRelease({ pkgVersion: "0.0.9", changelog: swapped }).join(),
    ).toContain("descending");
  });
  it("requires migration notes next to breaking changes", () => {
    const breaking = RELEASED.replace(
      "### Added\n\n- A feature.",
      "### Breaking\n\n- Renamed X.",
    );
    expect(
      checkRelease({ pkgVersion: "0.2.0", changelog: breaking }).join(),
    ).toContain("Migration");
    const withNotes = breaking.replace(
      "- Renamed X.",
      "- Renamed X.\n\n### Migration\n\n- Set Y.",
    );
    expect(checkRelease({ pkgVersion: "0.2.0", changelog: withNotes })).toEqual(
      [],
    );
  });
});
