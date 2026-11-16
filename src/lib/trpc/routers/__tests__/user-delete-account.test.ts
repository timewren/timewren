import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// user.deleteAccount tager en valgfri Apple authorization code (iOS-appen
// sender den, så Apple-login kan tilbagekaldes, 5.1.1(v)). Feltet er valgfrit,
// så ældre klienter og web virker uændret, og det videregives urørt.

const mocks = vi.hoisted(() => ({ del: vi.fn() }));

vi.mock("@/lib/db", () => ({ db: {} }));
vi.mock("@/lib/db/index", () => ({ db: {} }));
vi.mock("@sentry/nextjs", () => ({
  setUser: vi.fn(),
  setTag: vi.fn(),
  startSpan: vi.fn((_o: unknown, fn: () => unknown) => fn()),
  captureException: vi.fn(),
  withScope: vi.fn((_: unknown, fn: (s: unknown) => unknown) => fn({})),
}));
vi.mock("@/lib/account-deletion", () => ({
  deleteUserAccountCompletely: mocks.del,
  findActiveStoreSubscription: vi.fn(),
  planAccountDeletion: vi.fn(),
}));

import { userRouter } from "../user";

const DB = {
  query: {
    members: {
      findFirst: async () => ({
        id: "m",
        role: "owner",
        organizationId: "org-A",
      }),
    },
    organizationModules: { findMany: async () => [] },
    organizations: {
      findFirst: async () => ({ requireTwoFactorForManagers: false }),
    },
    users: { findFirst: async () => ({ email: "Ejer@Test.local" }) },
  },
};

function caller() {
  return userRouter.createCaller({
    session: {
      user: { id: "user-me", email: "ejer@test.local", name: "Test Ejer" },
      activeOrganizationId: "org-A",
    },
    db: DB,
    headers: new Headers(),
  } as never);
}

function passedOpts(): {
  storeSubscriptionAcknowledged?: boolean;
  appleAuthorizationCode?: string;
} {
  return mocks.del.mock.calls[0][2];
}

describe("user.deleteAccount: appleAuthorizationCode", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.del.mockResolvedValue({ outcome: "deleted" });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("uden feltet virker sletningen som før (ældre klienter og web)", async () => {
    await expect(
      caller().deleteAccount({ confirmEmail: "ejer@test.local" }),
    ).resolves.toEqual({ success: true });
    expect(mocks.del).toHaveBeenCalledTimes(1);
    expect(mocks.del.mock.calls[0][0]).toBe(DB);
    expect(mocks.del.mock.calls[0][1]).toBe("user-me");
    expect(passedOpts().appleAuthorizationCode).toBeUndefined();
    expect(passedOpts().storeSubscriptionAcknowledged).toBeUndefined();
  });

  it("videregiver koden urørt sammen med butiksbekræftelsen", async () => {
    await caller().deleteAccount({
      confirmEmail: "ejer@test.local",
      storeSubscriptionAcknowledged: true,
      appleAuthorizationCode: "c1.0.abcd-EFGH",
    });
    expect(passedOpts()).toEqual({
      storeSubscriptionAcknowledged: true,
      appleAuthorizationCode: "c1.0.abcd-EFGH",
    });
  });

  it("accepterer en kode på præcis 4096 tegn", async () => {
    const code = "a".repeat(4096);
    await caller().deleteAccount({
      confirmEmail: "ejer@test.local",
      appleAuthorizationCode: code,
    });
    expect(passedOpts().appleAuthorizationCode).toBe(code);
  });

  it("afviser en tom kode og en kode over 4096 tegn uden at slette", async () => {
    for (const appleAuthorizationCode of ["", "a".repeat(4097)]) {
      const err = await caller()
        .deleteAccount({
          confirmEmail: "ejer@test.local",
          appleAuthorizationCode,
        })
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TRPCError);
      expect((err as TRPCError).code).toBe("BAD_REQUEST");
    }
    expect(mocks.del).not.toHaveBeenCalled();
  });

  it("en forkert bekræftelsesmail afvises, og koden bruges ikke", async () => {
    const err = await caller()
      .deleteAccount({
        confirmEmail: "en-anden@test.local",
        appleAuthorizationCode: "c1.0.abcd",
      })
      .catch((e: unknown) => e);
    expect((err as TRPCError).code).toBe("BAD_REQUEST");
    expect(mocks.del).not.toHaveBeenCalled();
  });
});
