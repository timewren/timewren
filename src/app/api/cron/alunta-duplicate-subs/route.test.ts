import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  aluntaCalls: 0,
  aluntaError: null as Error | null,
  networkError: null as Error | null,
  previousRun: undefined as
    | { metadata: unknown; errorMessage: string | null }
    | undefined,
}));

vi.mock("@/lib/db", () => ({
  db: {
    query: {
      subscriptions: { findMany: vi.fn(async () => state.rows) },
      users: { findMany: vi.fn(async () => []) },
      cronJobLogs: { findFirst: vi.fn(async () => state.previousRun) },
    },
  },
}));
vi.mock("@/lib/alunta", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/alunta")>();
  return {
    AluntaApiError: actual.AluntaApiError,
    alunta: {
      subscriptions: {
        listAll: vi.fn(async () => {
          state.aluntaCalls++;
          if (state.aluntaError) throw state.aluntaError;
          return [];
        }),
      },
    },
    // Netværksfejl markeres inde i aluntaFetch; her står state.networkError
    // for en fejl, aluntaFetch har markeret.
    isAluntaUpstreamError: (err: unknown) =>
      (err !== null && err === state.networkError) ||
      actual.isAluntaUpstreamError(err),
  };
});

const { AluntaApiError } = await import("@/lib/alunta");

function aluntaError(status: number): Error {
  return new AluntaApiError(status, `Alunta API ${status}: Server Error`);
}
vi.mock("@/lib/notifications/admin", () => ({ notifyAdmin: vi.fn() }));

import { GET } from "./route";

type Result = {
  itemsProcessed: number;
  itemsFailed?: number;
  metadata?: Record<string, unknown>;
};
const run = () =>
  (GET as unknown as (r: Request) => Promise<Result>)(
    new Request("http://localhost/api/cron/alunta-duplicate-subs"),
  );

const liveRow = {
  id: "s1",
  userId: "u1",
  organizationId: null,
  aluntaCustomerId: "cust-1",
  aluntaSubscriptionId: "sub-1",
  status: "active",
  storeProvider: null,
  storeStatus: null,
};

describe("alunta-duplicate-subs cron", () => {
  beforeEach(() => {
    state.rows = [liveRow];
    state.aluntaCalls = 0;
    state.aluntaError = null;
    state.networkError = null;
    state.previousRun = undefined;
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("kalder aldrig Alunta uden ALUNTA_API_KEY, selv med live rækker", async () => {
    const res = await run();
    expect(res.itemsProcessed).toBe(0);
    expect(res.metadata).toMatchObject({ skipped: "alunta-disabled" });
    expect(state.aluntaCalls).toBe(0);
  });

  it("kalder aldrig Alunta når kun Stripe eller butikker er sat", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STORE_BILLING_ENABLED", "1");
    await run();
    expect(state.aluntaCalls).toBe(0);
  });

  it("afstemmer mod Alunta som i dag med Cloud-env", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
    const res = await run();
    expect(state.aluntaCalls).toBe(1);
    expect(res.itemsProcessed).toBe(1);
  });

  describe("når Alunta svarer 5xx/429 eller ikke svarer efter genforsøg (fejlspor 53)", () => {
    beforeEach(() => {
      vi.stubEnv("ALUNTA_API_KEY", "cloud-key");
      vi.spyOn(console, "warn").mockImplementation(() => {});
    });

    it("springer dagens afstemning over som partial uden at kaste", async () => {
      state.aluntaError = aluntaError(500);
      state.previousRun = { metadata: { duplicates: [] }, errorMessage: null };
      const res = await run();
      expect(res.itemsFailed).toBe(1);
      expect(res.metadata).toMatchObject({ upstreamError: 500 });
    });

    it("kaster (og når Sentry), når forrige kørsel også fejlede upstream", async () => {
      state.aluntaError = aluntaError(503);
      state.previousRun = {
        metadata: { upstreamError: 500 },
        errorMessage: null,
      };
      await expect(run()).rejects.toThrow("Alunta API 503");
    });

    it("kaster efter en eskaleret fejl dagen før", async () => {
      state.aluntaError = aluntaError(500);
      state.previousRun = {
        metadata: null,
        errorMessage: "Alunta API 500: Server Error",
      };
      await expect(run()).rejects.toThrow("Alunta API 500");
    });

    it("springer også over ved 429 efter genforsøg", async () => {
      state.aluntaError = aluntaError(429);
      const res = await run();
      expect(res.itemsFailed).toBe(1);
      expect(res.metadata).toMatchObject({ upstreamError: 429 });
    });

    it("springer også over, når Alunta slet ikke svarer", async () => {
      const err = new DOMException("The operation timed out.", "TimeoutError");
      state.aluntaError = err;
      state.networkError = err;
      const res = await run();
      expect(res.itemsFailed).toBe(1);
      expect(res.metadata).toMatchObject({ upstreamError: "TimeoutError" });
    });

    it("kaster, når forrige kørsel ikke fik svar fra Alunta", async () => {
      state.aluntaError = aluntaError(500);
      state.previousRun = {
        metadata: { upstreamError: "TypeError" },
        errorMessage: null,
      };
      await expect(run()).rejects.toThrow("Alunta API 500");
    });

    it("kaster efter en eskaleret 429 dagen før", async () => {
      state.aluntaError = aluntaError(500);
      state.previousRun = {
        metadata: null,
        errorMessage: "Alunta API 429: Too Many Attempts.",
      };
      await expect(run()).rejects.toThrow("Alunta API 500");
    });

    it("markerer en eskaleret netværksfejl, så næste kørsel genkender den", async () => {
      const err = new TypeError("fetch failed");
      state.aluntaError = err;
      state.networkError = err;
      state.previousRun = {
        metadata: { upstreamError: "TypeError" },
        errorMessage: null,
      };
      const thrown = await run().catch((e) => e);
      expect(thrown.cause).toBe(err);

      // Dagen efter: withCronLogging har kun gemt fejlbeskeden.
      const next = new DOMException("The operation timed out.", "TimeoutError");
      state.aluntaError = next;
      state.networkError = next;
      state.previousRun = { metadata: null, errorMessage: thrown.message };
      await expect(run()).rejects.toThrow("timed out");
    });

    it("kaster altid ved 4xx (fx forkert nøgle)", async () => {
      state.aluntaError = aluntaError(401);
      await expect(run()).rejects.toThrow("Alunta API 401");
    });
  });
});
