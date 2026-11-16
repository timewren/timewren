import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCanAddActiveClient,
  isFreeTierMemberLocked,
} from "../plan-limits";

/** db-fake: select().from().where() giver tælle-/medlemsrækker. */
function fakeDb(rows: unknown[]) {
  const where = vi.fn().mockResolvedValue(rows);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  // biome-ignore lint/suspicious/noExplicitAny: test-fake af Drizzle-handle
  return { db: { select } as any, select };
}

const freeMembers = ["a", "b", "c", "d", "e"].map((userId, i) => ({
  userId,
  role: i === 0 ? "owner" : "member",
  createdAt: new Date(2026, 0, i + 1),
}));

describe("plan-grænser uden billing (selvhost)", () => {
  beforeEach(() => {
    vi.stubEnv("ALUNTA_API_KEY", "");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("STORE_BILLING_ENABLED", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lader en Gratis-org oprette ubegrænset mange kunder", async () => {
    const { db, select } = fakeDb([{ count: 50 }]);
    await expect(
      assertCanAddActiveClient(db, {
        planTier: "free",
        orgId: "org",
        userId: "u",
      }),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("låser aldrig et medlem nr. 4+ ude", async () => {
    const { db, select } = fakeDb(freeMembers);
    await expect(isFreeTierMemberLocked(db, "org", "e")).resolves.toBe(false);
    expect(select).not.toHaveBeenCalled();
  });

  it("giver ubegrænsede pladser og ingen Gratis-flag", async () => {
    vi.resetModules();
    vi.doMock("../../db", () => ({ db: {} }));
    const { resolveOrgSeatPolicy } = await import("../../org-seats");
    await expect(resolveOrgSeatPolicy("org")).resolves.toEqual({
      maxSeats: Number.MAX_SAFE_INTEGER,
      isFree: false,
    });
    vi.doUnmock("../../db");
  });
});

describe("plan-grænser med billing (TimeTrack Cloud uændret)", () => {
  beforeEach(() => vi.stubEnv("ALUNTA_API_KEY", "key"));
  afterEach(() => vi.unstubAllEnvs());

  it("afviser den 4. aktive kunde på Gratis", async () => {
    const { db } = fakeDb([{ count: 3 }]);
    await expect(
      assertCanAddActiveClient(db, {
        planTier: "free",
        orgId: "org",
        userId: "u",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("tillader kunder indtil grænsen på Gratis", async () => {
    const { db } = fakeDb([{ count: 2 }]);
    await expect(
      assertCanAddActiveClient(db, {
        planTier: "free",
        orgId: "org",
        userId: "u",
      }),
    ).resolves.toBeUndefined();
  });

  it("springer tælling over for betalte tiers", async () => {
    const { db, select } = fakeDb([{ count: 500 }]);
    await assertCanAddActiveClient(db, {
      planTier: "solo",
      orgId: "org",
      userId: "u",
    });
    expect(select).not.toHaveBeenCalled();
  });

  it("låser medlem nr. 4+ på Gratis, men ikke ejeren", async () => {
    const { db } = fakeDb(freeMembers);
    await expect(isFreeTierMemberLocked(db, "org", "e")).resolves.toBe(true);
    await expect(isFreeTierMemberLocked(db, "org", "a")).resolves.toBe(false);
  });
});
