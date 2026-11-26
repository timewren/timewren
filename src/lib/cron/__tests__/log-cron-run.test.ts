import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Mock DB ---
const mockInsert = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  db: {
    insert: () => ({
      values: () => ({
        returning: mockInsert,
      }),
    }),
    update: () => ({
      set: () => ({
        where: mockUpdate,
      }),
    }),
  },
}));

vi.mock("@/lib/cron/run-guard", () => ({
  startCronRun: async () => {
    const [row] = await mockInsert();
    return row?.id ?? null;
  },
}));

vi.mock("@/lib/db/schema", () => ({
  cronJobLogs: { id: "id" },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((col, val) => ({ col, val })),
}));

const mockCapture = vi.fn();
vi.mock("@/lib/utils/sentry", () => ({
  captureRouteError: (...args: unknown[]) => mockCapture(...args),
}));

// Import after mocks are set up
const { withCronLogging } = await import("@/lib/cron/log-cron-run");

const LOG_ROW_ID = "test-log-id-123";

function makeRequest(authHeader?: string): Request {
  return new Request("http://localhost/api/cron/test", {
    headers: authHeader ? { authorization: authHeader } : {},
  });
}

describe("withCronLogging", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    process.env.CRON_SECRET = "secret123";
    // Default: insert returns a log row
    mockInsert.mockResolvedValue([{ id: LOG_ROW_ID }]);
    mockUpdate.mockResolvedValue([]);
  });

  afterEach(() => {
    delete process.env.CRON_SECRET;
  });

  it("skips the run with 200 while the previous run is still going", async () => {
    mockInsert.mockResolvedValue([]);
    const inner = vi.fn(async () => ({ itemsProcessed: 1 }));
    const handler = withCronLogging("test-job", inner);
    const res = await handler(makeRequest("Bearer secret123"));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ skipped: true });
    expect(inner).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("skips a second run in the same process even when the DB row looks dead", async () => {
    // The DB guard regards a "running" row older than 330 s as a crashed
    // run, but curl's --max-time does not stop the handler on the server.
    // A long job must still not run twice side by side in this process.
    let finish!: () => void;
    const inner = vi.fn(
      () =>
        new Promise<{ itemsProcessed: number }>((resolve) => {
          finish = () => resolve({ itemsProcessed: 1 });
        }),
    );
    const handler = withCronLogging("long-job", inner);
    const first = handler(makeRequest("Bearer secret123"));
    await vi.waitFor(() => expect(inner).toHaveBeenCalledTimes(1));

    const second = await handler(makeRequest("Bearer secret123"));
    expect(await second.json()).toMatchObject({ skipped: true });
    expect(inner).toHaveBeenCalledTimes(1);

    finish();
    expect((await first).status).toBe(200);
    // Released again once the first run is done
    const third = handler(makeRequest("Bearer secret123"));
    await vi.waitFor(() => expect(inner).toHaveBeenCalledTimes(2));
    finish();
    expect((await third).status).toBe(200);
  });

  it("releases the in-process guard when the job throws", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const inner = vi
      .fn()
      .mockRejectedValueOnce(new Error("first fails"))
      .mockResolvedValueOnce({ itemsProcessed: 1 });
    const handler = withCronLogging("flaky-job", inner);
    expect((await handler(makeRequest("Bearer secret123"))).status).toBe(500);
    expect((await handler(makeRequest("Bearer secret123"))).status).toBe(200);
    expect(inner).toHaveBeenCalledTimes(2);
    errorSpy.mockRestore();
  });

  it("logs a thrown error once, with the job name and duration", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const handler = withCronLogging("log-job", async () => {
      throw new Error("kunne ikke");
    });
    await handler(makeRequest("Bearer secret123"));
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0][0])).toMatch(
      /\[Cron\] log-job failed after \d+ ms/,
    );
    errorSpy.mockRestore();
  });

  it("rejects requests with no auth header", async () => {
    const handler = withCronLogging("test-job", async () => ({
      itemsProcessed: 1,
    }));
    const res = await handler(makeRequest());
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("Unauthorized");
    // Should not insert a log row
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects requests with wrong auth header", async () => {
    const handler = withCronLogging("test-job", async () => ({
      itemsProcessed: 1,
    }));
    const res = await handler(makeRequest("Bearer wrong-secret"));
    expect(res.status).toBe(401);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 500 when CRON_SECRET is not set", async () => {
    delete process.env.CRON_SECRET;
    const handler = withCronLogging("test-job", async () => ({
      itemsProcessed: 1,
    }));
    const res = await handler(makeRequest("Bearer secret123"));
    expect(res.status).toBe(500);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("logs start + success when handler returns CronRunResult", async () => {
    const handler = withCronLogging("my-job", async () => ({
      itemsProcessed: 10,
      itemsSucceeded: 10,
      itemsFailed: 0,
    }));

    const res = await handler(makeRequest("Bearer secret123"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.jobName).toBe("my-job");
    expect(body.itemsProcessed).toBe(10);
    expect(body.itemsSucceeded).toBe(10);
    expect(body.itemsFailed).toBe(0);

    // Insert was called (log row created)
    expect(mockInsert).toHaveBeenCalledOnce();
    // Update was called with status: 'success'
    expect(mockUpdate).toHaveBeenCalledOnce();
  });

  it("marks status=partial when itemsFailed > 0", async () => {
    let capturedSetArgs: Record<string, unknown> | null = null;

    // Override update chain to capture the set() argument
    const mockSet = vi.fn((args: Record<string, unknown>) => {
      capturedSetArgs = args;
      return { where: mockUpdate };
    });
    const { db } = await import("@/lib/db");
    vi.spyOn(db, "update").mockReturnValue({
      set: mockSet,
    } as unknown as ReturnType<typeof db.update>);

    const handler = withCronLogging("partial-job", async () => ({
      itemsProcessed: 5,
      itemsSucceeded: 3,
      itemsFailed: 2,
    }));

    const res = await handler(makeRequest("Bearer secret123"));
    expect(res.status).toBe(200);
    expect(capturedSetArgs).not.toBeNull();
    expect((capturedSetArgs as unknown as Record<string, unknown>).status).toBe(
      "partial",
    );
  });

  it("logs error and returns 500 when handler throws", async () => {
    let capturedSetArgs: Record<string, unknown> | null = null;

    const mockSet = vi.fn((args: Record<string, unknown>) => {
      capturedSetArgs = args;
      return { where: mockUpdate };
    });
    const { db } = await import("@/lib/db");
    vi.spyOn(db, "update").mockReturnValue({
      set: mockSet,
    } as unknown as ReturnType<typeof db.update>);

    const handler = withCronLogging("error-job", async () => {
      throw new Error("Something went wrong");
    });

    const res = await handler(makeRequest("Bearer secret123"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("Internal server error");
    expect(body.message).toBeUndefined();

    // Log row should be updated with error status
    expect(capturedSetArgs).not.toBeNull();
    const args = capturedSetArgs as unknown as Record<string, unknown>;
    expect(args.status).toBe("error");
    expect(String(args.errorMessage)).toContain("Something went wrong");
  });

  it("reports a thrown error to Sentry with the job name", async () => {
    const boom = new Error("cron eksploderede");
    const handler = withCronLogging("sentry-job", async () => {
      throw boom;
    });

    const res = await handler(makeRequest("Bearer secret123"));

    expect(res.status).toBe(500);
    expect(mockCapture).toHaveBeenCalledTimes(1);
    expect(mockCapture).toHaveBeenCalledWith(boom, {
      route: "/api/cron/sentry-job",
      type: "cron",
      extra: { jobName: "sentry-job", durationMs: expect.any(Number) },
    });
  });

  it("does not report to Sentry when the job succeeds", async () => {
    const handler = withCronLogging("ok-job", async () => ({
      itemsProcessed: 1,
    }));
    await handler(makeRequest("Bearer secret123"));
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("passes metadata through to the log row", async () => {
    let capturedSetArgs: Record<string, unknown> | null = null;

    const mockSet = vi.fn((args: Record<string, unknown>) => {
      capturedSetArgs = args;
      return { where: mockUpdate };
    });
    const { db } = await import("@/lib/db");
    vi.spyOn(db, "update").mockReturnValue({
      set: mockSet,
    } as unknown as ReturnType<typeof db.update>);

    const meta = { usersChecked: 42, region: "eu-west" };
    const handler = withCronLogging("meta-job", async () => ({
      itemsProcessed: 1,
      itemsSucceeded: 1,
      metadata: meta,
    }));

    await handler(makeRequest("Bearer secret123"));

    expect(capturedSetArgs).not.toBeNull();
    const args = capturedSetArgs as unknown as Record<string, unknown>;
    expect(args.metadata).toEqual(meta);
  });

  it("logs success when handler returns a Response directly", async () => {
    let capturedSetArgs: Record<string, unknown> | null = null;

    const mockSet = vi.fn((args: Record<string, unknown>) => {
      capturedSetArgs = args;
      return { where: mockUpdate };
    });
    const { db } = await import("@/lib/db");
    vi.spyOn(db, "update").mockReturnValue({
      set: mockSet,
    } as unknown as ReturnType<typeof db.update>);

    const customResponse = NextResponse.json({ custom: true });
    const handler = withCronLogging("response-job", async () => customResponse);

    const res = await handler(makeRequest("Bearer secret123"));
    // The original Response is returned unchanged
    const body = await res.json();
    expect(body.custom).toBe(true);

    expect(capturedSetArgs).not.toBeNull();
    const args = capturedSetArgs as unknown as Record<string, unknown>;
    expect(args.status).toBe("success");
    // No item counts on a pass-through Response
    expect(args.itemsProcessed).toBeUndefined();
  });
});
