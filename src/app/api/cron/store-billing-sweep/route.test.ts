import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({ sweeps: 0, googleClients: 0 }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/store-billing/google", () => ({
  getGooglePlayClient: vi.fn(() => {
    state.googleClients++;
    return {};
  }),
}));
vi.mock("@/lib/utils/sentry", () => ({ captureRouteError: vi.fn() }));
vi.mock("@/lib/store-billing/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/store-billing/service")>()),
  sweepStoreSubscriptions: vi.fn(async () => {
    state.sweeps++;
    return {
      googleChecked: 0,
      googleFailed: 0,
      appleOverdueIds: [],
      googleDowngradedIds: [],
    };
  }),
}));

import { GET } from "./route";

type Result = { itemsProcessed: number; metadata?: Record<string, unknown> };
const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/store-billing-sweep"),
  );

describe("store-billing-sweep cron", () => {
  beforeEach(() => {
    state.sweeps = 0;
    state.googleClients = 0;
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("er en no-op uden STORE_BILLING_ENABLED: ingen butiks-API", async () => {
    const res = await run();
    expect(res.metadata).toEqual({ disabled: true });
    expect(state.sweeps).toBe(0);
    expect(state.googleClients).toBe(0);
  });

  it("er en no-op når kun Alunta er sat (ingen butikker)", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
    await run();
    expect(state.sweeps).toBe(0);
  });

  it("kører sweepen som i dag med STORE_BILLING_ENABLED=1", async () => {
    vi.stubEnv("STORE_BILLING_ENABLED", "1");
    await run();
    expect(state.sweeps).toBe(1);
    expect(state.googleClients).toBe(1);
  });
});
