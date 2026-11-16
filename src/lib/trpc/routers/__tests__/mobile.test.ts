import { describe, expect, it, vi } from "vitest";

// mobile.ts pulls in ../trpc → auth → db; mock the connection so importing
// the router doesn't open a real one.
vi.mock("@/lib/db", () => ({ db: {} }));

import { deriveMobileTier } from "../mobile";

describe("deriveMobileTier", () => {
  it("is solo for a lone user without plan or org", () => {
    expect(
      deriveMobileTier({
        enterpriseEnabled: false,
        planTier: undefined,
        memberCount: 0,
      }),
    ).toBe("solo");
    expect(
      deriveMobileTier({
        enterpriseEnabled: false,
        planTier: "solo",
        memberCount: 1,
      }),
    ).toBe("solo");
  });

  it("is solo for the single-user free and privat tiers", () => {
    for (const planTier of ["free", "privat"]) {
      expect(
        deriveMobileTier({
          enterpriseEnabled: false,
          planTier,
          memberCount: 1,
        }),
      ).toBe("solo");
    }
  });

  it("is team when the org has two or more members", () => {
    expect(
      deriveMobileTier({
        enterpriseEnabled: false,
        planTier: "solo",
        memberCount: 2,
      }),
    ).toBe("team");
  });

  it("is team when the subscription plan is not solo, even for a single member", () => {
    expect(
      deriveMobileTier({
        enterpriseEnabled: false,
        planTier: "team",
        memberCount: 1,
      }),
    ).toBe("team");
    expect(
      deriveMobileTier({
        enterpriseEnabled: false,
        planTier: "business",
        memberCount: 1,
      }),
    ).toBe("team");
  });

  it("is enterprise whenever the enterprise module is enabled", () => {
    expect(
      deriveMobileTier({
        enterpriseEnabled: true,
        planTier: "solo",
        memberCount: 1,
      }),
    ).toBe("enterprise");
  });
});
