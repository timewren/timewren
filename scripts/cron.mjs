#!/usr/bin/env node
// Read the existing crontab as data; never execute its shell commands.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export const jobs = [
  ...readFileSync(
    new URL("../cron/entrypoint.sh", import.meta.url),
    "utf8",
  ).matchAll(/^([\d*,/ -]+) curl .*\/api\/cron\/([a-z-]+)$/gm),
].map(([, schedule, endpoint]) => ({ schedule: schedule.trim(), endpoint }));

function matches(field, value) {
  return field.split(",").some((part) => {
    if (part === "*") return true;
    if (part.startsWith("*/")) return value % Number(part.slice(2)) === 0;
    if (part.includes("-")) {
      const [min, max] = part.split("-").map(Number);
      return value >= min && value <= max;
    }
    return Number(part) === value;
  });
}

export function due(schedule, date, timeZone = "Europe/Copenhagen") {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    minute: "numeric",
    hour: "numeric",
    hourCycle: "h23",
    day: "numeric",
    month: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (key) => parts.find((part) => part.type === key)?.value;
  const values = [
    Number(get("minute")),
    Number(get("hour")),
    Number(get("day")),
    Number(get("month")),
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
  ];
  return schedule.split(/\s+/).every((field, i) => matches(field, values[i]));
}

const running = new Set();
export async function runDue(date = new Date(), fetcher = fetch) {
  const { APP_URL, CRON_SECRET } = process.env;
  if (!APP_URL || !CRON_SECRET)
    throw new Error("APP_URL and CRON_SECRET are required");
  const results = await Promise.all(
    jobs
      .filter((job) => due(job.schedule, date))
      .map(async (job) => {
        if (running.has(job.endpoint)) return true;
        running.add(job.endpoint);
        try {
          const response = await fetcher(
            new URL(`/api/cron/${job.endpoint}`, APP_URL),
            {
              headers: { Authorization: `Bearer ${CRON_SECRET}` },
              signal: AbortSignal.timeout(300_000),
              redirect: "error",
            },
          );
          await response.body?.cancel();
          if (!response.ok) throw new Error("request failed");
          return true;
        } catch {
          // Never log response bodies, auth headers, URLs or exception details.
          console.error(`Cron failed: ${job.endpoint}`);
          return false;
        } finally {
          running.delete(job.endpoint);
        }
      }),
  );
  return results.every(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  if (!process.env.APP_URL || !process.env.CRON_SECRET) {
    console.error("APP_URL and CRON_SECRET are required");
    process.exitCode = 1;
  } else if (process.argv.includes("--once")) {
    if (!(await runDue())) process.exitCode = 1;
  } else {
    // Align to wall-clock minutes, without starting a job again while it runs.
    const tick = () => {
      void runDue();
      setTimeout(tick, 60_000 - (Date.now() % 60_000));
    };
    tick();
  }
}
