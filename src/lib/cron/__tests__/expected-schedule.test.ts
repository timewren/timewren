import { describe, expect, it } from "vitest";
import {
  EXPECTED_INTERVAL_MINUTES,
  EXPECTED_JOB_NAMES,
  formatExpectedInterval,
  isJobSilent,
} from "@/lib/cron/expected-schedule";

// ─── isJobSilent ──────────────────────────────────────────────────────────────

describe("isJobSilent", () => {
  it("returns true when job has never run (null lastRunAt)", () => {
    expect(isJobSilent("import", null)).toBe(true);
    expect(isJobSilent("daily-digest", null)).toBe(true);
  });

  it("returns false when job ran within 2× its expected interval", () => {
    // "import" expects 2 min → silent threshold is 4 min
    const fourMinutesAgo = new Date(Date.now() - 3.5 * 60 * 1000); // 3.5 min ago — within threshold
    expect(isJobSilent("import", fourMinutesAgo)).toBe(false);
  });

  it("returns true when job last ran more than 2× its expected interval ago", () => {
    // "import" expects 2 min → threshold is 4 min
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    expect(isJobSilent("import", fiveMinutesAgo)).toBe(true);
  });

  it("handles daily jobs correctly — not silent if ran today", () => {
    // "daily-digest" expects 24 * 60 min → threshold is 48 h
    const twentyHoursAgo = new Date(Date.now() - 20 * 60 * 60 * 1000);
    expect(isJobSilent("daily-digest", twentyHoursAgo)).toBe(false);
  });

  it("marks daily job silent if last run was 3 days ago", () => {
    const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
    expect(isJobSilent("daily-digest", threeDaysAgo)).toBe(true);
  });

  it("handles fast-interval jobs (timer-cleanup at 5 min) correctly", () => {
    // threshold = 2 × 5 = 10 min
    // 11 minutes ago → exceeds threshold → silent
    const elevenMinutesAgo = new Date(Date.now() - 11 * 60 * 1000);
    expect(isJobSilent("timer-cleanup", elevenMinutesAgo)).toBe(true);

    // 8 minutes ago → within 10-min threshold → not silent
    const eightMinutesAgo = new Date(Date.now() - 8 * 60 * 1000);
    expect(isJobSilent("timer-cleanup", eightMinutesAgo)).toBe(false);

    const threeMinutesAgo = new Date(Date.now() - 3 * 60 * 1000);
    expect(isJobSilent("timer-cleanup", threeMinutesAgo)).toBe(false);
  });

  it("treats unknown job names as never silent", () => {
    // Et ukendt jobnavn har intet forventet interval, så vi kan ikke sige at
    // det er tavst — uanset hvor længe siden det kørte, og uanset om det
    // aldrig har kørt. Ellers ville en stavefejl i et jobnavn give alarm.
    expect(isJobSilent("unknown-job", new Date())).toBe(false);
    expect(isJobSilent("unknown-job", new Date(Date.now() - 86_400_000))).toBe(
      false,
    );
    expect(isJobSilent("unknown-job", null)).toBe(false);
  });
});

// ─── EXPECTED_INTERVAL_MINUTES ────────────────────────────────────────────────

describe("EXPECTED_INTERVAL_MINUTES", () => {
  it("contains all 47 expected job names", () => {
    expect(EXPECTED_JOB_NAMES).toHaveLength(47);
    expect(EXPECTED_INTERVAL_MINUTES["compliance-forecast"]).toBe(7 * 24 * 60);
  });

  it("has the monthly budget alerts (#592)", () => {
    expect(EXPECTED_INTERVAL_MINUTES["budget-alerts"]).toBe(24 * 60);
  });

  it("has the daily scheduled rate change job", () => {
    expect(EXPECTED_INTERVAL_MINUTES["scheduled-rates"]).toBe(24 * 60);
  });

  it("has the enterprise vacation jobs (#461)", () => {
    expect(EXPECTED_INTERVAL_MINUTES["vacation-accrual"]).toBe(31 * 24 * 60);
    expect(EXPECTED_INTERVAL_MINUTES["vacation-year-rollover"]).toBe(24 * 60);
  });

  it("has the daily period-closing job (#518)", () => {
    expect(EXPECTED_INTERVAL_MINUTES["period-closing"]).toBe(24 * 60);
  });

  it("has the daily Alunta duplicate-subscription reconciliation", () => {
    expect(EXPECTED_INTERVAL_MINUTES["alunta-duplicate-subs"]).toBe(24 * 60);
  });

  it("has 'migration-drift' at hourly", () => {
    expect(EXPECTED_INTERVAL_MINUTES["migration-drift"]).toBe(60);
  });

  it("has positive intervals for every job", () => {
    for (const [jobName, minutes] of Object.entries(
      EXPECTED_INTERVAL_MINUTES,
    )) {
      expect(
        minutes,
        `${jobName} should have positive interval`,
      ).toBeGreaterThan(0);
    }
  });

  it("has 'import' at 2 minutes", () => {
    expect(EXPECTED_INTERVAL_MINUTES.import).toBe(2);
  });

  it("has 'weekly-summary' at 7 days", () => {
    expect(EXPECTED_INTERVAL_MINUTES["weekly-summary"]).toBe(7 * 24 * 60);
  });

  it("has 'monthly-summary' at 30 days", () => {
    expect(EXPECTED_INTERVAL_MINUTES["monthly-summary"]).toBe(30 * 24 * 60);
  });
});

