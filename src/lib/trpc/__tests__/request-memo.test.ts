import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveActiveOrgId = vi.fn(async () => "org-1");
const resolveModules = vi.fn(async () => ({}));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: () => resolveActiveOrgId(),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../routers/enterprise/middleware", () => ({
  resolveModules: () => resolveModules(),
  makePermissiveModules: vi.fn(() => ({})),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { createRequestMemo, memoize } from "../request-memo";
import { protectedProcedure, router, subscribedProcedure } from "../trpc";

const testRouter = router({
  a: protectedProcedure.query(({ ctx }) => ctx.orgId),
  b: protectedProcedure.query(({ ctx }) => ctx.orgId),
  paid: subscribedProcedure.query(({ ctx }) => ctx.planTier),
  paid2: subscribedProcedure.query(({ ctx }) => ctx.planTier),
});

function fakeDb() {
  const users = vi.fn(async () => ({ role: "user" }));
  const subscriptions = vi.fn(async () => ({
    status: "active",
    planTier: "solo",
    trialEndsAt: new Date(0),
    pastDueSince: null,
  }));
  return {
    db: {
      query: {
        users: { findFirst: users },
        subscriptions: { findFirst: subscriptions },
      },
    },
    users,
    subscriptions,
  };
}

function caller(db: unknown, memo?: ReturnType<typeof createRequestMemo>) {
  return testRouter.createCaller({
    session: { user: { id: "u1" } } as never,
    db: db as never,
    headers: null,
    memo,
  });
}

describe("request-memo i tRPC-middlewaren", () => {
  beforeEach(() => {
    resolveActiveOrgId.mockClear();
    resolveModules.mockClear();
  });

  it("slår org og moduler op én gang for en batch med samme memo", async () => {
    const { db } = fakeDb();
    const c = caller(db, createRequestMemo());
    await Promise.all([c.a(), c.b(), c.a()]);
    expect(resolveActiveOrgId).toHaveBeenCalledTimes(1);
    expect(resolveModules).toHaveBeenCalledTimes(1);
  });

  it("slår op pr. kald uden memo (tests, server-callers)", async () => {
    const { db } = fakeDb();
    const c = caller(db);
    await c.a();
    await c.b();
    expect(resolveActiveOrgId).toHaveBeenCalledTimes(2);
    expect(resolveModules).toHaveBeenCalledTimes(2);
  });

  it("deler rolle- og abonnementsopslaget mellem abonnementsprocedurer", async () => {
    const { db, users, subscriptions } = fakeDb();
    const c = caller(db, createRequestMemo());
    await expect(Promise.all([c.paid(), c.paid2()])).resolves.toEqual([
      "solo",
      "solo",
    ]);
    expect(users).toHaveBeenCalledTimes(1);
    expect(subscriptions).toHaveBeenCalledTimes(1);
  });

  it("en ny request (ny memo) slår op igen", async () => {
    const { db, subscriptions } = fakeDb();
    await caller(db, createRequestMemo()).paid();
    await caller(db, createRequestMemo()).paid();
    expect(subscriptions).toHaveBeenCalledTimes(2);
  });
});

describe("memoize", () => {
  it("gemmer ikke en afvist løfte", async () => {
    const memo = createRequestMemo();
    const fn = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("nede"))
      .mockResolvedValueOnce("ok");
    await expect(memoize(memo, "k", fn)).rejects.toThrow("nede");
    await expect(memoize(memo, "k", fn)).resolves.toBe("ok");
    await expect(memoize(memo, "k", fn)).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
