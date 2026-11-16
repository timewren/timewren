import { TRPCError } from "@trpc/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  assertCanAddActiveClient,
  canAddActiveClient,
  displayedMaxActiveClients,
  FREE_CLIENT_LIMIT_MESSAGE,
  FREE_MAX_ACTIVE_CLIENTS,
  FREE_MAX_SEATS,
  FREE_MEMBER_LOCKED_MESSAGE,
  FREE_SEAT_LIMIT_MESSAGE,
  FREE_TIER_SUBSCRIPTION_FIELDS,
  freeSeatHolderIds,
  isFreeSubscription,
  isFreeTierMemberLocked,
  PRIVAT_CLIENT_LIMIT_MESSAGE,
  PRIVAT_MAX_ACTIVE_CLIENTS,
  planLimits,
} from "../plan-limits";

/** Minimal db-fake: select().from().where() resolver til én tælle-række. */
function fakeDb(activeClients: number) {
  const where = vi.fn().mockResolvedValue([{ count: activeClients }]);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  // biome-ignore lint/suspicious/noExplicitAny: test-fake af Drizzle-handle
  return { db: { select } as any, select };
}

describe("planLimits", () => {
  it("begrænser Gratis til 3 aktive kunder og 3 brugere", () => {
    expect(planLimits("free")).toEqual({ maxActiveClients: 3, maxSeats: 3 });
    expect(FREE_MAX_ACTIVE_CLIENTS).toBe(3);
    expect(FREE_MAX_SEATS).toBe(3);
  });

  it("nævner grænsen i de danske beskeder", () => {
    expect(FREE_SEAT_LIMIT_MESSAGE).toContain("3 brugere");
    expect(FREE_SEAT_LIMIT_MESSAGE).toContain("Opgradér");
    expect(FREE_MEMBER_LOCKED_MESSAGE).toContain("3 brugere");
    expect(FREE_MEMBER_LOCKED_MESSAGE).toContain("ejeren");
  });

  it("begrænser Privat til 10 aktive kunder og 1 bruger", () => {
    expect(planLimits("privat")).toEqual({ maxActiveClients: 10, maxSeats: 1 });
    expect(PRIVAT_MAX_ACTIVE_CLIENTS).toBe(10);
  });

  it("giver Selvstændig, Team og Virksomhed ubegrænsede kunder og tierens pladser", () => {
    for (const tier of ["solo", "team", "business"]) {
      expect(planLimits(tier).maxActiveClients).toBe(Number.POSITIVE_INFINITY);
    }
    expect(planLimits("solo").maxSeats).toBe(1);
    expect(planLimits("team").maxSeats).toBeGreaterThan(1);
  });

  it("behandler null/ukendt tier som solo", () => {
    expect(planLimits(null)).toEqual(planLimits("solo"));
    expect(planLimits(undefined)).toEqual(planLimits("solo"));
  });
});

describe("canAddActiveClient", () => {
  it("tillader op til og med den 3. kunde på Gratis", () => {
    expect(canAddActiveClient("free", 0)).toBe(true);
    expect(canAddActiveClient("free", 2)).toBe(true);
    expect(canAddActiveClient("free", 3)).toBe(false);
    expect(canAddActiveClient("free", 10)).toBe(false);
  });

  it("har ingen grænse på betalte tiers", () => {
    expect(canAddActiveClient("solo", 500)).toBe(true);
    expect(canAddActiveClient("team", 500)).toBe(true);
  });

  it("tillader op til og med den 10. kunde på Privat", () => {
    expect(canAddActiveClient("privat", 9)).toBe(true);
    expect(canAddActiveClient("privat", 10)).toBe(false);
    expect(canAddActiveClient("privat", 12)).toBe(false);
  });
});

