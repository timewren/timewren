import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { createServer } from "node:net";
import { checkCloudResponses } from "./check-cloud";
import { captureTimewren } from "./timewren";

// One foreground supervisor owns both child processes and always stops them.
async function run() {
  if (
    [".env", ".env.local", ".env.development", ".env.development.local"].some(
      (file) => existsSync(file),
    )
  )
    throw new Error(
      "Use a clean checkout without Next.js .env files for the isolated capture run",
    );
  const name = `timewren-screens-${process.pid}`;
  const password = randomBytes(24).toString("hex");
  const database = spawn(
    "docker",
    [
      "run",
      "--rm",
      "--name",
      name,
      "-p",
      "127.0.0.1::5432",
      "-e",
      "POSTGRES_PASSWORD",
      "-e",
      "POSTGRES_DB=timewren_screenshots",
      "postgres:18-alpine",
    ],
    { env: { ...process.env, POSTGRES_PASSWORD: password }, stdio: "ignore" },
  );
  let server: ReturnType<typeof spawn> | undefined;
  const cleanup = () => {
    if (server?.pid) {
      try {
        process.kill(-server.pid, "SIGTERM");
      } catch {}
    }
    spawnSync("docker", ["stop", "--time", "5", name], { stdio: "ignore" });
  };
  process.once("SIGINT", () => {
    cleanup();
    process.exit(130);
  });
  process.once("SIGTERM", () => {
    cleanup();
    process.exit(143);
  });
  try {
    let port = "";
    for (let n = 0; n < 60; n++) {
      const mapped = spawnSync("docker", ["port", name, "5432"], {
        encoding: "utf8",
      });
      port = mapped.stdout?.trim().split(":").pop() ?? "";
      if (
        port &&
        spawnSync("docker", ["exec", name, "pg_isready", "-U", "postgres"], {
          stdio: "ignore",
        }).status === 0
      )
        break;
      if (database.exitCode !== null)
        throw new Error("Local PostgreSQL exited");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!port) throw new Error("Local PostgreSQL did not start");
    const socket = createServer();
    await new Promise<void>((resolve) =>
      socket.listen(0, "127.0.0.1", resolve),
    );
    const address = socket.address();
    if (!address || typeof address === "string")
      throw new Error("No local HTTP port");
    const httpPort = address.port;
    await new Promise<void>((resolve) => socket.close(() => resolve()));
    process.env.DATABASE_URL = `postgres://postgres:${password}@127.0.0.1:${port}/timewren_screenshots`;
    process.env.SCREENSHOT_BASE_URL = `http://127.0.0.1:${httpPort}`;
    const schema = spawnSync(
      "node_modules/.bin/drizzle-kit",
      ["push", "--force"],
      { env: process.env, encoding: "utf8", timeout: 120000 },
    );
    if (schema.status !== 0) {
      const detail = (schema.stderr || schema.stdout || "")
        .replaceAll(password, "[redacted]")
        .slice(-1500);
      throw new Error(
        `Could not initialise disposable database schema (status ${schema.status}, signal ${schema.signal}): ${detail}`,
      );
    }
    for (const brand of ["timetrack", "timewren"]) {
      server = spawn(
        "node_modules/.bin/next",
        ["dev", "--hostname", "127.0.0.1", "--port", String(httpPort)],
        {
          detached: true,
          stdio: ["ignore", "pipe", "pipe"],
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            NODE_ENV: "development",
            DATABASE_URL: process.env.DATABASE_URL,
            BETTER_AUTH_SECRET: randomBytes(32).toString("hex"),
            NEXT_PUBLIC_APP_URL: process.env.SCREENSHOT_BASE_URL,
            NEXT_PUBLIC_BRAND: brand,
            MULTIBRAND_ENABLED: "1",
            TIMEWREN_APP_ENABLED: "1",
            MAIL_TRANSPORT: "log",
            NEXT_TELEMETRY_DISABLED: "1",
          },
        },
      );
      let ready = false;
      let log = "";
      server.stdout?.on("data", (chunk) => {
        log = (log + chunk.toString()).slice(-6000);
        if (log.includes("Ready in")) ready = true;
        for (const line of chunk.toString().split("\n")) {
          if (/Compiling|Compiled/.test(line))
            console.log(line.replaceAll(password, "[redacted]"));
        }
      });
      server.stderr?.on("data", (chunk) => {
        log = (log + chunk.toString()).slice(-6000);
        for (const line of chunk.toString().split("\n")) {
          if (/Error:|Compiling|Compiled/.test(line))
            console.error(line.replaceAll(password, "[redacted]"));
        }
      });
      for (let n = 0; n < 90 && !ready; n++) {
        if (server.exitCode !== null)
          throw new Error("Local Next.js server exited");
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!ready) throw new Error("Local Next.js startup timed out");
      if (brand === "timetrack") {
        await checkCloudResponses(process.env.SCREENSHOT_BASE_URL);
        console.log(
          "Cloud HTTP isolation: docs/install return 404; llms.txt serves TimeTrack content.",
        );
        const stopped = new Promise<void>((resolve) =>
          server?.once("exit", () => resolve()),
        );
        if (!server.pid) throw new Error("Cloud dev server has no process ID");
        process.kill(-server.pid, "SIGTERM");
        await stopped;
        server = undefined;
      } else {
        console.log("Local database and TimeWren dev server ready.");
        await captureTimewren();
      }
    }
  } finally {
    cleanup();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
