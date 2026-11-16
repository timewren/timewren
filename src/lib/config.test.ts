import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  aluntaPlanIdGroups,
  basePriceForTier,
  clampSeats,
  cycleListPriceForSubscription,
  DESKTOP_LIFETIME_PRICE,
  envPlanIds,
  getAluntaSeatsPlanIdForTier,
  getCallbackBaseUrl,
  getEmailDomain,
  getFeedbackRecipient,
  getPersonalReplyTo,
  includedSeatsForTier,
  isAluntaSeatsPlan,
  isSharedProdDb,
  LEGACY_DESKTOP_LIFETIME_PRICE,
  maxSeatsForTier,
  monthlyListPriceForSubscription,
  planNameForTier,
  priceBookForAluntaPlan,
  resolveAluntaSeatCount,
  seatPriceForTier,
  totalPriceForTierSeats,
} from "./config";

describe("desktop lifetime license price", () => {
  it("is 499 kr since the 27/10-2026 price cut", () => {
    expect(DESKTOP_LIFETIME_PRICE).toBe(499);
  });
  it("keeps the pre-cut 999 kr as the legacy fallback for old purchases", () => {
    expect(LEGACY_DESKTOP_LIFETIME_PRICE).toBe(999);
  });
});

describe("maxSeatsForTier", () => {
  it("solo = 1, team = 25, business = 50", () => {
    expect(maxSeatsForTier("solo")).toBe(1);
    expect(maxSeatsForTier("team")).toBe(25);
    expect(maxSeatsForTier("business")).toBe(50);
  });
  it("unknown tier falls back to 1", () => {
    expect(maxSeatsForTier("bogus")).toBe(1);
  });
});

describe("includedSeatsForTier", () => {
  it("solo = 1, team = 2, business = 5", () => {
    expect(includedSeatsForTier("solo")).toBe(1);
    expect(includedSeatsForTier("team")).toBe(2);
    expect(includedSeatsForTier("business")).toBe(5);
    expect(includedSeatsForTier("free")).toBe(3);
  });
});

describe("clampSeats", () => {
  it("clamps below the included minimum up to it", () => {
    expect(clampSeats("team", 0)).toBe(2);
    expect(clampSeats("business", 1)).toBe(5);
  });
  it("clamps above the tier max down to it", () => {
    expect(clampSeats("team", 99)).toBe(25);
    expect(clampSeats("business", 1000)).toBe(50);
  });
  it("solo is always 1", () => {
    expect(clampSeats("solo", 5)).toBe(1);
    expect(clampSeats("solo", 0)).toBe(1);
    // Gratis: fast 3 brugere
    expect(clampSeats("free", 1)).toBe(3);
    expect(clampSeats("free", 10)).toBe(3);
  });
  it("keeps a value inside the range and rounds", () => {
    expect(clampSeats("team", 4)).toBe(4);
    expect(clampSeats("team", 4.6)).toBe(5);
  });
  it("non-finite falls back to the minimum (downgrade safety)", () => {
    expect(clampSeats("team", Number.NaN)).toBe(2);
    // A stale team seat count (10) clamped onto solo collapses to 1 — this is
    // the webhook downgrade-protection invariant.
    expect(clampSeats("solo", 10)).toBe(1);
  });
});

describe("seatPriceForTier", () => {
  it("monthly per-seat", () => {
    expect(seatPriceForTier("team", "monthly")).toBe(49);
    expect(seatPriceForTier("business", "monthly")).toBe(69);
    expect(seatPriceForTier("solo", "monthly")).toBe(0);
  });
  it("yearly per-seat = monthly x10 (2 months free)", () => {
    expect(seatPriceForTier("team", "yearly")).toBe(490);
    expect(seatPriceForTier("business", "yearly")).toBe(690);
  });
  it("legacy price book keeps the old seat prices", () => {
    expect(seatPriceForTier("team", "monthly", "legacy")).toBe(49);
    expect(seatPriceForTier("business", "monthly", "legacy")).toBe(39);
    expect(seatPriceForTier("business", "yearly", "legacy")).toBe(390);
  });
});

