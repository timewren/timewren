#!/usr/bin/env node
// `npm run build` with a build profile (#1100).
//
//   BUILD_PROFILE=full      (default) the whole app: Cloud, with marketing and
//                           the TimeWren site. Same command as before.
//   BUILD_PROFILE=selfhost  leaves src/app/(marketing) and src/app/(timewren)
//                           out of `next build`. Self-host instances serve
//                           only the app and the instance pages, and those
//                           293 prerendered pages are most of the build time
//                           and memory. docs/self-hosting.md, "Build profiles".
//
// The omitted route groups are moved to .build-profile-stash/ for the build
// and moved back afterwards, also when the build fails or the process gets
// SIGINT/SIGTERM/SIGHUP. If the process is killed hard (SIGKILL, power), the
// next run, of this script or `npm run build:restore`, puts them back first.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stash = join(root, ".build-profile-stash");
const OMITTED = ["src/app/(marketing)", "src/app/(timewren)"];
const PROFILES = ["full", "selfhost"];

function move(from, to) {
  mkdirSync(dirname(to), { recursive: true });
  try {
    renameSync(from, to);
  } catch (error) {
    if (error.code !== "EXDEV") throw error;
    cpSync(from, to, { recursive: true });
    rmSync(from, { recursive: true, force: true });
  }
}

/** Puts every stashed directory back. Safe to call any number of times. */
function restore() {
  let restored = 0;
  for (const rel of OMITTED) {
    const stashed = join(stash, rel);
    const home = join(root, rel);
    if (!existsSync(stashed)) continue;
    if (existsSync(home)) {
      // Never overwrite: two copies means someone edited while stashed.
      console.error(
        `build: ${rel} exists in both places; keeping both, resolve by hand (stash: ${stashed})`,
      );
      process.exitCode = 1;
      continue;
    }
    move(stashed, home);
    restored++;
  }
  if (!process.exitCode && existsSync(stash)) {
    rmSync(stash, { recursive: true, force: true });
  }
  return restored;
}

function omit() {
  for (const rel of OMITTED) {
    const home = join(root, rel);
    if (!existsSync(home)) {
      throw new Error(`build: ${rel} not found, cannot apply selfhost profile`);
    }
    move(home, join(stash, rel));
  }
}

function run(command, args, env = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

const profile = process.env.BUILD_PROFILE || "full";
if (!PROFILES.includes(profile)) {
  console.error(
    `build: unknown BUILD_PROFILE "${profile}" (expected ${PROFILES.join(" or ")})`,
  );
  process.exit(2);
}

if (process.argv[2] === "--restore") {
  const n = restore();
  console.log(`build: restored ${n} director${n === 1 ? "y" : "ies"}`);
  process.exit(process.exitCode ?? 0);
}

// A previous run that was killed hard leaves the stash behind.
if (restore() > 0)
  console.warn("build: restored directories from a stale stash");
if (process.exitCode) process.exit(process.exitCode);

const nextArgs = ["build", "--turbopack", ...process.argv.slice(2)];
const next = join(root, "node_modules/.bin/next");

if (profile === "full") {
  process.exit(run(next, nextArgs, { BUILD_PROFILE: "full" }));
}

// selfhost: no import may point into the omitted groups. Checked before
// anything moves, so a violation costs seconds, not a failed build.
const checked = run(process.execPath, [
  join(root, "scripts/check-build-profile.mjs"),
]);
if (checked !== 0) process.exit(checked);

let signalled = null;
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => {
    signalled = signal;
  });
}
process.on("exit", () => {
  // Last resort for exits that skip the finally block.
  restore();
});

let status = 1;
try {
  omit();
  status = run(next, nextArgs, { BUILD_PROFILE: "selfhost" });
} finally {
  const n = restore();
  console.log(`build: restored ${n} omitted director${n === 1 ? "y" : "ies"}`);
}
process.exit(signalled ? 130 : status || process.exitCode || 0);
