import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({ risk: 0, notified: 0 }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/admin/churn-risk", () => ({
  calculateChurnRisk: vi.fn(async () => {
    state.risk++;
    return [];
  }),
}));
vi.mock("@/lib/notifications/admin", () => ({
  notifyAdmin: vi.fn(async () => {
    state.notified++;
  }),
}));

import { GET } from "./route";

type Result = { itemsProcessed: number; metadata?: Record<string, unknown> };
const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/churn-playbooks"),
  );

describe("churn-playbooks cron", () => {
  beforeEach(() => {
    state.risk = 0;
    state.notified = 0;
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
    vi.stubEnv("CHURN_PLAYBOOKS_DISABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("er en no-op uden betalingsudbyder: ingen risikoberegning, ingen beskeder", async () => {
    const res = await run();
    expect(res.itemsProcessed).toBe(0);
    expect(res.metadata).toEqual({ skipped: "billing-disabled" });
    expect(state.risk).toBe(0);
    expect(state.notified).toBe(0);
  });

  it("kører som i dag med en betalingsudbyder (Cloud-env)", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    const res = await run();
    expect(state.risk).toBe(1);
    expect(res.metadata).toMatchObject({ atRiskUsers: 0 });
  });

  it("kill-switchen virker stadig med Cloud-env", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
    vi.stubEnv("CHURN_PLAYBOOKS_DISABLED", "1");
    const res = await run();
    expect(res.metadata).toEqual({ disabled: true });
    expect(state.risk).toBe(0);
  });
});