describe("basePriceForTier", () => {
  it("prisstige v2: solo 79/790, team 98/980, business 345/3450, privat 29/290, free 0", () => {
    expect(basePriceForTier("solo", "monthly")).toBe(79);
    expect(basePriceForTier("solo", "yearly")).toBe(790);
    expect(basePriceForTier("team", "monthly")).toBe(98);
    expect(basePriceForTier("team", "yearly")).toBe(980);
    expect(basePriceForTier("business", "monthly")).toBe(345);
    expect(basePriceForTier("business", "yearly")).toBe(3450);
    expect(basePriceForTier("privat", "monthly")).toBe(29);
    expect(basePriceForTier("privat", "yearly")).toBe(290);
    expect(basePriceForTier("free", "monthly")).toBe(0);
  });
  it("team/business base = per-user price × included seats", () => {
    expect(basePriceForTier("team", "monthly")).toBe(
      seatPriceForTier("team", "monthly") * includedSeatsForTier("team"),
    );
    expect(basePriceForTier("business", "monthly")).toBe(
      seatPriceForTier("business", "monthly") *
        includedSeatsForTier("business"),
    );
  });
  it("legacy price book: solo 99/990, team 199/1990, business 495/4950", () => {
    expect(basePriceForTier("solo", "monthly", "legacy")).toBe(99);
    expect(basePriceForTier("solo", "yearly", "legacy")).toBe(990);
    expect(basePriceForTier("team", "monthly", "legacy")).toBe(199);
    expect(basePriceForTier("team", "yearly", "legacy")).toBe(1990);
    expect(basePriceForTier("business", "monthly", "legacy")).toBe(495);
    expect(basePriceForTier("business", "yearly", "legacy")).toBe(4950);
    // Privat/Gratis er nye tiers uden legacy-pris.
    expect(basePriceForTier("privat", "monthly", "legacy")).toBe(29);
    expect(basePriceForTier("free", "monthly", "legacy")).toBe(0);
  });
});

describe("totalPriceForTierSeats", () => {
  it("included seats cost only the base", () => {
    expect(totalPriceForTierSeats("team", "monthly", 2)).toBe(98);
    expect(totalPriceForTierSeats("business", "monthly", 5)).toBe(345);
  });
  it("extra seats add per-seat price", () => {
    // team monthly, 4 seats: 98 + 2*49 = 4 × 49
    expect(totalPriceForTierSeats("team", "monthly", 4)).toBe(196);
    // team yearly, 4 seats: 980 + 2*490
    expect(totalPriceForTierSeats("team", "yearly", 4)).toBe(1960);
    // business monthly, 7 seats: 345 + 2*69 = 7 × 69
    expect(totalPriceForTierSeats("business", "monthly", 7)).toBe(483);
  });
  it("solo ignores seats (always base)", () => {
    expect(totalPriceForTierSeats("solo", "monthly", 1)).toBe(79);
  });
  it("legacy price book uses old base + old seat price", () => {
    // team monthly, 4 seats: 199 + 2*49
    expect(totalPriceForTierSeats("team", "monthly", 4, "legacy")).toBe(297);
    // business monthly, 7 seats: 495 + 2*39
    expect(totalPriceForTierSeats("business", "monthly", 7, "legacy")).toBe(
      573,
    );
    expect(totalPriceForTierSeats("solo", "yearly", 1, "legacy")).toBe(990);
  });
});

describe("planNameForTier", () => {
  it("maps tiers to display names", () => {
    expect(planNameForTier("solo")).toBe("Selvstændig");
    expect(planNameForTier("team")).toBe("Team");
    expect(planNameForTier("business")).toBe("Virksomhed");
    expect(planNameForTier("privat")).toBe("Privat");
    expect(planNameForTier("free")).toBe("Gratis");
  });
});

