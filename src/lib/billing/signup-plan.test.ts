import { describe, expect, it } from "vitest";
import { SEGMENTS } from "@/lib/marketing/segments";
import {
  planTierFromSegmentRef,
  resolveSignupPlanTier,
  SEGMENT_PLAN_TIER,
} from "./signup-plan";

describe("planTierFromSegmentRef", () => {
  it.each([
    ["segment-privat", "privat"],
    ["segment-selvstaendig", "solo"],
    ["segment-teams-og-bureauer", "team"],
    ["segment-virksomheder", "business"],
  ])("%s → %s", (ref, tier) => {
    expect(planTierFromSegmentRef(ref)).toBe(tier);
  });

  it("ignorerer ukendte segmenter og andre refs", () => {
    expect(planTierFromSegmentRef("segment-ukendt")).toBeUndefined();
    expect(planTierFromSegmentRef("segment-")).toBeUndefined();
    expect(planTierFromSegmentRef("segment-toString")).toBeUndefined();
    expect(planTierFromSegmentRef("segment-__proto__")).toBeUndefined();
    expect(planTierFromSegmentRef("desktop-pricing")).toBeUndefined();
    expect(planTierFromSegmentRef("virksomheder")).toBeUndefined();
    expect(planTierFromSegmentRef("")).toBeUndefined();
    expect(planTierFromSegmentRef(null)).toBeUndefined();
    expect(planTierFromSegmentRef(undefined)).toBeUndefined();
  });

  it("dækker alle segmenter på marketing-sitet", () => {
    for (const segment of SEGMENTS) {
      expect(SEGMENT_PLAN_TIER[segment.slug]).toBeDefined();
      expect(planTierFromSegmentRef(`segment-${segment.slug}`)).toBe(
        SEGMENT_PLAN_TIER[segment.slug],
      );
    }
  });
});

describe("resolveSignupPlanTier", () => {
  it("bruger ?plan= fra prissiden", () => {
    expect(resolveSignupPlanTier({ plan: "team" })).toBe("team");
    expect(resolveSignupPlanTier({ plan: "business" })).toBe("business");
  });

  it("lader ?plan= vinde over segment-ref", () => {
    expect(
      resolveSignupPlanTier({ plan: "team", ref: "segment-virksomheder" }),
    ).toBe("team");
    // Desktop-prissiden sender både plan og en ikke-segment-ref.
    expect(
      resolveSignupPlanTier({ plan: "business", ref: "desktop-pricing" }),
    ).toBe("business");
  });

  it("falder tilbage til segment-ref ved ugyldig eller manglende plan", () => {
    expect(resolveSignupPlanTier({ ref: "segment-virksomheder" })).toBe(
      "business",
    );
    expect(
      resolveSignupPlanTier({ plan: "enterprise", ref: "segment-privat" }),
    ).toBe("privat");
    expect(
      resolveSignupPlanTier({ plan: "free", ref: "segment-selvstaendig" }),
    ).toBe("solo");
  });

  it("returnerer undefined uden præference (picker'en vælger solo)", () => {
    expect(resolveSignupPlanTier({})).toBeUndefined();
    expect(resolveSignupPlanTier({ plan: null, ref: null })).toBeUndefined();
    expect(resolveSignupPlanTier({ plan: "free" })).toBeUndefined();
    expect(resolveSignupPlanTier({ ref: "alternativ-toggl" })).toBeUndefined();
  });
});
