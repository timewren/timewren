import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { subscriptions } from "@/lib/db/schema";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({
  tables: [] as unknown[],
  mails: [] as { billingEnabled: boolean; prepaidIntegrityOrphans: number }[],
  execute: vi.fn(),
}));

// Kædbar, afventbar db-stub der husker hvilke tabeller der blev læst.
vi.mock("@/lib/db", () => {
  const chain = (table?: unknown) => {
    if (table) state.tables.push(table);
    const rows = [{ count: 0, email: "admin@example.test" }];
    const c: Promise<unknown> & Record<string, unknown> = Object.assign(
      Promise.resolve(rows),
      { from: (t: unknown) => chain(t) } as Record<string, unknown>,
    );
    for (const m of ["where", "orderBy", "limit"]) c[m] = () => c;
    return c;
  };
  return {
    db: {
      select: () => chain(),
      execute: state.execute,
      query: { adminSettings: { findFirst: async () => undefined } },
    },
  };
});
vi.mock("@/lib/email/admin-digest", () => ({
  sendAdminDigest: vi.fn(
    async (p: {
      stats: { billingEnabled: boolean; prepaidIntegrityOrphans: number };
    }) => {
      state.mails.push(p.stats);
    },
  ),
}));

import { GET } from "./route";

const run = () =>
  (GET as unknown as (r: Request) => Promise<{ itemsProcessed: number }>)(
    new Request("http://localhost/api/cron/admin-digest"),
  );

describe("admin-digest cron", () => {
  beforeEach(() => {
    state.tables = [];
    state.mails = [];
    state.execute.mockReset();
    state.execute.mockResolvedValue([{ count: 0 }]);
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("uden betalingsudbyder: sender driftsrapporten uden abonnementstal", async () => {
    const res = await run();
    expect(res.itemsProcessed).toBe(1);
    expect(state.mails).toHaveLength(1);
    expect(state.mails[0].billingEnabled).toBe(false);
    expect(state.tables).not.toContain(subscriptions);
  });

  it("med betalingsudbyder (Cloud-env): læser abonnementer og sender fuld rapport", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
    await run();
    expect(state.mails).toHaveLength(1);
    expect(state.mails[0].billingEnabled).toBe(true);
    expect(state.tables).toContain(subscriptions);
  });

  it.each([0, 7])(
    "videregiver det aktuelle antal klippekort-poster uden forbrugsrække (%i)",
    async (count) => {
      state.execute.mockResolvedValue([{ count }]);
      await run();
      expect(state.execute).toHaveBeenCalledOnce();
      expect(state.mails).toHaveLength(1);
      expect(state.mails[0].prepaidIntegrityOrphans).toBe(count);
    },
  );

  it("sender ikke en falsk rask rapport, når integritetstjekket fejler", async () => {
    state.execute.mockRejectedValue(new Error("synthetic database failure"));
    await expect(run()).rejects.toThrow("synthetic database failure");
    expect(state.mails).toHaveLength(0);
  });
});