describe("cycleListPriceForSubscription", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_YEARLY = "team-new-uuid";
    process.env.ALUNTA_PLAN_LEGACY_TEAM = "team-old-uuid";
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  it("returns the full billed amount incl. seats (new team yearly, 5 seats)", () => {
    // 980 base + 3 extra × 490 = 2450 kr/år
    expect(
      cycleListPriceForSubscription({
        planTier: "team",
        billingCycle: "yearly",
        seatCount: 5,
        aluntaPlanId: "team-new-uuid",
      }),
    ).toBe(2450);
  });
  it("team yearly on the old plan (kunde A, 5 seats) uses the v2 price", () => {
    // 980 base + 3 extra × 490 = 2450 kr/år (v2 fra 1/10-2026)
    expect(
      cycleListPriceForSubscription({
        planTier: "team",
        billingCycle: "yearly",
        seatCount: 5,
        aluntaPlanId: "team-old-uuid",
      }),
    ).toBe(2450);
  });
  it("returns the monthly total for monthly team subs", () => {
    // 98 base + 3 extra × 49 = 245 kr/md
    expect(
      cycleListPriceForSubscription({
        planTier: "team",
        billingCycle: "monthly",
        seatCount: 5,
      }),
    ).toBe(245);
  });
  it("falls back to solo base when tier/seats are null", () => {
    expect(
      cycleListPriceForSubscription({
        planTier: null,
        billingCycle: "monthly",
        seatCount: null,
      }),
    ).toBe(79);
  });
});

describe("envPlanIds", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });
  it("splits comma-separated values, trims and drops empties/duplicates", () => {
    process.env.ALUNTA_PLAN_LEGACY_SOLO = " a-uuid, b-uuid ,,";
    process.env.ALUNTA_PLAN_MONTHLY = "b-uuid";
    process.env.ALUNTA_PLAN_LEGACY_TEAM = "";
    expect(
      envPlanIds(
        "ALUNTA_PLAN_LEGACY_SOLO",
        "ALUNTA_PLAN_MONTHLY",
        "ALUNTA_PLAN_LEGACY_TEAM",
        "ALUNTA_PLAN_DOES_NOT_EXIST",
      ),
    ).toEqual(["a-uuid", "b-uuid"]);
  });
});

