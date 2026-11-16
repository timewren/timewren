import { beforeEach, describe, expect, it, vi } from "vitest";

// Kør handleren direkte (uden CRON_SECRET/cron-log-rækker).
vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({
  returned: [] as { id: string }[],
  updates: [] as { set: Record<string, unknown> }[],
}));

vi.mock("@/lib/db", () => ({
  db: {
    update: vi.fn(() => ({
      set: (set: Record<string, unknown>) => ({
        where: () => ({
          returning: () => {
            state.updates.push({ set });
            return Promise.resolve(state.returned);
          },
        }),
      }),
    })),
  },
}));

import { GET } from "./route";

type Result = {
  itemsProcessed: number;
  metadata?: { downgradedToFree: string[] };
};
const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/trial-expire"),
  );

describe("trial-expire cron (reverse trial)", () => {
  beforeEach(() => {
    state.returned = [];
    state.updates = [];
  });

  it("gør intet synligt når ingen trials er udløbet", async () => {
    const res = await run();
    expect(res.itemsProcessed).toBe(0);
    expect(res.metadata?.downgradedToFree).toEqual([]);
  });

  it("nedgraderer alle udløbne, ubetalte trials — også teams — til Gratis med 3 brugere", async () => {
    state.returned = [{ id: "solo" }, { id: "team-5" }, { id: "gl-paywall" }];

    const res = await run();

    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].set).toMatchObject({
      status: "free",
      planTier: "free",
      isTrial: false,
      seatCount: 1,
      maxSeats: 3,
    });
    expect(res.itemsProcessed).toBe(3);
    expect(res.metadata?.downgradedToFree).toEqual([
      "solo",
      "team-5",
      "gl-paywall",
    ]);
  });

  it("sender aldrig nogen til betalingsmuren (trial_expired)", async () => {
    state.returned = [{ id: "team" }];
    await run();
    for (const u of state.updates) {
      expect(u.set.status).not.toBe("trial_expired");
    }
  });
});
