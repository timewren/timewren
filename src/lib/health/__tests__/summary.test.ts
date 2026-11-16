import { describe, expect, it } from "vitest";
import {
  isWatchFresh,
  summarizeCron,
  summarizeRealtime,
  WATCH_STALE_AFTER_MINUTES,
} from "../summary";

const now = new Date("2026-10-03T12:00:00Z");

describe("summarizeRealtime", () => {
  const base = {
    enabled: true,
    configured: true,
    subscribed: true,
    lastMessageAt: new Date("2026-10-03T11:59:30Z"),
    lastPublishAt: null,
  };

  it("abonneret er ok og viser alder i sekunder", () => {
    expect(summarizeRealtime(base, now)).toEqual({
      status: "ok",
      subscribed: true,
      lastMessageAgeSeconds: 30,
      lastPublishAgeSeconds: null,
    });
  });

  it("ikke abonneret er degraded", () => {
    expect(summarizeRealtime({ ...base, subscribed: false }, now).status).toBe(
      "degraded",
    );
  });

  it("slået fra eller uden Valkey er disabled", () => {
    expect(summarizeRealtime({ ...base, enabled: false }, now).status).toBe(
      "disabled",
    );
    expect(summarizeRealtime({ ...base, configured: false }, now).status).toBe(
      "disabled",
    );
  });
});

describe("summarizeCron", () => {
  it("finder tavse job og aldre", () => {
    const res = summarizeCron(
      [
        {
          jobName: "timer-cleanup",
          lastRunAt: new Date("2026-10-03T11:58:00Z"),
        },
        { jobName: "import", lastRunAt: new Date("2026-10-03T11:00:00Z") },
      ],
      { "timer-cleanup": 5, import: 2, "daily-digest": 1440 },
      now,
    );
    expect(res.status).toBe("degraded");
    expect(res.staleJobs.sort()).toEqual(["daily-digest", "import"]);
    expect(res.lastRunAgeSeconds["timer-cleanup"]).toBe(120);
    expect(res.lastRunAgeSeconds["daily-digest"]).toBeNull();
  });
});

// Dead-man's switch: hvis vagten selv dør, skal en ekstern check opdage det
describe("isWatchFresh", () => {
  it("frisk når vagten har kørt inden for 45 min", () => {
    expect(WATCH_STALE_AFTER_MINUTES).toBe(45);
    expect(isWatchFresh(new Date("2026-10-03T11:20:00Z"), now)).toBe(true);
  });

  it("forældet efter 45 min eller hvis den aldrig er set", () => {
    expect(isWatchFresh(new Date("2026-10-03T11:10:00Z"), now)).toBe(false);
    expect(isWatchFresh(null, now)).toBe(false);
  });
});