describe("legacy plan recognition + price book", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ALUNTA_PLAN_MONTHLY = "solo-new";
    process.env.ALUNTA_PLAN_YEARLY = "solo-new";
    process.env.ALUNTA_PLAN_TEAM_MONTHLY = "team-new";
    process.env.ALUNTA_PLAN_TEAM_SEATS = "team-seats-new";
    process.env.ALUNTA_PLAN_BUSINESS_MONTHLY = "biz-new";
    process.env.ALUNTA_PLAN_BUSINESS_SEATS = "biz-seats-new";
    process.env.ALUNTA_PLAN_FOUNDING_MONTHLY = "founding";
    process.env.ALUNTA_PLAN_LEGACY_SOLO = "solo-old-m,solo-old-y";
    process.env.ALUNTA_PLAN_LEGACY_TEAM = "team-old";
    process.env.ALUNTA_PLAN_LEGACY_BUSINESS = "biz-old";
    process.env.ALUNTA_PLAN_LEGACY_TEAM_SEATS = "team-seats-old";
    process.env.ALUNTA_PLAN_LEGACY_BUSINESS_SEATS = "biz-seats-old";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("groups current AND legacy ids per tier", () => {
    const g = aluntaPlanIdGroups();
    expect(g.soloBase).toEqual(
      expect.arrayContaining([
        "solo-new",
        "founding",
        "solo-old-m",
        "solo-old-y",
      ]),
    );
    expect(g.teamBase).toEqual(["team-new", "team-old"]);
    expect(g.businessBase).toEqual(["biz-new", "biz-old"]);
    expect(g.teamSeats).toEqual(["team-seats-new", "team-seats-old"]);
    expect(g.businessSeats).toEqual(["biz-seats-new", "biz-seats-old"]);
  });

  it("legacy seats plans still count as seats add-ons", () => {
    expect(isAluntaSeatsPlan("team-seats-old")).toBe(true);
    expect(isAluntaSeatsPlan("biz-seats-old")).toBe(true);
    expect(isAluntaSeatsPlan("team-old")).toBe(false);
  });

  it("legacy and founding plans are priced on the current book (v2 fra 1/10-2026)", () => {
    expect(priceBookForAluntaPlan("solo-old-y")).toBe("current");
    expect(priceBookForAluntaPlan("team-old")).toBe("current");
    expect(priceBookForAluntaPlan("biz-seats-old")).toBe("current");
    expect(priceBookForAluntaPlan("founding")).toBe("current");
  });

  it("new, unknown and missing plans are priced on the current book", () => {
    expect(priceBookForAluntaPlan("solo-new")).toBe("current");
    expect(priceBookForAluntaPlan("team-new")).toBe("current");
    expect(priceBookForAluntaPlan("somebody-else")).toBe("current");
    expect(priceBookForAluntaPlan(null)).toBe("current");
    expect(priceBookForAluntaPlan(undefined)).toBe("current");
  });

  it("MRR of a subscription on an old plan uses the v2 price now charged", () => {
    expect(
      monthlyListPriceForSubscription({
        planTier: "solo",
        billingCycle: "monthly",
        aluntaPlanId: "solo-old-m",
      }),
    ).toBe(79);
    expect(
      monthlyListPriceForSubscription({
        planTier: "solo",
        billingCycle: "monthly",
        aluntaPlanId: "solo-new",
      }),
    ).toBe(79);
    expect(
      monthlyListPriceForSubscription({
        planTier: "business",
        billingCycle: "monthly",
        seatCount: 6,
        aluntaPlanId: "biz-old",
      }),
    ).toBe(345 + 69);
  });

  it("grandfathered customers buy extra seats on the legacy seats plan", () => {
    expect(getAluntaSeatsPlanIdForTier("business", "legacy")).toBe(
      "biz-seats-old",
    );
    expect(getAluntaSeatsPlanIdForTier("business")).toBe("biz-seats-new");
    expect(getAluntaSeatsPlanIdForTier("team", "legacy")).toBe(
      "team-seats-old",
    );
  });

  it("falls back to the current seats plan when no legacy seats plan is set", () => {
    process.env.ALUNTA_PLAN_LEGACY_TEAM_SEATS = "";
    expect(getAluntaSeatsPlanIdForTier("team", "legacy")).toBe(
      "team-seats-new",
    );
  });
});

describe("isAluntaSeatsPlan", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_SEATS = "team-seats-uuid";
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  it("recognises the seats add-on plan", () => {
    expect(isAluntaSeatsPlan("team-seats-uuid")).toBe(true);
  });
  it("rejects the base plan, unknowns and null", () => {
    expect(isAluntaSeatsPlan("team-yearly-uuid")).toBe(false);
    expect(isAluntaSeatsPlan("whatever")).toBe(false);
    expect(isAluntaSeatsPlan(null)).toBe(false);
    expect(isAluntaSeatsPlan(undefined)).toBe(false);
  });
});

describe("resolveAluntaSeatCount", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_SEATS = "team-seats-uuid";
    process.env.ALUNTA_PLAN_TEAM_YEARLY = "team-yearly-uuid";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("seats add-on: total = included + quantity", () => {
    // Team includes 2; add-on quantity 3 → 5 total (kunde A).
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-seats-uuid",
        tier: "team",
        quantity: 3,
        existingSeats: 5,
      }),
    ).toBe(5);
  });

  it("seats add-on falls back to metadata seat_count as extra seats", () => {
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-seats-uuid",
        tier: "team",
        quantity: null,
        metadataSeatCount: 2,
        existingSeats: null,
      }),
    ).toBe(4); // 2 included + 2 extra
  });

  it("REGRESSION: base plan ignores quantity=1 and keeps existing seats", () => {
    // The seat-reconciliation cron reads the flat_rate BASE sub (quantity 1).
    // Reading that as seats would collapse kunde A 5 → 2. Must keep 5.
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-yearly-uuid",
        tier: "team",
        quantity: 1,
        existingSeats: 5,
      }),
    ).toBe(5);
  });

  it("base plan uses checkout metadata seat_count as the TOTAL when present", () => {
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-yearly-uuid",
        tier: "team",
        quantity: 1,
        metadataSeatCount: 4,
        existingSeats: null,
      }),
    ).toBe(4);
  });

  it("clamps the result into the tier range", () => {
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-seats-uuid",
        tier: "team",
        quantity: 99,
        existingSeats: null,
      }),
    ).toBe(25); // team max
    expect(
      resolveAluntaSeatCount({
        planUuid: "team-yearly-uuid",
        tier: "solo",
        quantity: 1,
        existingSeats: 5,
      }),
    ).toBe(1); // solo always 1
  });
});

