import { spawnSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
let fixture: string;

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "timetrack paths "));
  for (const path of [
    "scripts/i18n",
    "scripts/release",
    "src/i18n/messages",
    "browser-extension/src/i18n/messages",
    "browser-extension/_locales",
    "package.json",
    "CHANGELOG.md",
  ]) {
    cpSync(join(root, path), join(fixture, path), { recursive: true });
  }
});

afterAll(() => rmSync(fixture, { recursive: true, force: true }));

it.each([
  ["i18n/check.mjs", []],
  ["i18n/build-loader.mjs", ["--check"]],
  ["release/check.mjs", []],
  ["release/next-version.mjs", ["--json"]],
])("runs %s from a path containing spaces", (script, args) => {
  const env = { ...process.env };
  delete env.I18N_CHECK_ROOT;
  delete env.GITHUB_REF_TYPE;
  delete env.GITHUB_REF_NAME;
  const result = spawnSync(
    process.execPath,
    [join(fixture, "scripts", script), ...args],
    { cwd: fixture, env, encoding: "utf8" },
  );
  expect(result.status, result.stderr || result.stdout).toBe(0);
});