describe("assertCanAddActiveClient", () => {
  it("afviser den 4. aktive kunde på Gratis med FORBIDDEN", async () => {
    const { db } = fakeDb(3);
    const err = await assertCanAddActiveClient(db, {
      planTier: "free",
      orgId: "org1",
      userId: "u1",
    }).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe(FREE_CLIENT_LIMIT_MESSAGE);
  });

  it("tillader Gratis under grænsen", async () => {
    const { db } = fakeDb(2);
    await expect(
      assertCanAddActiveClient(db, {
        planTier: "free",
        orgId: null,
        userId: "u1",
      }),
    ).resolves.toBeUndefined();
  });

  it("slår ikke op i DB for tiers uden grænse (og admins med null)", async () => {
    for (const planTier of ["solo", "team", null]) {
      const { db, select } = fakeDb(999);
      await expect(
        assertCanAddActiveClient(db, { planTier, orgId: "o", userId: "u" }),
      ).resolves.toBeUndefined();
      // null = solo-fallback → ubegrænset; ingen query
      expect(select).not.toHaveBeenCalled();
    }
  });
});

describe("assertCanAddActiveClient: Privat-loft", () => {
  const privat = { planTier: "privat", orgId: "org1", userId: "u1" };

  // Cloud-tilstand stubbes eksplicit, så testene ikke afhænger af vitest.config.
  beforeEach(() => {
    vi.stubEnv("ALUNTA_API_KEY", "test-billing-enabled");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("tillader den 10. aktive kunde (9 findes) men afviser den 11. (10 findes)", async () => {
    await expect(
      assertCanAddActiveClient(fakeDb(9).db, privat),
    ).resolves.toBeUndefined();
    const err = await assertCanAddActiveClient(fakeDb(10).db, privat).catch(
      (e) => e,
    );
    expect(err).toBeInstanceOf(TRPCError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe(PRIVAT_CLIENT_LIMIT_MESSAGE);
    expect(err.message).toBe(
      "Privat har plads til 10 aktive kunder. Arkivér en kunde eller skift til Selvstændig.",
    );
  });

  it("bevarer en eksisterende over-loft-org: ingen data røres, kun nye aktive kunder afvises", async () => {
    // 12 aktive kunder fra før. Funktionen tæller kun (select) og kan ikke
    // arkivere eller opdatere: db-fakens eneste metode er select.
    const { db, select } = fakeDb(12);
    const err = await assertCanAddActiveClient(db, privat).catch((e) => e);
    expect(err.code).toBe("FORBIDDEN");
    expect(Object.keys(db)).toEqual(["select"]);
    expect(select).toHaveBeenCalledTimes(1);
    // Under loftet igen (arkiveret til 9) kan der tilføjes igen.
    await expect(
      assertCanAddActiveClient(fakeDb(9).db, privat),
    ).resolves.toBeUndefined();
  });

  it("Selvstændig er ubegrænset og slår ikke op i DB", async () => {
    const { db, select } = fakeDb(999);
    await expect(
      assertCanAddActiveClient(db, { ...privat, planTier: "solo" }),
    ).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });

  it("selvhost uden billing-env: Privat er ubegrænset og DB røres ikke", async () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("ALUNTA_API_KEY", "");
    const { db, select } = fakeDb(50);
    await expect(assertCanAddActiveClient(db, privat)).resolves.toBeUndefined();
    expect(select).not.toHaveBeenCalled();
  });
});

describe("displayedMaxActiveClients", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("Cloud: viser loftet for Gratis og Privat, null for ubegrænsede tiers", () => {
    vi.stubEnv("ALUNTA_API_KEY", "test-billing-enabled");
    expect(displayedMaxActiveClients("free")).toBe(3);
    expect(displayedMaxActiveClients("privat")).toBe(10);
    expect(displayedMaxActiveClients("solo")).toBeNull();
    expect(displayedMaxActiveClients("team")).toBeNull();
  });

  it("selvhost uden billing: ingen grænse for nogen tier", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    vi.stubEnv("ALUNTA_API_KEY", "");
    for (const tier of ["free", "privat", "solo", "team"]) {
      expect(displayedMaxActiveClients(tier)).toBeNull();
    }
  });
});

