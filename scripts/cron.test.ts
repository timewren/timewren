import { afterEach, describe, expect, it, vi } from "vitest";
import { due, jobs, runDue } from "./cron.mjs";

afterEach(() => vi.unstubAllEnvs());

describe("portable image scheduler", () => {
  it("loads all endpoint schedules from the original crontab", () => {
    expect(jobs).toHaveLength(47);
    expect(jobs).toContainEqual({
      schedule: "*/2 * * * *",
      endpoint: "data-export",
    });
    expect(jobs).toContainEqual({
      schedule: "15 4 1 * *",
      endpoint: "vacation-accrual",
    });
  });
  it("uses Copenhagen wall clock including summer time and weekday ranges", () => {
    expect(due("30 8 * * 1-5", new Date("2026-07-06T06:30:00Z"))).toBe(true);
    expect(due("30 8 * * 1-5", new Date("2026-07-05T06:30:00Z"))).toBe(false);
    expect(due("30 8 * * 1-5", new Date("2026-01-05T07:30:00Z"))).toBe(true);
    expect(due("*/5 * * * *", new Date("2026-07-06T06:31:00Z"))).toBe(false);
  });
  it("calls only due jobs with auth and forbids credential forwarding redirects", async () => {
    vi.stubEnv("APP_URL", "http://app:3000");
    vi.stubEnv("CRON_SECRET", "fixture-cron-auth");
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 200 }),
    );
    expect(await runDue(new Date("2026-07-06T06:02:00Z"), fetcher)).toBe(true);
    expect(fetcher.mock.calls.map((call) => String(call[0]))).toEqual([
      "http://app:3000/api/cron/data-export",
      "http://app:3000/api/cron/import",
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        headers: { Authorization: "Bearer fixture-cron-auth" },
        redirect: "error",
      }),
    );
  });
  it.each([
    ["2026-07-06T06:00:00Z", "daily-digest", true],
    ["2026-07-06T08:00:00Z", "daily-digest", false],
    ["2026-01-05T07:00:00Z", "daily-digest", true],
    ["2026-07-05T22:05:00Z", "scheduled-rates", true],
  ])(
    "keeps Copenhagen cron time with TZ=UTC at %s",
    async (date, endpoint, expected) => {
      vi.stubEnv("TZ", "UTC");
      vi.stubEnv("APP_URL", "http://app:3000");
      vi.stubEnv("CRON_SECRET", "fixture-cron-auth");
      const fetcher = vi.fn<typeof fetch>(
        async () => new Response(null, { status: 200 }),
      );
      expect(await runDue(new Date(date), fetcher)).toBe(true);
      const endpoints = fetcher.mock.calls.map(
        (call) => new URL(call[0] as URL).pathname,
      );
      expect(endpoints.includes(`/api/cron/${endpoint}`)).toBe(expected);
    },
  );
});
