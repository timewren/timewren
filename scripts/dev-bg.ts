import { spawn } from "node:child_process";
import { mkdirSync, openSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const cwd = process.cwd();
const nextDir = resolve(cwd, ".next");
mkdirSync(nextDir, { recursive: true });

const pidPath = resolve(nextDir, "dev.pid");
const logPath = resolve(nextDir, "dev.log");
const fd = openSync(logPath, "w");

// spawn via shell with output piped to file descriptor
const child = spawn(
  process.platform === "win32" ? "cmd" : "sh",
  process.platform === "win32"
    ? ["/c", "npx next dev"]
    : ["-c", "npx next dev"],
  {
    detached: true,
    stdio: ["ignore", fd, fd],
    cwd,
  },
);

child.unref();
writeFileSync(pidPath, String(child.pid));

console.log(`🚀 Dev server starting in background (PID: ${child.pid})`);
console.log(`   Log:  tail -f .next/dev.log`);
console.log("   Stop: npm run dev:stop");
console.log("   URL:  http://localhost:3000");
