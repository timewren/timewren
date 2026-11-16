import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { devEnv, initDevEnv } from "./dev-init.mjs";

const dirs: string[] = [];
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "dev-init-"));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("dev-init", () => {
  it("sets every variable the app needs, with a 64-hex ENCRYPTION_KEY", () => {
    const env = devEnv();
    for (const key of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "CRON_SECRET",
      "NEXT_PUBLIC_APP_URL",
    ]) {
      expect(env).toMatch(new RegExp(`^${key}=\\S+$`, "m"));
    }
    expect(env).toMatch(/^ENCRYPTION_KEY=[0-9a-f]{64}$/m);
  });

  it("generates different secrets each run", () => {
    expect(devEnv()).not.toBe(devEnv());
  });

  it("never overwrites an existing .env.local", () => {
    const dir = tmp();
    writeFileSync(join(dir, ".env.local"), "KEEP=1\n");
    expect(initDevEnv(dir).created).toBe(false);
    expect(readFileSync(join(dir, ".env.local"), "utf8")).toBe("KEEP=1\n");
  });

  it("creates the file when missing", () => {
    const dir = tmp();
    expect(initDevEnv(dir).created).toBe(true);
    expect(readFileSync(join(dir, ".env.local"), "utf8")).toContain(
      "BETTER_AUTH_SECRET=",
    );
  });

  // Regressionstest (#1114): entrypoint-tjekket sammenlignede en rå
  // `file://`-streng med argv[1] og blev aldrig sandt på Windows (drevbogstav,
  // backslashes) eller ved mellemrum/specialtegn i stien. Mellemrum rammer
  // samme fejl på Linux.
  it("runs as a script from a path with spaces and writes .env.local", () => {
    const root = tmp();
    const scripts = join(root, "my project", "scripts");
    mkdirSync(scripts, { recursive: true });
    const src = join(dirname(fileURLToPath(import.meta.url)), "dev-init.mjs");
    copyFileSync(src, join(scripts, "dev-init.mjs"));
    const res = spawnSync(process.execPath, [join(scripts, "dev-init.mjs")], {
      encoding: "utf8",
    });
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("Created .env.local");
    expect(existsSync(join(root, "my project", ".env.local"))).toBe(true);
  });
});
