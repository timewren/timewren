import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resolveAluntaPlanTier } from "./alunta";

// resolveAluntaPlanTier reads plan UUIDs from process.env at call time, so the
// tests set them explicitly rather than relying on the ambient environment.
describe("resolveAluntaPlanTier", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_MONTHLY = "team-monthly-uuid";
    process.env.ALUNTA_PLAN_TEAM_YEARLY = "team-yearly-uuid";
    process.env.ALUNTA_PLAN_TEAM_SEATS = "team-seats-uuid";
    process.env.ALUNTA_PLAN_BUSINESS_MONTHLY = "biz-monthly-uuid";
    process.env.ALUNTA_PLAN_BUSINESS_YEARLY = "biz-yearly-uuid";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("maps the team base plans to team", () => {
    expect(resolveAluntaPlanTier("team-monthly-uuid")).toBe("team");
    expect(resolveAluntaPlanTier("team-yearly-uuid")).toBe("team");
  });

  it("maps the team seats add-on plan to team (not solo)", () => {
    // Regression: a customer with ONLY the seats add-on (base deleted /
    // founder deal, e.g. kunde A) must not be downgraded to solo by a
    // renewal event. See timetrack-alunta-tier-billing memory.
    expect(resolveAluntaPlanTier("team-seats-uuid")).toBe("team");
  });

  it("maps the business plans to business", () => {
    expect(resolveAluntaPlanTier("biz-monthly-uuid")).toBe("business");
    expect(resolveAluntaPlanTier("biz-yearly-uuid")).toBe("business");
  });

  it("maps the privat plans to privat when configured", () => {
    process.env.ALUNTA_PLAN_PRIVAT_MONTHLY = "privat-monthly-uuid";
    process.env.ALUNTA_PLAN_PRIVAT_YEARLY = "privat-yearly-uuid";
    expect(resolveAluntaPlanTier("privat-monthly-uuid")).toBe("privat");
    expect(resolveAluntaPlanTier("privat-yearly-uuid")).toBe("privat");
  });

  it("falls back to solo for unknown or missing plan UUIDs", () => {
    expect(resolveAluntaPlanTier("some-other-uuid")).toBe("solo");
    expect(resolveAluntaPlanTier(null)).toBe("solo");
    expect(resolveAluntaPlanTier(undefined)).toBe("solo");
  });
});

describe("resolveAluntaPlanTier — legacy plans (prisstige v2)", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    process.env.ALUNTA_PLAN_TEAM_MONTHLY = "team-new-uuid";
    process.env.ALUNTA_PLAN_BUSINESS_MONTHLY = "biz-new-uuid";
    process.env.ALUNTA_PLAN_LEGACY_SOLO = "solo-old-uuid";
    process.env.ALUNTA_PLAN_LEGACY_TEAM = "team-old-m, team-old-y";
    process.env.ALUNTA_PLAN_LEGACY_BUSINESS = "biz-old-uuid";
    process.env.ALUNTA_PLAN_LEGACY_TEAM_SEATS = "team-seats-old";
    process.env.ALUNTA_PLAN_LEGACY_BUSINESS_SEATS = "biz-seats-old";
  });

  afterEach(() => {
    process.env = { ...saved };
  });

  it("maps legacy team/business base plans (comma-separated) to their tier", () => {
    expect(resolveAluntaPlanTier("team-old-m")).toBe("team");
    expect(resolveAluntaPlanTier("team-old-y")).toBe("team");
    expect(resolveAluntaPlanTier("biz-old-uuid")).toBe("business");
  });

  it("maps legacy seats add-ons to their tier (no solo downgrade)", () => {
    expect(resolveAluntaPlanTier("team-seats-old")).toBe("team");
    expect(resolveAluntaPlanTier("biz-seats-old")).toBe("business");
  });

  it("legacy solo stays solo; new plans still resolve", () => {
    expect(resolveAluntaPlanTier("solo-old-uuid")).toBe("solo");
    expect(resolveAluntaPlanTier("team-new-uuid")).toBe("team");
    expect(resolveAluntaPlanTier("biz-new-uuid")).toBe("business");
  });
});
