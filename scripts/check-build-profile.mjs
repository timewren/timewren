#!/usr/bin/env node
// Fails when app code outside the groups the self-host build profile omits
// (src/app/(marketing), src/app/(timewren)) imports from them (#1100).
//
//   node scripts/check-build-profile.mjs
//
// Run by scripts/build.mjs before a BUILD_PROFILE=selfhost build and by CI
// (npm run check). Tests are not part of the build and may import anything.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const OMITTED = ["src/app/(marketing)", "src/app/(timewren)"];
// The one importer that is allowed: next.config.ts aliases it to its
// .selfhost stand-in in the selfhost profile.
const ALLOWED = new Set(["src/lib/instance-marketing-loader.ts"]);
const TARGET = /\((?:marketing|timewren)\)/;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/;
const TEST = /(?:\.test\.|\.spec\.|\.dbtest\.|__tests__|__model__)/;

export function findViolations(files) {
  const violations = [];
  for (const [rel, text] of files) {
    if (ALLOWED.has(rel)) continue;
    // Quoted specifiers only: `from "…"`, `import("…")`, `require("…")`,
    // `export … from "…"`, and template-literal dynamic imports.
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!TARGET.test(line)) return;
      // Specifier only, so a path on its own line (Biome wrapping) is caught.
      if (/[`'"][^`'"]*\((?:marketing|timewren)\)\//.test(line)) {
        violations.push(`${rel}:${i + 1}: ${line.trim()}`);
      }
    });
  }
  return violations;
}

function* walk(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    const rel = relative(root, full).split(sep).join("/");
    if (OMITTED.includes(rel)) continue;
    if (entry.isDirectory()) yield* walk(full);
    else if (SOURCE.test(entry.name) && !TEST.test(rel)) yield [rel, full];
  }
}

// Only when run directly, so a test can import findViolations.
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const files = [...walk(join(root, "src"))].map(([rel, full]) => [
    rel,
    readFileSync(full, "utf8"),
  ]);
  const violations = findViolations(files);
  if (violations.length > 0) {
    console.error(
      "These files import from a directory the selfhost build profile omits:\n" +
        violations.map((v) => `  ${v}`).join("\n") +
        "\nMove the shared code to src/components or src/lib (see docs/self-hosting.md, Build profiles).",
    );
    process.exit(1);
  }
  console.log(
    `check-build-profile: ${files.length} files, no imports into ${OMITTED.join(", ")}`,
  );
}
