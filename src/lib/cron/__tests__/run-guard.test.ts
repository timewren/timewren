import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
const limit = vi.fn();
const returning = vi.fn();

const tx = {
  execute,
  select: () => ({ from: () => ({ where: () => ({ limit }) }) }),
  insert: () => ({ values: () => ({ returning }) }),
};

vi.mock("@/lib/db", () => ({
  db: { transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
}));
vi.mock("@/lib/db/schema", () => ({
  cronJobLogs: {
    id: "id",
    jobName: "job_name",
    status: "status",
    startedAt: "started_at",
  },
}));

const { startCronRun, CRON_RUN_STALE_AFTER_MS } = await import(
  "@/lib/cron/run-guard"
);

describe("startCronRun", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("takes the advisory lock and inserts a running row when idle", async () => {
    limit.mockResolvedValue([]);
    returning.mockResolvedValue([{ id: "run-1" }]);
    await expect(startCronRun("job", new Date())).resolves.toBe("run-1");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(returning).toHaveBeenCalledTimes(1);
  });

  it("returns null and inserts nothing while another run is in flight", async () => {
    limit.mockResolvedValue([{ id: "run-0" }]);
    await expect(startCronRun("job", new Date())).resolves.toBeNull();
    expect(returning).not.toHaveBeenCalled();
  });

  it("treats a run as dead shortly after curl's --max-time 300", () => {
    expect(CRON_RUN_STALE_AFTER_MS).toBeGreaterThan(300 * 1000);
    expect(CRON_RUN_STALE_AFTER_MS).toBeLessThanOrEqual(6 * 60 * 1000);
  });
});
