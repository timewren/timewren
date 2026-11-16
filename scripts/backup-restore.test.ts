import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Rene tjek af backup- og gendannelsesscripts uden Docker. Selve gendannelsen
// bevises af scripts/test-restore.sh (kræver Docker, se docs/self-hosting.md).

const scripts = [
  "backup.sh",
  "restore.sh",
  "lib/backup-common.sh",
  "test-restore.sh",
];

function run(script: string, args: string[], env: Record<string, string> = {}) {
  return spawnSync("bash", [join(__dirname, script), ...args], {
    encoding: "utf8",
    env: {
      NODE_ENV: process.env.NODE_ENV,
      PATH: process.env.PATH ?? "",
      ...env,
    },
  });
}

describe("backup and restore scripts", () => {
  it.each(scripts)("%s has valid bash syntax", (script) => {
    const r = spawnSync("bash", ["-n", join(__dirname, script)], {
      encoding: "utf8",
    });
    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
  });

  it("restore.sh refuses to run without a backup directory", () => {
    const r = run("restore.sh", ["--yes"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("usage: scripts/restore.sh");
  });

  it("restore.sh rejects an incomplete backup", () => {
    const dir = mkdtempSync(join(tmpdir(), "tt-backup-"));
    try {
      writeFileSync(join(dir, "db.dump"), "x");
      const r = run("restore.sh", ["--yes", dir]);
      expect(r.status).not.toBe(0);
      expect(r.stderr).toContain("backup is incomplete");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("backup.sh rejects unknown arguments", () => {
    const r = run("backup.sh", ["--bogus"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unknown argument");
  });

  it("tt_env_value reads a key without leaking other keys", () => {
    const dir = mkdtempSync(join(tmpdir(), "tt-env-"));
    try {
      const envFile = join(dir, ".env");
      writeFileSync(envFile, 'FOO=bar\nENCRYPTION_KEY="abc123"\nOTHER=zzz\n');
      const r = spawnSync(
        "bash",
        [
          "-c",
          `. "${join(__dirname, "lib/backup-common.sh")}"; tt_env_value "${envFile}" ENCRYPTION_KEY`,
        ],
        { encoding: "utf8" },
      );
      expect(r.stdout).toBe("abc123");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("tt_env_value handles single quotes, export and CRLF", () => {
    const dir = mkdtempSync(join(tmpdir(), "tt-env-"));
    try {
      const envFile = join(dir, ".env");
      writeFileSync(
        envFile,
        "A='abc'\r\nexport B=def\r\nC=ghi\r\nD=\"jkl\"\r\n",
      );
      const get = (k: string) =>
        spawnSync(
          "bash",
          [
            "-c",
            `. "${join(__dirname, "lib/backup-common.sh")}"; tt_env_value "${envFile}" ${k}`,
          ],
          { encoding: "utf8" },
        ).stdout;
      expect([get("A"), get("B"), get("C"), get("D")]).toEqual([
        "abc",
        "def",
        "ghi",
        "jkl",
      ]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
