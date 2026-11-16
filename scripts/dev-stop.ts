import { execSync } from "node:child_process";
import { readFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

const pidPath = resolve(process.cwd(), ".next", "dev.pid");

try {
  const pid = readFileSync(pidPath, "utf-8").trim();

  if (process.platform === "win32") {
    // /T kills the entire process tree, /F forces it
    execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
  } else {
    process.kill(Number.parseInt(pid, 10));
  }

  unlinkSync(pidPath);
  console.log(`🛑 Dev server stopped (PID: ${pid})`);
} catch (err: unknown) {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ENOENT") {
    console.log("ℹ️  No dev server running (.next/dev.pid not found)");
  } else {
    // Process may already be gone, clean up pid file
    try {
      unlinkSync(pidPath);
    } catch {}
    console.log("ℹ️  Process already stopped, cleaned up pid file");
  }
}