describe("trial-udløb → Gratis", () => {
  it("sætter tier, status og pladser til Gratis uden at røre andet", () => {
    expect(FREE_TIER_SUBSCRIPTION_FIELDS).toEqual({
      status: "free",
      planTier: "free",
      isTrial: false,
      seatCount: 1,
      maxSeats: 3,
    });
    expect(isFreeSubscription(FREE_TIER_SUBSCRIPTION_FIELDS)).toBe(true);
  });

  it("genkender Gratis på status eller tier", () => {
    expect(isFreeSubscription({ status: "canceled", planTier: "solo" })).toBe(
      true,
    );
    expect(isFreeSubscription({ status: "free", planTier: "solo" })).toBe(true);
    expect(isFreeSubscription({ status: "active", planTier: "free" })).toBe(
      true,
    );
    expect(isFreeSubscription({ status: "active", planTier: "solo" })).toBe(
      false,
    );
    expect(
      isFreeSubscription({ status: "trial_expired", planTier: "solo" }),
    ).toBe(false);
  });
});

const day = (d: number) => new Date(Date.UTC(2026, 0, d));

describe("freeSeatHolderIds (nedgradering af teams til Gratis)", () => {
  it("lader alle beholde adgang når orgen har højst 3 medlemmer", () => {
    const members = [
      { userId: "owner", role: "owner", createdAt: day(1) },
      { userId: "a", role: "member", createdAt: day(2) },
      { userId: "b", role: "member", createdAt: day(3) },
    ];
    expect([...freeSeatHolderIds(members)].sort()).toEqual(
      ["a", "b", "owner"].sort(),
    );
  });

  it("prioriterer ejer, så admins, så de ældste medlemmer", () => {
    const members = [
      { userId: "m-old", role: "member", createdAt: day(2) },
      { userId: "m-new", role: "member", createdAt: day(9) },
      { userId: "admin", role: "admin", createdAt: day(8) },
      // Ejeren kan være blevet medlem senere (fx overdraget ejerskab)
      { userId: "owner", role: "owner", createdAt: day(10) },
      { userId: "m-mid", role: "member", createdAt: day(5) },
    ];
    expect([...freeSeatHolderIds(members)]).toEqual([
      "owner",
      "admin",
      "m-old",
    ]);
  });

  it("er deterministisk ved samme tidspunkt og tåler ISO-strenge", () => {
    const members = [
      { userId: "c", role: "member", createdAt: "2026-01-01T00:00:00Z" },
      { userId: "b", role: "member", createdAt: "2026-01-01T00:00:00Z" },
      { userId: "a", role: "member", createdAt: "2026-01-01T00:00:00Z" },
      { userId: "d", role: "member", createdAt: "2026-01-01T00:00:00Z" },
    ];
    expect([...freeSeatHolderIds(members)]).toEqual(["a", "b", "c"]);
  });
});

/** db-fake: select().from().where() → medlemsrækkerne. */
function fakeMembersDb(
  rows: { userId: string; role: string; createdAt: Date }[],
) {
  const where = vi.fn().mockResolvedValue(rows);
  const select = vi.fn(() => ({ from: () => ({ where }) }));
  // biome-ignore lint/suspicious/noExplicitAny: test-fake af Drizzle-handle
  return { select } as any;
}

describe("isFreeTierMemberLocked", () => {
  const five = [
    { userId: "owner", role: "owner", createdAt: day(1) },
    { userId: "m1", role: "member", createdAt: day(2) },
    { userId: "m2", role: "member", createdAt: day(3) },
    { userId: "m3", role: "member", createdAt: day(4) },
    { userId: "m4", role: "member", createdAt: day(5) },
  ];

  it("låser ingen i en org med 3 medlemmer", async () => {
    const db = fakeMembersDb(five.slice(0, 3));
    for (const u of ["owner", "m1", "m2"]) {
      expect(await isFreeTierMemberLocked(db, "org", u)).toBe(false);
    }
  });

  it("låser medlem nr. 4 og 5, men aldrig ejeren", async () => {
    const db = fakeMembersDb(five);
    expect(await isFreeTierMemberLocked(db, "org", "owner")).toBe(false);
    expect(await isFreeTierMemberLocked(db, "org", "m1")).toBe(false);
    expect(await isFreeTierMemberLocked(db, "org", "m2")).toBe(false);
    expect(await isFreeTierMemberLocked(db, "org", "m3")).toBe(true);
    expect(await isFreeTierMemberLocked(db, "org", "m4")).toBe(true);
  });

  it("låser ikke en bruger der ikke er medlem af orgen", async () => {
    const db = fakeMembersDb(five);
    expect(await isFreeTierMemberLocked(db, "org", "stranger")).toBe(false);
  });
});
