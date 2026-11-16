import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@/lib/auth/active-org", () => ({
  resolveActiveOrgId: vi.fn(async () => "org-1"),
  resolveRequestedOrgId: vi.fn(async ({ orgId }: { orgId: string }) => orgId),
}));
vi.mock("../routers/enterprise/middleware", () => ({
  resolveModules: vi.fn(async () => ({})),
  makePermissiveModules: vi.fn(() => ({})),
}));
// Rolle-/modulopslag er ikke emnet her, kun planen
vi.mock("@/lib/permissions/role-access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/permissions/role-access")>()),
  resolveModuleAccess: vi.fn(async () => "write"),
}));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_opts: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));

import { moduleWriteProcedure, router, subscribedProcedure } from "../trpc";

const testRouter = router({
  tier: subscribedProcedure.query(({ ctx }) => ctx.planTier),
  invoice: moduleWriteProcedure("invoices").query(() => "ok"),
  klippekort: moduleWriteProcedure("klippekort").query(() => "ok"),
});

type Sub = {
  status: string;
  planTier: string | null;
  trialEndsAt: Date;
  pastDueSince: Date | null;
} | null;

function caller(sub: Sub) {
  const db = {
    query: {
      users: { findFirst: vi.fn(async () => ({ role: "user" })) },
      subscriptions: { findFirst: vi.fn(async () => sub ?? undefined) },
      members: { findFirst: vi.fn(async () => ({ role: "owner" })) },
    },
    select: vi.fn(() => ({
      from: () => ({ where: vi.fn().mockResolvedValue([]) }),
    })),
  };
  return testRouter.createCaller({
    session: { user: { id: "u1" } } as never,
    db: db as never,
    headers: null,
  });
}

const expiredTrial: Sub = {
  status: "trialing",
  planTier: "solo",
  trialEndsAt: new Date(Date.now() - 86_400_000),
  pastDueSince: null,
};
const freeSub: Sub = {
  status: "free",
  planTier: "free",
  trialEndsAt: new Date(0),
  pastDueSince: null,
};

afterEach(() => vi.unstubAllEnvs());

describe("abonnementsvagten uden billing (selvhost)", () => {
  const selfHost = () => {
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  };

  it("slipper igennem uden abonnement, som ubegrænset", async () => {
    selfHost();
    await expect(caller(null).tier()).resolves.toBeNull();
  });

  it("ignorerer en udløbet prøve", async () => {
    selfHost();
    await expect(caller(expiredTrial).tier()).resolves.toBeNull();
  });

  it("åbner fakturering på en Gratis-række", async () => {
    selfHost();
    await expect(caller(freeSub).invoice()).resolves.toBe("ok");
  });
});

describe("abonnementsvagten med billing (TimeTrack Cloud uændret)", () => {
  it("kræver et abonnement", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    await expect(caller(null).tier()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("afviser en udløbet prøve", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    await expect(caller(expiredTrial).tier()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  // #1012: ingen funktionslås. Fakturering og klippekort er åbne på alle
  // planer; kun kapacitet (brugere, aktive kunder) afvises.
  it("åbner fakturering og klippekort på Gratis", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    await expect(caller(freeSub).invoice()).resolves.toBe("ok");
    await expect(caller(freeSub).klippekort()).resolves.toBe("ok");
  });

  it("åbner fakturering og klippekort på Privat", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "key");
    const privat: Sub = {
      status: "active",
      planTier: "privat",
      trialEndsAt: new Date(0),
      pastDueSince: null,
    };
    await expect(caller(privat).invoice()).resolves.toBe("ok");
    await expect(caller(privat).klippekort()).resolves.toBe("ok");
  });

  it("afviser stadig fakturering uden et brugbart abonnement", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    await expect(caller(expiredTrial).invoice()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(caller(null).invoice()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });

  it("giver tieren for en betalt plan", async () => {
    vi.stubEnv("ALUNTA_API_KEY", "key");
    await expect(
      caller({
        status: "active",
        planTier: "team",
        trialEndsAt: new Date(0),
        pastDueSince: null,
      }).tier(),
    ).resolves.toBe("team");
  });
});