describe("isSharedProdDb", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("false when unset (normal behaviour unchanged)", () => {
    delete process.env.SHARED_PROD_DB;
    expect(isSharedProdDb()).toBe(false);
  });

  it('true only for the exact value "1"', () => {
    process.env.SHARED_PROD_DB = "1";
    expect(isSharedProdDb()).toBe(true);
    process.env.SHARED_PROD_DB = "true";
    expect(isSharedProdDb()).toBe(false);
  });
});

describe("getCallbackBaseUrl", () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it("falls back to NEXT_PUBLIC_APP_URL when unset", () => {
    delete process.env.CALLBACK_BASE_URL;
    process.env.NEXT_PUBLIC_APP_URL = "https://app.timetrack.dk";
    expect(getCallbackBaseUrl()).toBe("https://app.timetrack.dk");
  });

  it("uses CALLBACK_BASE_URL when set, even if it differs from the app URL", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.timetrack.dk";
    process.env.CALLBACK_BASE_URL = "https://beta.timetrack.dk";
    expect(getCallbackBaseUrl()).toBe("https://beta.timetrack.dk");
  });
});

describe("monthlyListPriceForSubscription", () => {
  it("normalises a yearly team sub to a monthly MRR contribution", () => {
    // (980 + 3 × 490) / 12
    expect(
      monthlyListPriceForSubscription({
        planTier: "team",
        billingCycle: "yearly",
        seatCount: 5,
      }),
    ).toBeCloseTo(2450 / 12, 5);
  });
  it("equals the cycle price for monthly subs", () => {
    expect(
      monthlyListPriceForSubscription({
        planTier: "team",
        billingCycle: "monthly",
        seatCount: 5,
      }),
    ).toBe(245);
  });
});

describe("mail-config fra env", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    delete process.env.EMAIL_DOMAIN;
    delete process.env.PERSONAL_REPLY_TO_EMAIL;
    delete process.env.FEEDBACK_TO_EMAIL;
    delete process.env.NEXT_PUBLIC_MARKETING_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });
  it("bruger marketing-værten uden port som mail-domæne (prod: timetrack.dk)", () => {
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://timetrack.dk";
    expect(getEmailDomain()).toBe("timetrack.dk");
    process.env.NEXT_PUBLIC_MARKETING_URL = "http://localhost:3001";
    expect(getEmailDomain()).toBe("localhost");
  });
  it("lader EMAIL_DOMAIN vinde over marketing-værten", () => {
    process.env.NEXT_PUBLIC_MARKETING_URL = "https://beta.timetrack.dk";
    process.env.EMAIL_DOMAIN = "timetrack.dk";
    expect(getEmailDomain()).toBe("timetrack.dk");
  });
  it("giver ingen Reply-To og ingen feedback-modtager uden env", () => {
    expect(getPersonalReplyTo()).toBeUndefined();
    expect(getFeedbackRecipient()).toBeUndefined();
  });
  it("læser Reply-To og feedback-modtager fra env", () => {
    process.env.PERSONAL_REPLY_TO_EMAIL = "mads@timetrack.dk";
    process.env.FEEDBACK_TO_EMAIL = "mads@timetrack.dk";
    expect(getPersonalReplyTo()).toBe("mads@timetrack.dk");
    expect(getFeedbackRecipient()).toBe("mads@timetrack.dk");
  });
});
