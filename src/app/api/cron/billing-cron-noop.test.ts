import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Selvhost uden betalingsudbyder: de betalingsrelaterede cron-jobs må hverken
// røre databasen, kalde Alunta/Stripe/butikker eller sende mails (#1014).

vi.mock("@/lib/cron/log-cron-run", () => ({
  withCronLogging: (_name: string, handler: (req: Request) => unknown) =>
    handler,
}));

const state = vi.hoisted(() => ({ touched: 0 }));
const touch = () => {
  state.touched++;
  throw new Error("brugt uden betalingsudbyder");
};
vi.mock("@/lib/db", () => ({
  db: new Proxy({}, { get: touch }),
}));
vi.mock("@/lib/alunta", () => ({ alunta: new Proxy({}, { get: touch }) }));

const ROUTES = {
  "trial-expire": () => import("./trial-expire/route"),
  "trial-reminder": () => import("./trial-reminder/route"),
  dunning: () => import("./dunning/route"),
  "seat-reconciliation": () => import("./seat-reconciliation/route"),
} as const;

const CLOUD_ENV = [
  ["ALUNTA_API_KEY", "cloud-key"],
  ["STRIPE_SECRET_KEY", "sk_test_x"],
  ["STORE_BILLING_ENABLED", "1"],
] as const;

const call = async (name: keyof typeof ROUTES) => {
  const { GET } = await ROUTES[name]();
  return (
    GET as unknown as (r: Request) => Promise<{ itemsProcessed: number }>
  )(new Request(`http://localhost/api/cron/${name}`));
};

describe("billing-cron-jobs uden betalingsudbyder", () => {
  beforeEach(() => {
    state.touched = 0;
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  for (const name of Object.keys(ROUTES) as (keyof typeof ROUTES)[]) {
    it(`${name} er en no-op`, async () => {
      const res = await call(name);
      expect(res.itemsProcessed).toBe(0);
      expect(state.touched).toBe(0);
    });

    for (const [key, value] of CLOUD_ENV) {
      it(`${name} rører databasen med ${key} sat`, async () => {
        vi.stubEnv(key, value);
        await expect(call(name)).rejects.toThrow();
        expect(state.touched).toBeGreaterThan(0);
      });
    }
  }
});
