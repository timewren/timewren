import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const REPO = resolve(__dirname, "..");
const SECRET_KEYS = [
  "POSTGRES_PASSWORD",
  "BETTER_AUTH_SECRET",
  "ENCRYPTION_KEY",
  "CRON_SECRET",
];

// Tools install.sh needs. Symlinked into an isolated PATH so a test can run
// "without docker" even on a machine that has it.
const TOOLS = [
  "bash",
  "sh",
  "awk",
  "grep",
  "sed",
  "head",
  "tr",
  "od",
  "cat",
  "mktemp",
  "chmod",
  "mv",
  "rm",
  "date",
  "sleep",
  "dirname",
  "openssl",
  "mkdir",
];

let dir: string;
let bin: string;
let log: string;

function which(name: string): string | null {
  const r = spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

type Fake = { compose?: string; health?: string; daemon?: boolean };

function installFakeDocker({
  compose = "2.40.0",
  health = "healthy",
  daemon = true,
}: Fake = {}) {
  const script = `#!/bin/sh
echo "$@" >> "${log}"
case "$1" in
  --version) echo "Docker version 99" ;;
  info) ${daemon ? "exit 0" : "echo 'permission denied' >&2; exit 1"} ;;
  inspect) echo "${health}" ;;
  compose)
    case "$2" in
      version) echo "${compose}" ;;
      ps) echo "fakecontainer" ;;
      up|logs) exit 0 ;;
    esac ;;
esac
`;
  writeFileSync(join(bin, "docker"), script);
  chmodSync(join(bin, "docker"), 0o755);
}

function run(args: string[] = []) {
  return spawnSync("bash", [join(dir, "scripts/install.sh"), ...args], {
    cwd: dir,
    env: { ...process.env, PATH: bin, HOME: dir },
    encoding: "utf8",
    timeout: 30_000,
  });
}

function fakeDownloads(fail = false) {
  writeFileSync(
    join(bin, "curl"),
    `#!/bin/sh
echo "$@" >> "${join(dir, "downloads.log")}"
${fail ? "exit 22" : ""}
case "$2" in
  */releases/latest) echo '{"tag_name":"v1.2.3"}'; exit 0 ;;
esac
case "$2" in
  */.env.example) cp "${join(REPO, ".env.example")}" "$4" ;;
  */docker-compose.yml) echo 'name: standalone' > "$4" ;;
  */docker-compose.caddy.yml) echo 'services: {}' > "$4" ;;
esac
`,
  );
  chmodSync(join(bin, "curl"), 0o755);
  const cp = which("cp");
  if (cp) symlinkSync(cp, join(bin, "cp"));
}

function pipeInstall(args: string[] = []) {
  rmSync(join(dir, ".env.example"), { force: true });
  rmSync(join(dir, "docker-compose.yml"), { force: true });
  return spawnSync("bash", ["-s", "--", ...args], {
    cwd: dir,
    input: readFileSync(join(REPO, "scripts/install.sh"), "utf8"),
    env: { ...process.env, PATH: bin, HOME: dir },
    encoding: "utf8",
    timeout: 30_000,
  });
}

const sha = (p: string) =>
  createHash("sha256").update(readFileSync(p)).digest("hex");
const envValue = (key: string) =>
  readFileSync(join(dir, ".env"), "utf8")
    .split("\n")
    .find((l) => l.startsWith(`${key}=`))
    ?.slice(key.length + 1);

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "install-test-"));
  bin = join(dir, "bin");
  log = join(dir, "docker.log");
  mkdirSync(bin);
  mkdirSync(join(dir, "scripts"));
  copyFileSync(
    join(REPO, "scripts/install.sh"),
    join(dir, "scripts/install.sh"),
  );
  copyFileSync(join(REPO, ".env.example"), join(dir, ".env.example"));
  writeFileSync(join(dir, "docker-compose.yml"), "name: t\n");
  for (const t of TOOLS) {
    const p = which(t);
    if (p) symlinkSync(p, join(bin, t));
  }
  installFakeDocker();
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("scripts/install.sh", () => {
  it("rebuilds source checkouts on every run without pulling a published app", () => {
    writeFileSync(join(dir, "Dockerfile"), "FROM node:22\n");
    writeFileSync(join(dir, "package.json"), '{"name":"timetrack"}\n');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(run().status).toBe(0);
    }
    const calls = readFileSync(log, "utf8");
    expect(calls.match(/compose up -d --build/g)).toHaveLength(2);
    expect(calls).not.toContain("compose pull");
  });

  it("runs from piped stdin without a checkout and pins the latest release", () => {
    fakeDownloads();
    const result = pipeInstall();
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(envValue("TIMEWREN_VERSION")).toBe("v1.2.3");
    const downloads = readFileSync(join(dir, "downloads.log"), "utf8");
    expect(downloads).toContain("/v1.2.3/docker-compose.yml");
    expect(downloads).toContain("/v1.2.3/.env.example");
    expect(readFileSync(log, "utf8")).not.toContain("--build");
  });

  it("downloads an explicit release and optional Caddy overlay with no prompts", () => {
    fakeDownloads();
    const result = pipeInstall([
      "--version",
      "v2.3.4",
      "--with-caddy",
      "--domain",
      "time.example",
      "--no-start",
    ]);
    expect(result.status).toBe(0);
    expect(envValue("NEXT_PUBLIC_APP_URL")).toBe("https://time.example");
    expect(envValue("COMPOSE_FILE")).toBe(
      "docker-compose.yml:docker-compose.caddy.yml",
    );
    const downloads = readFileSync(join(dir, "downloads.log"), "utf8");
    expect(downloads).not.toContain("releases/latest");
    expect(downloads).toContain("/v2.3.4/docker-compose.caddy.yml");
  });

  it("does not start or create secrets when downloading fails", () => {
    fakeDownloads(true);
    const result = pipeInstall(["--version", "v1.2.3"]);
    expect(result.status).not.toBe(0);
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(readFileSync(log, "utf8")).not.toContain("compose up");
  });

  it("honors --dir even when invoked from a checkout", () => {
    fakeDownloads();
    const target = join(dir, "standalone");
    const result = run(["--dir", target, "--version", "v1.2.3", "--no-start"]);
    expect(result.status).toBe(0);
    expect(existsSync(join(target, ".env"))).toBe(true);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it.each([
    ["--port", "0"],
    ["--port", "65536"],
    ["--version", "../main"],
    ["--with-caddy"],
    ["--url", "https://host\nCRON_SECRET=injected"],
    ["--unknown"],
  ])("rejects invalid arguments %j", (...args) => {
    expect(run(args).status).not.toBe(0);
    expect(existsSync(join(dir, ".env"))).toBe(false);
  });

  it("shows help when executed through stdin", () => {
    expect(pipeInstall(["--help"]).stdout).toContain("--version");
  });
  it("creates .env with four distinct 64-hex secrets, mode 600, and starts the stack", () => {
    const r = run();
    expect(r.status).toBe(0);
    const values = SECRET_KEYS.map((k) => envValue(k));
    for (const v of values) expect(v).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(values).size).toBe(4);
    expect(statSync(join(dir, ".env")).mode & 0o777).toBe(0o600);
    expect(readFileSync(log, "utf8")).toContain("compose pull");
    expect(readFileSync(log, "utf8")).toContain("compose up -d");
    expect(r.stdout).toContain("TimeWren is running");
  });

  it("never prints a secret to the terminal", () => {
    const r = run();
    expect(r.status).toBe(0);
    const out = r.stdout + r.stderr;
    for (const k of SECRET_KEYS) {
      expect(out).not.toContain(envValue(k) as string);
    }
    // Nor does it leave temp files with secrets behind.
    expect(existsSync(join(dir, ".env"))).toBe(true);
    const leftovers = spawnSync("sh", ["-c", "ls -A"], {
      cwd: dir,
      encoding: "utf8",
    }).stdout;
    expect(leftovers).not.toMatch(/^\.env\.[A-Za-z0-9]{6}$/m);
  });

  it("is idempotent: a second run keeps the existing .env byte for byte", () => {
    expect(run().status).toBe(0);
    const before = sha(join(dir, ".env"));
    const r = run(["--url", "https://other.example"]);
    expect(r.status).toBe(0);
    expect(sha(join(dir, ".env"))).toBe(before);
    expect(r.stdout).toContain("leaving it untouched");
  });

  it("does not overwrite a hand-written .env", () => {
    const own =
      "POSTGRES_PASSWORD=a\nBETTER_AUTH_SECRET=b\nENCRYPTION_KEY=c\nCRON_SECRET=d\n";
    writeFileSync(join(dir, ".env"), own);
    expect(run().status).toBe(0);
    expect(readFileSync(join(dir, ".env"), "utf8")).toBe(own);
  });

  it("refuses an existing .env with an empty required secret", () => {
    writeFileSync(
      join(dir, ".env"),
      "POSTGRES_PASSWORD=\nBETTER_AUTH_SECRET=b\nENCRYPTION_KEY=c\nCRON_SECRET=d\n",
    );
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("POSTGRES_PASSWORD");
    expect(readFileSync(log, "utf8")).not.toContain("compose up");
  });

  it("applies --url and --port only when creating .env", () => {
    expect(
      run(["--url", "https://tt.example/", "--port", "8081", "--no-start"])
        .status,
    ).toBe(0);
    expect(envValue("NEXT_PUBLIC_APP_URL")).toBe("https://tt.example");
    expect(envValue("APP_PORT")).toBe("8081");
    expect(
      existsSync(log) && readFileSync(log, "utf8").includes("compose up"),
    ).toBe(false);
  });

  it("derives the URL from --port when --url is missing", () => {
    expect(run(["--port", "8080", "--no-start"]).status).toBe(0);
    expect(envValue("APP_PORT")).toBe("8080");
    expect(envValue("NEXT_PUBLIC_APP_URL")).toBe("http://localhost:8080");
  });

  it("falls back to /dev/urandom when openssl is missing", () => {
    rmSync(join(bin, "openssl"));
    expect(run(["--no-start"]).status).toBe(0);
    for (const k of [
      "POSTGRES_PASSWORD",
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "CRON_SECRET",
    ]) {
      expect(envValue(k)).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  it("fails with the app logs when the container keeps restarting", () => {
    installFakeDocker({ health: "restarting" });
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("restarting");
  });

  it("stops with install guidance, creates no .env and never calls sudo when Docker is missing", () => {
    rmSync(join(bin, "docker"));
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Docker is not installed");
    expect(r.stderr + r.stdout).toContain("docs.docker.com");
    expect(existsSync(join(dir, ".env"))).toBe(false);
    expect(readFileSync(join(dir, "scripts/install.sh"), "utf8")).not.toMatch(
      /^\s*sudo /m,
    );
  });

  it("rejects Compose older than 2.24 and accepts v-prefixed newer versions", () => {
    installFakeDocker({ compose: "2.23.9" });
    const old = run();
    expect(old.status).not.toBe(0);
    expect(old.stderr).toContain("too old");
    expect(existsSync(join(dir, ".env"))).toBe(false);

    installFakeDocker({ compose: "v2.24.0" });
    expect(run().status).toBe(0);
  });

  it("explains an unreachable Docker daemon", () => {
    installFakeDocker({ daemon: false });
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Docker daemon");
  });

  it("reports unhealthy without dumping potentially sensitive app logs", () => {
    installFakeDocker({ health: "unhealthy" });
    const r = run();
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("unhealthy");
    expect(r.stderr).toContain("docker compose logs");
    expect(readFileSync(log, "utf8")).not.toContain("compose logs");
  });

  it("times out when the app never becomes healthy", () => {
    installFakeDocker({ health: "starting" });
    const r = run(["--timeout", "0"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toContain("Timed out");
  });
});
