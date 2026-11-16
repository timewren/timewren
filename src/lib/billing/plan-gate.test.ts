import { describe, expect, it } from "vitest";
import { derivePlanGate, type PlanGateDetails } from "./plan-gate";

const details = (over: Partial<PlanGateDetails> = {}): PlanGateDetails => ({
  isFree: false,
  planTier: "solo",
  limits: { maxActiveClients: null },
  usage: { activeClients: 0 },
  ...over,
});

describe("derivePlanGate", () => {
  it("er markeret som indlæsende og tillader kunder mens der indlæses", () => {
    const g = derivePlanGate(undefined);
    expect(g.isLoading).toBe(true);
  });

  it("uden abonnement er der ingen plan-gate", () => {
    const g = derivePlanGate(null);
    expect(g.canAddClient).toBe(true);
  });

  it("Gratis: max 3 aktive kunder (kapacitet, ingen låste funktioner)", () => {
    const g = derivePlanGate(
      details({
        isFree: true,
        planTier: "free",
        limits: { maxActiveClients: 3 },
        usage: { activeClients: 2 },
      }),
    );
    expect(g.tier).toBe("free");
    expect(g.clientLimit).toBe(3);
    expect(g.canAddClient).toBe(true);
  });

  it("Gratis ved grænsen kan ikke tilføje flere kunder", () => {
    const g = derivePlanGate(
      details({
        isFree: true,
        planTier: "free",
        limits: { maxActiveClients: 3 },
        usage: { activeClients: 3 },
      }),
    );
    expect(g.canAddClient).toBe(false);
  });

  it("opsagt betaler (isFree, tier solo) behandles som Gratis", () => {
    const g = derivePlanGate(details({ isFree: true, planTier: "solo" }));
    expect(g.tier).toBe("free");
  });

  it("Privat: ubegrænsede kunder", () => {
    const g = derivePlanGate(
      details({ planTier: "privat", usage: { activeClients: 40 } }),
    );
    expect(g.clientLimit).toBeNull();
    expect(g.canAddClient).toBe(true);
  });

  it.each(["free", "privat", "solo", "team", "business"])(
    "%s har ingen funktionslås (kun kapacitet)",
    (tier) => {
      const g = derivePlanGate(
        details({ planTier: tier, isFree: tier === "free" }),
      );
      expect(Object.keys(g)).not.toContain("canUseBusinessFeatures");
      expect(Object.keys(g)).not.toContain("isFreeLike");
    },
  );

  it("ukendt/null tier behandles som solo", () => {
    const g = derivePlanGate(details({ planTier: null }));
    expect(g.tier).toBe("solo");
  });

  it("admins har ingen plangrænser selv på Gratis", () => {
    const g = derivePlanGate(
      details({
        isFree: true,
        planTier: "free",
        limits: { maxActiveClients: 3 },
        usage: { activeClients: 5 },
      }),
      { isAdmin: true },
    );
    expect(g.canAddClient).toBe(true);
  });
});
