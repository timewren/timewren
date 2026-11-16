import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { includedSeatsForTier, maxSeatsForTier } from "@/lib/config";
import {
  type AluntaSubSummary,
  baseCheckoutRelinkDecision,
  cancelSubscriptionsSafely,
  expectedSeatsForSubscription,
  findObsoleteSeatsSubs,
  findObsoleteSubsOnUpgrade,
  isLiveAluntaStatus,
  knownBasePlanTier,
  parseReplacesUuids,
  resolveBaseEventSeatCount,
  seatsPlanTier,
  tierRank,
  upgradeSeatCount,
  validateExtraSeatsPurchase,
} from "../seats";

// Plan-UUID'er som testene stubber i env — matcher navngivningen i .env.example
const SOLO_MONTHLY = "plan-solo-monthly";
const SOLO_YEARLY = "plan-solo-yearly";
const FOUNDING_MONTHLY = "plan-founding-monthly";
const TEAM_MONTHLY = "plan-team-monthly";
const TEAM_YEARLY = "plan-team-yearly";
const BUSINESS_MONTHLY = "plan-business-monthly";
const TEAM_SEATS = "plan-team-seats";
const BUSINESS_SEATS = "plan-business-seats";
const UNKNOWN_PLAN = "plan-somebody-elses";

function sub(
  uuid: string,
  planUuid: string,
  status = "active",
): AluntaSubSummary {
  return { uuid, status, plan: { uuid: planUuid } };
}