// ─── formatExpectedInterval ───────────────────────────────────────────────────

describe("formatExpectedInterval", () => {
  it("formats sub-hour intervals as 'hvert X min'", () => {
    expect(formatExpectedInterval(2)).toBe("hvert 2 min");
    expect(formatExpectedInterval(5)).toBe("hvert 5 min");
    expect(formatExpectedInterval(15)).toBe("hvert 15 min");
  });

  it("formats exactly 60 min as 'hver time'", () => {
    expect(formatExpectedInterval(60)).toBe("hver time");
  });

  it("formats 4 hours as 'hver 4. time'", () => {
    expect(formatExpectedInterval(4 * 60)).toBe("hver 4. time");
  });

  it("formats daily as 'dagligt'", () => {
    expect(formatExpectedInterval(24 * 60)).toBe("dagligt");
  });

  it("formats weekly as 'ugentligt'", () => {
    expect(formatExpectedInterval(7 * 24 * 60)).toBe("ugentligt");
  });

  it("formats 30+ days as 'månedligt'", () => {
    expect(formatExpectedInterval(30 * 24 * 60)).toBe("månedligt");
  });
});

// ─── getCronJobsOverview logic ─────────────────────────────────────────────────
// We can't call the tRPC procedure directly (it needs a DB), but we can test
// the core aggregation/flagging logic in isolation.

describe("getCronJobsOverview — aggregation logic", () => {
  // Simulate what the procedure does to compute per-job results

  type MockJobData = {
    jobName: string;
    lastRunAt: Date | null;
    runsLast24h: number;
    errorsLast24h: number;
    avgDurationMs: number | null;
  };

  function computeOverviewRow(data: MockJobData) {
    return {
      ...data,
      isSilent: isJobSilent(data.jobName, data.lastRunAt),
      isEverRun: data.lastRunAt !== null,
    };
  }

  it("job with no runs → isSilent=true, isEverRun=false", () => {
    const row = computeOverviewRow({
      jobName: "import",
      lastRunAt: null,
      runsLast24h: 0,
      errorsLast24h: 0,
      avgDurationMs: null,
    });
    expect(row.isSilent).toBe(true);
    expect(row.isEverRun).toBe(false);
  });

  it("job with recent run → isSilent=false, isEverRun=true", () => {
    const oneMinuteAgo = new Date(Date.now() - 60_000);
    const row = computeOverviewRow({
      jobName: "import",
      lastRunAt: oneMinuteAgo,
      runsLast24h: 700,
      errorsLast24h: 0,
      avgDurationMs: 42,
    });
    expect(row.isSilent).toBe(false);
    expect(row.isEverRun).toBe(true);
  });

  it("job with last run older than 2× interval → isSilent=true", () => {
    // import expects 2 min, threshold 4 min
    const tenMinutesAgo = new Date(Date.now() - 10 * 60_000);
    const row = computeOverviewRow({
      jobName: "import",
      lastRunAt: tenMinutesAgo,
      runsLast24h: 5,
      errorsLast24h: 0,
      avgDurationMs: 80,
    });
    expect(row.isSilent).toBe(true);
    expect(row.isEverRun).toBe(true);
  });

  it("error counting passes through correctly", () => {
    const twoMinutesAgo = new Date(Date.now() - 2 * 60_000);
    const row = computeOverviewRow({
      jobName: "timer-cleanup",
      lastRunAt: twoMinutesAgo,
      runsLast24h: 250,
      errorsLast24h: 12,
      avgDurationMs: 130,
    });
    expect(row.errorsLast24h).toBe(12);
    expect(row.runsLast24h).toBe(250);
    expect(row.isSilent).toBe(false);
  });
});
