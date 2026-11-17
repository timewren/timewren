import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));
// Uden demo-tilstand må ruten slet ikke røre databasen.
vi.mock("@/lib/db", () => ({
  db: new Proxy(
    {},
    {
      get: () => {
        throw new Error("databasen brugt uden DEMO_MODE");
      },
    },
  ),
}));
const cleanup = vi.hoisted(() => vi.fn());
vi.mock("@/lib/demo/cleanup", () => ({ cleanupExpiredDemoUsers: cleanup }));

import { GET } from "./route";

const call = () =>
  (GET as unknown as (r: Request) => Promise<Record<string, unknown>>)(
    new Request("http://localhost/api/cron/demo-cleanup"),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  cleanup.mockReset();
});

describe("/api/cron/demo-cleanup", () => {
  it("er en no-op uden DEMO_MODE", async () => {
    vi.stubEnv("DEMO_MODE", "");
    expect(await call()).toMatchObject({
      itemsProcessed: 0,
      metadata: { skipped: "demo-mode-off" },
    });
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("rydder udløbne demokonti i demo-tilstand", async () => {
    vi.stubEnv("DEMO_MODE", "1");
    cleanup.mockResolvedValue({ found: 3, deleted: 2, failed: 1 });
    expect(await call()).toEqual({
      itemsProcessed: 3,
      itemsSucceeded: 2,
      itemsFailed: 1,
    });
  });
});