beforeEach(() => {
  vi.stubEnv("ALUNTA_PLAN_MONTHLY", SOLO_MONTHLY);
  vi.stubEnv("ALUNTA_PLAN_YEARLY", SOLO_YEARLY);
  vi.stubEnv("ALUNTA_PLAN_FOUNDING_MONTHLY", FOUNDING_MONTHLY);
  vi.stubEnv("ALUNTA_PLAN_TEAM_MONTHLY", TEAM_MONTHLY);
  vi.stubEnv("ALUNTA_PLAN_TEAM_YEARLY", TEAM_YEARLY);
  vi.stubEnv("ALUNTA_PLAN_BUSINESS_MONTHLY", BUSINESS_MONTHLY);
  vi.stubEnv("ALUNTA_PLAN_TEAM_SEATS", TEAM_SEATS);
  vi.stubEnv("ALUNTA_PLAN_BUSINESS_SEATS", BUSINESS_SEATS);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("plan-genkendelse", () => {
  it("rangordner tiers solo < team < business", () => {
    expect(tierRank("solo")).toBeLessThan(tierRank("team"));
    expect(tierRank("team")).toBeLessThan(tierRank("business"));
    expect(tierRank(null)).toBe(tierRank("solo"));
  });

  it("rangordner Gratis og Privat under solo: free < privat < solo", () => {
    expect(tierRank("free")).toBeLessThan(tierRank("privat"));
    expect(tierRank("privat")).toBeLessThan(tierRank("solo"));
  });

  it("mapper seats-planer til deres tier og alt andet til null", () => {
    expect(seatsPlanTier(TEAM_SEATS)).toBe("team");
    expect(seatsPlanTier(BUSINESS_SEATS)).toBe("business");
    expect(seatsPlanTier(TEAM_MONTHLY)).toBeNull();
    expect(seatsPlanTier(UNKNOWN_PLAN)).toBeNull();
  });

  it("genkender kun VORES base-planer — ukendte planer giver null, ikke solo", () => {
    expect(knownBasePlanTier(SOLO_MONTHLY)).toBe("solo");
    expect(knownBasePlanTier(FOUNDING_MONTHLY)).toBe("solo");
    expect(knownBasePlanTier(TEAM_YEARLY)).toBe("team");
    expect(knownBasePlanTier(BUSINESS_MONTHLY)).toBe("business");
    expect(knownBasePlanTier(TEAM_SEATS)).toBeNull();
    expect(knownBasePlanTier(UNKNOWN_PLAN)).toBeNull();
  });

  it("genkender legacy-planer (grandfathering) som base- og seats-planer", () => {
    vi.stubEnv("ALUNTA_PLAN_LEGACY_SOLO", "plan-solo-old-m,plan-solo-old-y");
    vi.stubEnv("ALUNTA_PLAN_LEGACY_TEAM", "plan-team-old");
    vi.stubEnv("ALUNTA_PLAN_LEGACY_BUSINESS", "plan-business-old");
    vi.stubEnv("ALUNTA_PLAN_LEGACY_TEAM_SEATS", "plan-team-seats-old");
    vi.stubEnv("ALUNTA_PLAN_LEGACY_BUSINESS_SEATS", "plan-business-seats-old");
    expect(knownBasePlanTier("plan-solo-old-y")).toBe("solo");
    expect(knownBasePlanTier("plan-team-old")).toBe("team");
    expect(knownBasePlanTier("plan-business-old")).toBe("business");
    expect(knownBasePlanTier("plan-team-seats-old")).toBeNull();
    expect(seatsPlanTier("plan-team-seats-old")).toBe("team");
    expect(seatsPlanTier("plan-business-seats-old")).toBe("business");
    expect(seatsPlanTier("plan-team-old")).toBeNull();
  });

  it("tæller trialing som live status", () => {
    expect(isLiveAluntaStatus("active")).toBe(true);
    expect(isLiveAluntaStatus("trialing")).toBe(true);
    expect(isLiveAluntaStatus("cancelled")).toBe(false);
    expect(isLiveAluntaStatus("past_due")).toBe(false);
    expect(isLiveAluntaStatus(null)).toBe(false);
  });
});

describe("findObsoleteSeatsSubs — seats-aktivering annullerer kun ANDRE seats-subs", () => {
  it("finder gamle live seats-subs men aldrig base-subs eller den nye selv", () => {
    const subs = [
      sub("new-seats", TEAM_SEATS, "trialing"), // den netop aktiverede
      sub("old-seats", TEAM_SEATS, "active"), // kunde-casen: gammelt tilkøb
      sub("base", TEAM_MONTHLY, "active"), // basen skal ALDRIG røres
      sub("cancelled-seats", TEAM_SEATS, "cancelled"), // allerede død
      sub("unknown", UNKNOWN_PLAN, "active"),
    ];
    const obsolete = findObsoleteSeatsSubs("new-seats", subs);
    expect(obsolete.map((s) => s.uuid)).toEqual(["old-seats"]);
  });

  it("er idempotent — anden kørsel finder intet", () => {
    const subs = [
      sub("new-seats", TEAM_SEATS, "active"),
      sub("old-seats", TEAM_SEATS, "cancelled"),
      sub("base", TEAM_MONTHLY, "active"),
    ];
    expect(findObsoleteSeatsSubs("new-seats", subs)).toEqual([]);
  });

  it("tager også trialing seats-subs med (dobbelt-tilkøb i trial)", () => {
    const subs = [
      sub("new-seats", TEAM_SEATS, "active"),
      sub("old-seats", TEAM_SEATS, "trialing"),
    ];
    expect(findObsoleteSeatsSubs("new-seats", subs).map((s) => s.uuid)).toEqual(
      ["old-seats"],
    );
  });
});

describe("findObsoleteSubsOnUpgrade — tier-opgradering", () => {
  it("business-aktivering annullerer team-base + team-seats men ikke business-subs", () => {
    const subs = [
      sub("new-business", BUSINESS_MONTHLY, "active"),
      sub("old-team-base", TEAM_MONTHLY, "active"),
      sub("old-team-seats", TEAM_SEATS, "trialing"),
      sub("other-business", BUSINESS_MONTHLY, "active"), // samme tier — rør ikke
      sub("business-seats", BUSINESS_SEATS, "active"), // samme tier — rør ikke
    ];
    const obsolete = findObsoleteSubsOnUpgrade(
      "new-business",
      "business",
      subs,
    );
    expect(obsolete.map((s) => s.uuid).sort()).toEqual([
      "old-team-base",
      "old-team-seats",
    ]);
  });

  it("team-aktivering annullerer solo-base (inkl. founding) men ikke team-subs", () => {
    const subs = [
      sub("new-team", TEAM_MONTHLY, "trialing"),
      sub("old-solo", SOLO_MONTHLY, "active"),
      sub("old-founding", FOUNDING_MONTHLY, "active"),
      sub("team-seats", TEAM_SEATS, "active"), // samme tier — rør ikke
    ];
    const obsolete = findObsoleteSubsOnUpgrade("new-team", "team", subs);
    expect(obsolete.map((s) => s.uuid).sort()).toEqual([
      "old-founding",
      "old-solo",
    ]);
  });

  it("rører aldrig ukendte planer eller ikke-live subs", () => {
    const subs = [
      sub("new-business", BUSINESS_MONTHLY, "active"),
      sub("unknown", UNKNOWN_PLAN, "active"),
      sub("dead-team", TEAM_MONTHLY, "cancelled"),
    ];
    expect(findObsoleteSubsOnUpgrade("new-business", "business", subs)).toEqual(
      [],
    );
  });
});

describe("cancelSubscriptionsSafely — fejlrobusthed", () => {
  it("fortsætter til de øvrige subs når én annullering fejler", async () => {
    const cancelled: string[] = [];
    const cancelFn = vi.fn(async (uuid: string) => {
      if (uuid === "b") throw new Error("Alunta API 500");
      cancelled.push(uuid);
    });
    const onError = vi.fn();

    const result = await cancelSubscriptionsSafely(
      [sub("a", TEAM_SEATS), sub("b", TEAM_SEATS), sub("c", TEAM_SEATS)],
      cancelFn,
      onError,
    );

    expect(result.cancelled).toEqual(["a", "c"]);
    expect(result.failed).toEqual(["b"]);
    expect(cancelled).toEqual(["a", "c"]);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith("b", expect.any(Error));
  });

  it("kaster aldrig selv — også når alle fejler", async () => {
    const onError = vi.fn();
    const result = await cancelSubscriptionsSafely(
      [sub("a", TEAM_SEATS)],
      async () => {
        throw new Error("boom");
      },
      onError,
    );
    expect(result).toEqual({ cancelled: [], failed: ["a"] });
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe("parseReplacesUuids — metadata-ankeret for erstat-og-annullér", () => {
  it("læser en array af UUID'er (også JSON-serialiseret som streng)", () => {
    expect(parseReplacesUuids(["a", "b"])).toEqual(["a", "b"]);
    expect(parseReplacesUuids('["a","b"]')).toEqual(["a", "b"]);
    expect(parseReplacesUuids([])).toEqual([]);
  });

  it("returnerer null (→ backstop) når nøglen mangler eller er ulæselig", () => {
    expect(parseReplacesUuids(undefined)).toBeNull();
    expect(parseReplacesUuids(null)).toBeNull();
    expect(parseReplacesUuids("not json")).toBeNull();
    expect(parseReplacesUuids(42)).toBeNull();
    expect(parseReplacesUuids({ a: 1 })).toBeNull();
  });

  it("filtrerer ikke-strenge og tomme strenge fra", () => {
    expect(parseReplacesUuids(["a", 7, "", null, "b"])).toEqual(["a", "b"]);
  });
});

describe("upgradeSeatCount — kapacitet følger med ved opgradering (fund 1)", () => {
  it("bevarer effektiv maxSeats i stedet for at falde til inkluderede", () => {
    // Team 2 inkl. + 3 tilkøbte = 5 → Business (5 inkl.) starter på 5
    expect(upgradeSeatCount("business", 5, 5)).toBe(5);
    // Team med 8 pladser → Business starter på 8, ikke 5
    expect(upgradeSeatCount("business", 8, 8)).toBe(8);
  });

  it("går aldrig UNDER den nye tiers inkluderede pladser", () => {
    // Solo (1 plads) → Team starter på de 2 inkluderede
    expect(upgradeSeatCount("team", 1, 1)).toBe(includedSeatsForTier("team"));
    expect(upgradeSeatCount("business", null, null)).toBe(
      includedSeatsForTier("business"),
    );
  });

  it("clamper til den nye tiers maks", () => {
    expect(upgradeSeatCount("team", 999, 999)).toBe(maxSeatsForTier("team"));
  });
});

describe("expectedSeatsForSubscription — cron-afstemning (fund 3)", () => {
  it("er inkluderede + SUM af live seats-subs' quantity", () => {
    expect(
      expectedSeatsForSubscription({
        tier: "team",
        baseMetaSeatCount: null,
        liveSeatsQuantities: [3, 2],
      }),
    ).toBe(includedSeatsForTier("team") + 5);
  });

  it("basens metadata.seat_count er et kapacitets-GULV (opgraderings-carry), ikke sandheden alene", () => {
    // Base-metadata 7 (medbragt fra opgradering), add-on endnu ikke gentegnet
    expect(
      expectedSeatsForSubscription({
        tier: "business",
        baseMetaSeatCount: 7,
        liveSeatsQuantities: [],
      }),
    ).toBe(7);
    // Add-on'en overstiger metadataen → summen vinder
    expect(
      expectedSeatsForSubscription({
        tier: "business",
        baseMetaSeatCount: 7,
        liveSeatsQuantities: [4],
      }),
    ).toBe(includedSeatsForTier("business") + 4);
  });

  it("kan LOVLIGT ligge under en oppustet lokal værdi (ægte add-on-annullering)", () => {
    expect(
      expectedSeatsForSubscription({
        tier: "team",
        baseMetaSeatCount: null,
        liveSeatsQuantities: [],
      }),
    ).toBe(includedSeatsForTier("team"));
  });

  it("ignorerer ugyldige quantities og clamper til tier-maks", () => {
    expect(
      expectedSeatsForSubscription({
        tier: "team",
        baseMetaSeatCount: null,
        liveSeatsQuantities: [Number.NaN, -2, 999],
      }),
    ).toBe(maxSeatsForTier("team"));
  });
});

describe("resolveBaseEventSeatCount — frossen base-metadata må ikke sænke pladser (fund 3)", () => {
  it("lader aldrig et base-event sænke rækkens nuværende pladser", () => {
    // Base-checkout med seat_count=2 fra før add-on-købet, rækken står på 7
    expect(resolveBaseEventSeatCount("team", 2, 7)).toBe(7);
  });

  it("hæver gerne (nyt højere metadata-tal) og clamper til tieren", () => {
    expect(resolveBaseEventSeatCount("team", 6, 4)).toBe(6);
    expect(resolveBaseEventSeatCount("team", 999, 4)).toBe(
      maxSeatsForTier("team"),
    );
  });
});

describe("baseCheckoutRelinkDecision — ikke-linkede base-events (fund 7)", () => {
  it("re-pointer ved vores egne upgrade-metadata", () => {
    expect(
      baseCheckoutRelinkDecision({
        hasUpgradeMetadata: true,
        eventTier: "team",
        rowTier: "team",
      }),
    ).toBe("relink");
  });

  it("re-pointer ved højere tier (opgradering uden metadata)", () => {
    expect(
      baseCheckoutRelinkDecision({
        hasUpgradeMetadata: false,
        eventTier: "business",
        rowTier: "team",
      }),
    ).toBe("relink");
  });

  it("kræver adoptions-verifikation for samme/lavere tier uden metadata — en gammel sub der vågner må aldrig nedgradere rækken", () => {
    expect(
      baseCheckoutRelinkDecision({
        hasUpgradeMetadata: false,
        eventTier: "team",
        rowTier: "team",
      }),
    ).toBe("verify-adoption");
    expect(
      baseCheckoutRelinkDecision({
        hasUpgradeMetadata: false,
        eventTier: "solo",
        rowTier: "business",
      }),
    ).toBe("verify-adoption");
  });
});

describe("validateExtraSeatsPurchase", () => {
  const teamIncluded = includedSeatsForTier("team");
  const teamMaxExtra = maxSeatsForTier("team") - teamIncluded;

  it("godkender et gyldigt køb", () => {
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: 3,
        seatsInUse: teamIncluded + 1,
      }),
    ).toBeNull();
  });

  it("afviser solo-tier og ukendt tier", () => {
    expect(
      validateExtraSeatsPurchase({
        tier: "solo",
        totalExtraSeats: 1,
        seatsInUse: 1,
      }),
    ).toMatch(/Team- eller Virksomhed-plan/);
    expect(
      validateExtraSeatsPurchase({
        tier: null,
        totalExtraSeats: 1,
        seatsInUse: 1,
      }),
    ).toMatch(/Team- eller Virksomhed-plan/);
  });

  it("kræver mindst 1 ekstra plads og heltal", () => {
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: 0,
        seatsInUse: 1,
      }),
    ).toMatch(/mindst 1/);
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: 1.5,
        seatsInUse: 1,
      }),
    ).toMatch(/mindst 1/);
  });

  it("afviser køb over tier-maks (clamp)", () => {
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: teamMaxExtra + 1,
        seatsInUse: 1,
      }),
    ).toMatch(/højst/);
    // Præcis på grænsen er ok
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: teamMaxExtra,
        seatsInUse: 1,
      }),
    ).toBeNull();
  });

  it("afviser at købe sig NED under pladser i brug (medlemmer + invites)", () => {
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: 1,
        seatsInUse: teamIncluded + 3,
      }),
    ).toMatch(/bruger allerede/);
  });

  it("afviser når tierens seats-plan-env mangler (feature-gate)", () => {
    vi.stubEnv("ALUNTA_PLAN_BUSINESS_SEATS", "");
    expect(
      validateExtraSeatsPurchase({
        tier: "business",
        totalExtraSeats: 2,
        seatsInUse: 1,
      }),
    ).toMatch(/ikke tilgængeligt/);
    // Team-planen er fortsat konfigureret og virker
    expect(
      validateExtraSeatsPurchase({
        tier: "team",
        totalExtraSeats: 2,
        seatsInUse: 1,
      }),
    ).toBeNull();
  });
});
